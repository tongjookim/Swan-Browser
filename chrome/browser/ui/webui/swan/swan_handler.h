// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_WEBUI_SWAN_SWAN_HANDLER_H_
#define CHROME_BROWSER_UI_WEBUI_SWAN_SWAN_HANDLER_H_

#include <optional>
#include <string>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "chrome/browser/swan/swan_fetcher.h"
#include "chrome/browser/swan/swan_page_context.h"
#include "chrome/browser/swan/swan_token_store.h"
#include "content/public/browser/web_ui_message_handler.h"
#include "url/gurl.h"

class Profile;

namespace swan {

// Browser-process side of chrome://swan. The page has no network access of its
// own (CSP connect-src 'none'); everything goes through these messages:
//
//   swanTokenLoad/Save/Clear   encrypted OAuth token storage
//   swanGetSettings/SetSetting per-profile CODA options
//   swanFetch                  restricted HTTP (SwanFetcher)
//   swanLoginStart             opens the login tab, resolves with callback URL
//   swanGetActiveTabText       text of the tab the user came from (opt-in)
class SwanHandler : public content::WebUIMessageHandler {
 public:
  explicit SwanHandler(Profile* profile);
  SwanHandler(const SwanHandler&) = delete;
  SwanHandler& operator=(const SwanHandler&) = delete;
  ~SwanHandler() override;

  // content::WebUIMessageHandler:
  void RegisterMessages() override;
  void OnJavascriptDisallowed() override;

 private:
  void HandleTokenLoad(const base::ListValue& args);
  void HandleTokenSave(const base::ListValue& args);
  void HandleTokenClear(const base::ListValue& args);
  void HandleGetSettings(const base::ListValue& args);
  void HandleSetSetting(const base::ListValue& args);
  void HandleFetch(const base::ListValue& args);
  void HandleLoginStart(const base::ListValue& args);
  void HandleGetActiveTabText(const base::ListValue& args);

  void OnTokenLoaded(base::Value callback_id, std::optional<std::string> json);
  void OnTokenSaved(base::Value callback_id, bool success);
  void OnFetchDone(base::Value callback_id, SwanFetchResponse response);
  void OnLoginResult(base::Value callback_id,
                     std::optional<GURL> callback_url,
                     std::string error);
  void OnPageText(base::Value callback_id,
                  std::optional<PageText> page,
                  std::string error);

  void Reject(const base::Value& callback_id, const std::string& error);

  raw_ptr<Profile> profile_;
  SwanTokenStore token_store_;
  SwanFetcher fetcher_;
  base::WeakPtrFactory<SwanHandler> weak_factory_{this};
};

}  // namespace swan

#endif  // CHROME_BROWSER_UI_WEBUI_SWAN_SWAN_HANDLER_H_
