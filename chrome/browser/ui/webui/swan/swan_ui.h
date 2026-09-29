// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_WEBUI_SWAN_SWAN_UI_H_
#define CHROME_BROWSER_UI_WEBUI_SWAN_SWAN_UI_H_

#include "chrome/common/webui_url_constants.h"
#include "content/public/browser/web_ui_controller.h"
#include "content/public/browser/webui_config.h"
#include "content/public/common/url_constants.h"

namespace swan {

class SwanUI;

class SwanUIConfig : public content::DefaultWebUIConfig<SwanUI> {
 public:
  SwanUIConfig()
      : DefaultWebUIConfig(content::kChromeUIScheme,
                           chrome::kChromeUISwanHost) {}
};

// chrome://swan — SWAN's CODA panel.
class SwanUI : public content::WebUIController {
 public:
  explicit SwanUI(content::WebUI* web_ui);
  SwanUI(const SwanUI&) = delete;
  SwanUI& operator=(const SwanUI&) = delete;
  ~SwanUI() override;
};

}  // namespace swan

#endif  // CHROME_BROWSER_UI_WEBUI_SWAN_SWAN_UI_H_
