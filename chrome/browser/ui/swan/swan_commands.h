// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_SWAN_SWAN_COMMANDS_H_
#define CHROME_BROWSER_UI_SWAN_SWAN_COMMANDS_H_

class BrowserWindowInterface;

namespace swan {

// Opens (or focuses) chrome://swan, SWAN's CODA panel. Before switching to it
// the tab the user was looking at is remembered so that "summarize this page"
// can refer to it (the panel itself is a tab).
void ShowSwanPanel(BrowserWindowInterface* browser);

}  // namespace swan

#endif  // CHROME_BROWSER_UI_SWAN_SWAN_COMMANDS_H_
