// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/swan/swan_url_safety.h"

#include <string>
#include <string_view>

#include "base/strings/string_util.h"
#include "net/base/ip_address.h"
#include "url/gurl.h"

namespace swan {

namespace {

constexpr std::string_view kInternalSuffixes[] = {
    ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".home.arpa",
};

}  // namespace

bool IsSafeWebUrl(const GURL& url) {
  if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS()) {
    return false;
  }
  if (url.has_username() || url.has_password()) {
    return false;
  }

  // GURL canonicalizes the host: lower-case, IPv4 in dotted-decimal (so
  // "http://2130706433/" is already "127.0.0.1"), IPv6 in brackets.
  std::string host = base::ToLowerASCII(url.host());
  while (!host.empty() && host.back() == '.') {
    host.pop_back();
  }
  if (host.empty() || host.front() == '[') {
    return false;
  }
  if (host == "localhost" || base::EndsWith(host, ".localhost")) {
    return false;
  }
  for (std::string_view suffix : kInternalSuffixes) {
    if (base::EndsWith(host, suffix)) {
      return false;
    }
  }
  if (host.find('.') == std::string::npos) {
    return false;  // single-label intranet name
  }
  if (url.HostIsIPAddress()) {
    net::IPAddress ip;
    if (!ip.AssignFromIPLiteral(host) || !ip.IsPubliclyRoutable()) {
      return false;
    }
  }
  return true;
}

bool IsLoopbackCallbackUrl(const GURL& url) {
  return url.is_valid() && url.SchemeIs("http") && url.host() == "127.0.0.1" &&
         url.path() == "/callback";
}

}  // namespace swan
