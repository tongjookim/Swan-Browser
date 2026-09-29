// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/swan/swan_fetcher.h"

#include <algorithm>
#include <optional>
#include <string_view>

#include "base/functional/bind.h"
#include "base/i18n/icu_string_conversions.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/swan/swan_url_safety.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/load_flags.h"
#include "net/base/net_errors.h"
#include "net/http/http_response_headers.h"
#include "net/http/http_util.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/client_security_state.mojom.h"
#include "services/network/public/mojom/ip_address_space.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"

namespace swan {

namespace {

constexpr size_t kMaxUploadBytes = 64 * 1024;
constexpr size_t kMaxHeaderValueBytes = 4096;

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("swan_fetcher", R"(
    semantics {
      sender: "SWAN CODA panel"
      description:
        "Requests made on behalf of the chrome://swan CODA panel: OAuth login "
        "and CODA chatbot calls to the SWAN server (www.swn.kr), and, only if "
        "the user enabled web search, DuckDuckGo result pages and the public "
        "web pages found by that search."
      trigger: "The user signs in, asks CODA a question, or presses a button "
               "in the CODA panel."
      data:
        "SWAN server: OAuth codes/tokens and the user's question. Web search: "
        "the search query; no cookies, no login state and no page content is "
        "sent to the sites."
      destination: OTHER
    }
    policy {
      cookies_allowed: NO
      setting: "chrome://swan > Settings; web search is off by default"
      policy_exception_justification: "Not implemented."
    })");

bool IsAllowedSwnPath(std::string_view path) {
  return path == "/oauth/token" || path == "/oauth/revoke" ||
         path == "/oauth/userinfo" ||
         base::StartsWith(path, "/wp-json/wpos/v1/coda/");
}

// Looks at the first bytes of an HTML document for <meta charset=...>.
std::string SniffMetaCharset(std::string_view body) {
  std::string head =
      base::ToLowerASCII(body.substr(0, std::min<size_t>(body.size(), 4096)));
  size_t pos = head.find("charset=");
  if (pos == std::string::npos) {
    return std::string();
  }
  pos += 8;
  while (pos < head.size() && (head[pos] == '"' || head[pos] == '\'' ||
                               head[pos] == ' ')) {
    ++pos;
  }
  size_t end = pos;
  while (end < head.size() &&
         (base::IsAsciiAlphaNumeric(head[end]) || head[end] == '-' ||
          head[end] == '_')) {
    ++end;
  }
  return head.substr(pos, end - pos);
}

// Web pages in EUC-KR & co. are common for Korean sites: convert to UTF-8 and
// make sure the result is valid UTF-8, because it is handed to the WebUI as a
// base::Value string.
std::string ToValidUtf8(std::string_view body,
                        const std::string& header_charset) {
  std::string charset =
      header_charset.empty() ? SniffMetaCharset(body) : header_charset;
  std::string utf8(body);
  if (!charset.empty() && !base::EqualsCaseInsensitiveASCII(charset, "utf-8") &&
      !base::EqualsCaseInsensitiveASCII(charset, "utf8")) {
    std::string converted;
    if (base::ConvertToUtf8AndNormalize(body, charset, &converted)) {
      utf8 = std::move(converted);
    }
  }
  if (!base::IsStringUTF8(utf8)) {
    utf8 = base::UTF16ToUTF8(base::UTF8ToUTF16(utf8));  // U+FFFD for bad bytes
  }
  return utf8;
}

}  // namespace

struct SwanFetcher::Job {
  Callback callback;
  SwanFetchRequest::Mode mode = SwanFetchRequest::Mode::kSwn;
  std::unique_ptr<network::SimpleURLLoader> loader;
  scoped_refptr<network::SharedURLLoaderFactory> factory;
};

SwanFetcher::SwanFetcher(Profile* profile) : profile_(profile) {}

SwanFetcher::~SwanFetcher() = default;

// static
std::string SwanFetcher::Validate(const SwanFetchRequest& r) {
  if (!r.url.is_valid()) {
    return "invalid_url";
  }
  if (r.method != "GET" && r.method != "POST") {
    return "method_not_allowed";
  }
  if (r.body.size() > kMaxUploadBytes) {
    return "request_too_large";
  }

  if (r.mode == SwanFetchRequest::Mode::kSwn) {
    if (!r.url.SchemeIs(url::kHttpsScheme) || r.url.host() != kSwnHost ||
        r.url.has_port() || r.url.has_username() || r.url.has_password()) {
      return "host_not_allowed";
    }
    if (!IsAllowedSwnPath(r.url.path())) {
      return "path_not_allowed";
    }
    // Tokens must never travel in a URL.
    if (r.url.has_query() || r.url.has_ref()) {
      return "query_not_allowed";
    }
    for (const auto& [name, value] : r.headers) {
      const std::string lower = base::ToLowerASCII(name);
      if (lower != "authorization" && lower != "content-type") {
        return "header_not_allowed";
      }
      if (value.size() > kMaxHeaderValueBytes ||
          !net::HttpUtil::IsValidHeaderValue(value)) {
        return "bad_header_value";
      }
    }
    return std::string();
  }

  // kWeb
  if (r.method != "GET" || !r.body.empty() || !r.headers.empty()) {
    return "web_get_only";
  }
  if (!IsSafeWebUrl(r.url)) {
    return "unsafe_url";
  }
  return std::string();
}

void SwanFetcher::Fetch(SwanFetchRequest request, Callback callback) {
  std::string error = Validate(request);
  if (error.empty() && profile_->IsOffTheRecord()) {
    error = "incognito_not_allowed";
  }
  if (!error.empty()) {
    SwanFetchResponse response;
    response.error = std::move(error);
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(std::move(callback), std::move(response)));
    return;
  }

