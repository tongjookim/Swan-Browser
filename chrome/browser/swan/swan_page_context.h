// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SWAN_SWAN_PAGE_CONTEXT_H_
#define CHROME_BROWSER_SWAN_SWAN_PAGE_CONTEXT_H_

#include <optional>
#include <string>

#include "base/functional/callback.h"

namespace content {
class WebContents;
}  // namespace content

namespace swan {

struct PageText {
  std::string url;
  std::string title;
  std::string text;  // at most kMaxChars UTF-16 code units
};

// Reads the visible text of a tab so CODA can summarize it, ONLY on an
// explicit user request and only when the user enabled "page context".
//
// Never read: incognito tabs, non-http(s) pages (chrome://, file://, ...),
// pages that contain a password field or a payment-card field. The text is
// cut to kMaxChars before it leaves the renderer.
class SwanPageContext {
 public:
  static constexpr int kMaxChars = 4000;

  using Callback =
      base::OnceCallback<void(std::optional<PageText> page, std::string error)>;

  // Remembers the tab the user was looking at before opening chrome://swan
  // (the panel itself is a tab, so "the active tab" would be the panel).
  static void RecordTab(content::WebContents* tab);
  static content::WebContents* RecordedTab();

  // Reads |tab| if the rules above allow it. |callback| always runs, with a
  // non-empty error when the page was refused or could not be read.
  static void ReadText(content::WebContents* tab, Callback callback);
};

}  // namespace swan

#endif  // CHROME_BROWSER_SWAN_SWAN_PAGE_CONTEXT_H_
