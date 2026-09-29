// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/webui/swan/swan_handler.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/swan/swan_login_tab_helper.h"
#include "chrome/browser/swan/swan_prefs.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"

namespace swan {

namespace {

// Setting keys used by the page -> pref names.
const char* PrefForSetting(const std::string& key) {
  if (key == "autoSearch") {
    return prefs::kAutoSearchEnabled;
  }
  if (key == "webSearch") {
    return prefs::kWebSearchEnabled;
  }
  if (key == "pageContext") {
    return prefs::kPageContextEnabled;
  }
  return nullptr;
}

}  // namespace

SwanHandler::SwanHandler(Profile* profile)
    : profile_(profile),
      token_store_(profile->GetPrefs()),
      fetcher_(profile) {}

SwanHandler::~SwanHandler() = default;

void SwanHandler::RegisterMessages() {
  web_ui()->RegisterMessageCallback(
      "swanTokenLoad", base::BindRepeating(&SwanHandler::HandleTokenLoad,
                                           base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "swanTokenSave", base::BindRepeating(&SwanHandler::HandleTokenSave,
                                           base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "swanTokenClear", base::BindRepeating(&SwanHandler::HandleTokenClear,
                                            base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "swanGetSettings", base::BindRepeating(&SwanHandler::HandleGetSettings,
                                             base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "swanSetSetting", base::BindRepeating(&SwanHandler::HandleSetSetting,
                                            base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "swanFetch",
      base::BindRepeating(&SwanHandler::HandleFetch, base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "swanLoginStart", base::BindRepeating(&SwanHandler::HandleLoginStart,
                                            base::Unretained(this)));
  web_ui()->RegisterMessageCallback(
      "swanGetActiveTabText",
      base::BindRepeating(&SwanHandler::HandleGetActiveTabText,
                          base::Unretained(this)));
}

void SwanHandler::OnJavascriptDisallowed() {
  weak_factory_.InvalidateWeakPtrs();
}

void SwanHandler::Reject(const base::Value& callback_id,
                         const std::string& error) {
  if (IsJavascriptAllowed()) {
    RejectJavascriptCallback(callback_id, base::Value(error));
  }
}

// ── tokens ──────────────────────────────────────────────────────────────────

void SwanHandler::HandleTokenLoad(const base::ListValue& args) {
  AllowJavascript();
  const base::Value& id = args[0];
  if (profile_->IsOffTheRecord()) {
    ResolveJavascriptCallback(id, base::Value());
    return;
  }
  token_store_.Load(base::BindOnce(&SwanHandler::OnTokenLoaded,
                                   weak_factory_.GetWeakPtr(), id.Clone()));
}

void SwanHandler::OnTokenLoaded(base::Value callback_id,
                                std::optional<std::string> json) {
  if (!IsJavascriptAllowed()) {
    return;
  }
  ResolveJavascriptCallback(
      callback_id, json ? base::Value(std::move(*json)) : base::Value());
}

void SwanHandler::HandleTokenSave(const base::ListValue& args) {
  AllowJavascript();
  const base::Value& id = args[0];
  if (profile_->IsOffTheRecord() || args.size() < 2 || !args[1].is_string()) {
    ResolveJavascriptCallback(id, base::Value(false));
    return;
  }
  token_store_.Save(args[1].GetString(),
                    base::BindOnce(&SwanHandler::OnTokenSaved,
                                   weak_factory_.GetWeakPtr(), id.Clone()));
}

void SwanHandler::OnTokenSaved(base::Value callback_id, bool success) {
  if (IsJavascriptAllowed()) {
    ResolveJavascriptCallback(callback_id, base::Value(success));
  }
}

void SwanHandler::HandleTokenClear(const base::ListValue& args) {
  AllowJavascript();
  token_store_.Clear();
  ResolveJavascriptCallback(args[0], base::Value());
}

// ── settings ────────────────────────────────────────────────────────────────

void SwanHandler::HandleGetSettings(const base::ListValue& args) {
  AllowJavascript();
  PrefService* prefs = profile_->GetPrefs();
  base::DictValue settings;
  settings.Set("autoSearch", prefs->GetBoolean(prefs::kAutoSearchEnabled));
  settings.Set("webSearch", prefs->GetBoolean(prefs::kWebSearchEnabled));
  settings.Set("pageContext", prefs->GetBoolean(prefs::kPageContextEnabled));
  ResolveJavascriptCallback(args[0], settings);
}

void SwanHandler::HandleSetSetting(const base::ListValue& args) {
  AllowJavascript();
  const base::Value& id = args[0];
  const char* pref = nullptr;
  if (args.size() >= 3 && args[1].is_string() && args[2].is_bool()) {
    pref = PrefForSetting(args[1].GetString());
  }
  if (!pref) {
    Reject(id, "invalid_setting");
    return;
  }
  profile_->GetPrefs()->SetBoolean(pref, args[2].GetBool());
  ResolveJavascriptCallback(id, base::Value());
}

// ── restricted HTTP ─────────────────────────────────────────────────────────

void SwanHandler::HandleFetch(const base::ListValue& args) {
  AllowJavascript();
  const base::Value& id = args[0];
  const base::DictValue* dict = args.size() >= 2 ? args[1].GetIfDict() : nullptr;
  const std::string* url = dict ? dict->FindString("url") : nullptr;
  if (!url) {
    Reject(id, "invalid_request");
    return;
  }

  SwanFetchRequest request;
  request.url = GURL(*url);
  if (const std::string* method = dict->FindString("method")) {
    request.method = base::ToUpperASCII(*method);
  }
  if (const base::DictValue* headers = dict->FindDict("headers")) {
    for (const auto [name, value] : *headers) {
      if (value.is_string()) {
        request.headers.emplace_back(name, value.GetString());
      }
    }
  }
  if (const std::string* body = dict->FindString("body")) {
    request.body = *body;
  }
  const std::string* mode = dict->FindString("mode");
  request.mode = (mode && *mode == "web") ? SwanFetchRequest::Mode::kWeb
                                          : SwanFetchRequest::Mode::kSwn;
  if (std::optional<double> max_bytes = dict->FindDouble("maxBytes")) {
    request.max_bytes = static_cast<size_t>(std::max(0.0, *max_bytes));
  }

  fetcher_.Fetch(std::move(request),
                 base::BindOnce(&SwanHandler::OnFetchDone,
                                weak_factory_.GetWeakPtr(), id.Clone()));
}

void SwanHandler::OnFetchDone(base::Value callback_id,
                              SwanFetchResponse response) {
  if (!IsJavascriptAllowed()) {
    return;
  }
  base::DictValue result;
  result.Set("status", response.status);
  result.Set("error", response.error);
  base::DictValue headers;
  for (const auto& [name, value] : response.headers) {
    headers.Set(name, value);
  }
  result.Set("headers", std::move(headers));
  result.Set("body", std::move(response.body));
  ResolveJavascriptCallback(callback_id, result);
}

// ── login ───────────────────────────────────────────────────────────────────

void SwanHandler::HandleLoginStart(const base::ListValue& args) {
  AllowJavascript();
  const base::Value& id = args[0];
  const GURL url(args.size() >= 2 && args[1].is_string() ? args[1].GetString()
                                                         : std::string());
  // Only the SWAN OAuth authorize endpoint may be opened by the page.
  if (profile_->IsOffTheRecord() || !url.is_valid() ||
      !url.SchemeIs("https") || url.host() != SwanFetcher::kSwnHost ||
      url.path() != "/oauth/authorize" || !url.has_query()) {
    Reject(id, "invalid_request");
    return;
  }

  NavigateParams params(profile_, url, ui::PAGE_TRANSITION_LINK);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);
  content::WebContents* tab = params.navigated_or_inserted_contents;
  if (!tab) {
    Reject(id, "cannot_open_tab");
    return;
  }
  // The OAuth server ends the flow with a redirect to the loopback callback;
  // the tab's navigation throttle cancels it and reports the URL here.
  SwanLoginTabHelper::Attach(
      tab, base::BindOnce(&SwanHandler::OnLoginResult,
                          weak_factory_.GetWeakPtr(), id.Clone()));
}

void SwanHandler::OnLoginResult(base::Value callback_id,
                                std::optional<GURL> callback_url,
                                std::string error) {
  if (!IsJavascriptAllowed()) {
    return;
  }
  if (callback_url) {
    ResolveJavascriptCallback(callback_id, base::Value(callback_url->spec()));
  } else {
    Reject(callback_id, error.empty() ? "cancelled" : error);
  }
}

// ── page context ────────────────────────────────────────────────────────────

void SwanHandler::HandleGetActiveTabText(const base::ListValue& args) {
  AllowJavascript();
  const base::Value& id = args[0];
  if (!profile_->GetPrefs()->GetBoolean(prefs::kPageContextEnabled)) {
    Reject(id, "page_context_disabled");
    return;
  }
  SwanPageContext::ReadText(
      SwanPageContext::RecordedTab(),
      base::BindOnce(&SwanHandler::OnPageText, weak_factory_.GetWeakPtr(),
                     id.Clone()));
}

void SwanHandler::OnPageText(base::Value callback_id,
                             std::optional<PageText> page,
                             std::string error) {
  if (!IsJavascriptAllowed()) {
    return;
  }
  if (!page) {
    Reject(callback_id, error.empty() ? "unreadable" : error);
    return;
  }
  base::DictValue result;
  result.Set("url", page->url);
  result.Set("title", page->title);
  result.Set("text", page->text);
  ResolveJavascriptCallback(callback_id, result);
}

}  // namespace swan