  const bool web = request.mode == SwanFetchRequest::Mode::kWeb;

  auto job = std::make_unique<Job>();
  job->callback = std::move(callback);
  job->mode = request.mode;
  job->factory = profile_->GetDefaultStoragePartition()
                     ->GetURLLoaderFactoryForBrowserProcess();

  auto resource_request = std::make_unique<network::ResourceRequest>();
  resource_request->url = request.url;
  resource_request->method = request.method;
  resource_request->load_flags =
      net::LOAD_DISABLE_CACHE | net::LOAD_BYPASS_CACHE;
  // No cookies in either direction, for the SWAN server and for the web.
  resource_request->credentials_mode = network::mojom::CredentialsMode::kOmit;

  // Treat the request as coming from a *public* address space and block Local
  // Network Access: the network service then refuses to connect to
  // loopback/private destinations, whatever the host name resolved to and
  // whichever redirect led there.
  auto client_security_state = network::mojom::ClientSecurityState::New();
  client_security_state->ip_address_space =
      network::mojom::IPAddressSpace::kPublic;
  client_security_state->is_web_secure_context = true;
  client_security_state->local_network_access_request_policy =
      network::mojom::LocalNetworkAccessRequestPolicy::kBlock;
  resource_request->trusted_params = network::ResourceRequest::TrustedParams();
  resource_request->trusted_params->client_security_state =
      std::move(client_security_state);

  std::string upload_content_type = "application/octet-stream";
  for (const auto& [name, value] : request.headers) {
    if (base::EqualsCaseInsensitiveASCII(name, "content-type")) {
      upload_content_type = value;
    } else {
      resource_request->headers.SetHeader(name, value);
    }
  }
  if (web) {
    resource_request->headers.SetHeader(
        "Accept",
        "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5,*/*;q=0.1");
    resource_request->headers.SetHeader("Accept-Language",
                                        "ko-KR,ko;q=0.9,en;q=0.5");
  }

  job->loader = network::SimpleURLLoader::Create(std::move(resource_request),
                                                 kTrafficAnnotation);
  // The OAuth server and the CODA gateway answer errors with a JSON body that
  // the page needs (invalid_grant, insufficient_scope, 429 Retry-After ...).
  job->loader->SetAllowHttpErrorResults(true);
  job->loader->SetTimeoutDuration(base::Seconds(web ? 15 : 30));
  if (request.method == "POST" && !request.body.empty()) {
    job->loader->AttachStringForUpload(request.body, upload_content_type);
  }

  const size_t cap = web ? kMaxWebBytes : kMaxSwnBytes;
  const size_t max_bytes = std::min(request.max_bytes, cap);

  const int id = next_job_id_++;
  network::SimpleURLLoader* loader = job->loader.get();
  network::SharedURLLoaderFactory* factory = job->factory.get();
  jobs_[id] = std::move(job);
  loader->DownloadToString(
      factory,
      base::BindOnce(&SwanFetcher::OnDownloaded, weak_factory_.GetWeakPtr(),
                     id),
      max_bytes);
}

void SwanFetcher::OnDownloaded(int job_id, std::optional<std::string> body) {
  auto it = jobs_.find(job_id);
  if (it == jobs_.end()) {
    return;
  }
  std::unique_ptr<Job> job = std::move(it->second);
  jobs_.erase(it);

  SwanFetchResponse response;
  std::string mime_type;
  std::string charset;
  const network::mojom::URLResponseHead* info = job->loader->ResponseInfo();
  if (info && info->headers) {
    response.status = info->headers->response_code();
    info->headers->GetMimeTypeAndCharset(&mime_type, &charset);
    if (!mime_type.empty()) {
      response.headers.emplace_back("content-type", mime_type);
    }
    if (std::optional<std::string> retry_after =
            info->headers->GetNormalizedHeader("Retry-After")) {
      response.headers.emplace_back("retry-after", *retry_after);
    }
  }

  if (!body) {
    const int net_error = job->loader->NetError();
    if (net_error == net::ERR_INSUFFICIENT_RESOURCES) {
      response.error = "too_large";
    } else if (net_error == net::ERR_TIMED_OUT) {
      response.error = "timeout";
    } else {
      response.error = base::StrCat(
          {"net_error_", base::NumberToString(-net_error)});
    }
  } else if (job->mode == SwanFetchRequest::Mode::kWeb &&
             !(base::StartsWith(mime_type, "text/") ||
               mime_type == "application/xhtml+xml")) {
    // Search results and articles are text; never hand binaries to the page.
    response.error = "unsupported_content_type";
  } else {
    response.body = job->mode == SwanFetchRequest::Mode::kWeb
                        ? ToValidUtf8(*body, charset)
                        : ToValidUtf8(*body, std::string());
  }
  std::move(job->callback).Run(std::move(response));
}

}  // namespace swan
