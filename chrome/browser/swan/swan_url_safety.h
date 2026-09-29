// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SWAN_SWAN_URL_SAFETY_H_
#define CHROME_BROWSER_SWAN_SWAN_URL_SAFETY_H_

class GURL;

namespace swan {

// String-level check for URLs that CODA may fetch on the user's behalf (search
// results). Rejects non-http(s) schemes, embedded credentials, localhost and
// internal-looking host names, IPv6 literals, and non-public IPv4 literals.
//
// This is only the first line of defence: the request itself is also sent with
// Local Network Access policy "block" (see SwanFetcher), which stops requests
// whose *resolved* address is local, including DNS rebinding and redirects.
// Mirrors isSafeWebUrl() in chrome/browser/resources/swan/coda_client.ts.
bool IsSafeWebUrl(const GURL& url);

// True for the OAuth loopback callback, e.g. http://127.0.0.1:53211/callback?...
// The login tab cancels this navigation before any network request.
bool IsLoopbackCallbackUrl(const GURL& url);

}  // namespace swan

#endif  // CHROME_BROWSER_SWAN_SWAN_URL_SAFETY_H_
