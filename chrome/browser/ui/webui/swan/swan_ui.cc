// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/webui/swan/swan_ui.h"

#include <memory>

#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/webui/swan/swan_handler.h"
#include "chrome/grit/swan_resources.h"
#include "chrome/grit/swan_resources_map.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "ui/webui/webui_util.h"

namespace swan {

SwanUI::SwanUI(content::WebUI* web_ui) : content::WebUIController(web_ui) {
  Profile* profile = Profile::FromWebUI(web_ui);

  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      profile, chrome::kChromeUISwanHost);
  webui::SetupWebUIDataSource(source, kSwanResources, IDR_SWAN_SWAN_HTML);

  // The page must not talk to the network itself: OAuth, the CODA gateway and
  // web search all go through SwanHandler / SwanFetcher, which enforce the
  // host, path and address restrictions.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::ConnectSrc, "connect-src 'none';");

  web_ui->AddMessageHandler(std::make_unique<SwanHandler>(profile));
}

SwanUI::~SwanUI() = default;

}  // namespace swan
