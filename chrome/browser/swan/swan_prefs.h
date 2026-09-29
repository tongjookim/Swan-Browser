// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SWAN_SWAN_PREFS_H_
#define CHROME_BROWSER_SWAN_SWAN_PREFS_H_

class PrefRegistrySimple;

namespace swan {
namespace prefs {

// OAuth tokens as JSON, encrypted with OSCryptAsync (DPAPI on Windows) and
// base64-encoded. Never stored in plain text.
inline constexpr char kEncryptedTokens[] = "swan.auth.encrypted_tokens";

// CODA asks the server's corpus again when the first answer has no evidence.
inline constexpr char kAutoSearchEnabled[] = "swan.coda.auto_search";

// Browser-side web search (DuckDuckGo). Off by default; the user opts in.
inline constexpr char kWebSearchEnabled[] = "swan.coda.web_search";

// Sending the active tab's text to CODA for a summary, on explicit request.
inline constexpr char kPageContextEnabled[] = "swan.coda.page_context";

}  // namespace prefs

// Registers SWAN's profile prefs. Local-only: none of these are synced.
void RegisterProfilePrefs(PrefRegistrySimple* registry);

}  // namespace swan

#endif  // CHROME_BROWSER_SWAN_SWAN_PREFS_H_
