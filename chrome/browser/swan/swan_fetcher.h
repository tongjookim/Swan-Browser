// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SWAN_SWAN_FETCHER_H_
#define CHROME_BROWSER_SWAN_SWAN_FETCHER_H_

#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "url/gurl.h"

class Profile;

namespace network {
class SimpleURLLoader;
}  // namespace network

namespace swan {

// The only network path of the chrome://swan page (its CSP is connect-src
// 'none'). Two restricted modes:
//
//  kSwn : OAuth + CODA gateway calls to the SWAN server. Fixed host, https,
//         allow-listed paths, only Authorization / Content-Type headers.
//  kWeb : GET of a public web page for CODA's browser-side web search. Safe
//         URL only, no request headers from the page, no cookies, response
//         size cap, and Local Network Access policy "block" so the network
//         service itself refuses local/loopback destinations (DNS rebinding
//         and redirects included).
//
// Neither mode sends or stores cookies and neither uses the HTTP cache.
struct SwanFetchRequest {
  enum class Mode { kSwn, kWeb };

  GURL url;
  std::string method = "GET";
  std::vector<std::pair<std::string, std::string>> headers;
  std::string body;
  Mode mode = Mode::kSwn;
  size_t max_bytes = 200 * 1024;
};

struct SwanFetchResponse {
  int status = 0;  // HTTP status; 0 when no response was received
  std::string error;  // empty on success
  std::vector<std::pair<std::string, std::string>> headers;
  std::string body;  // valid UTF-8
};

class SwanFetcher {
 public:
  using Callback = base::OnceCallback<void(SwanFetchResponse)>;

  static constexpr char kSwnHost[] = "www.swn.kr";
  static constexpr size_t kMaxSwnBytes = 512 * 1024;
  static constexpr size_t kMaxWebBytes = 1536 * 1024;

  explicit SwanFetcher(Profile* profile);
  SwanFetcher(const SwanFetcher&) = delete;
  SwanFetcher& operator=(const SwanFetcher&) = delete;
  ~SwanFetcher();

  // Validates |request|; on refusal |callback| runs (asynchronously) with a
  // non-empty error and nothing is sent.
  void Fetch(SwanFetchRequest request, Callback callback);

  // Returns an error string if |request| is not allowed, empty if it is.
  // Exposed for tests.
  static std::string Validate(const SwanFetchRequest& request);

 private:
  struct Job;

  void OnDownloaded(int job_id, std::optional<std::string> body);

  raw_ptr<Profile> profile_;
  int next_job_id_ = 1;
  std::map<int, std::unique_ptr<Job>> jobs_;
  base::WeakPtrFactory<SwanFetcher> weak_factory_{this};
};

}  // namespace swan

#endif  // CHROME_BROWSER_SWAN_SWAN_FETCHER_H_
