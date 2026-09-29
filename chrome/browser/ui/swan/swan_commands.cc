// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/swan/swan_commands.h"

#include <string>

#include "base/metrics/user_metrics.h"
#include "chrome/browser/swan/swan_page_context.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/singleton_tabs.h"
#include "chrome/common/webui_url_constants.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "url/gurl.h"

namespace swan {

void ShowSwanPanel(BrowserWindowInterface* browser) {
  base::RecordAction(base::UserMetricsAction("ShowSwanPanel"));

  if (tabs::TabInterface* tab = browser->GetActiveTabInterface()) {
    content::WebContents* contents = tab->GetContents();
    const GURL& url = contents->GetLastCommittedURL();
    const bool is_panel = url.SchemeIs(content::kChromeUIScheme) &&
                          url.host() == chrome::kChromeUISwanHost;
    if (!is_panel) {
      SwanPageContext::RecordTab(contents);
    }
  }

  ShowSingletonTab(
      browser, GURL(std::string(content::kChromeUIScheme) + "://" +
                    chrome::kChromeUISwanHost + "/"));
}

}  // namespace swan
