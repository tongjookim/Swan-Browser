// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/swan/swan_page_context.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "url/gurl.h"

namespace swan {

namespace {

base::WeakPtr<content::WebContents>& RecordedTabSlot() {
  static base::NoDestructor<base::WeakPtr<content::WebContents>> slot;
  return *slot;
}

// Runs in an isolated world of the page (cannot be tampered with by the
// page's own scripts). The decision to refuse password / payment pages is made
// here, *before* any text is returned to the browser process.
constexpr char16_t kReadScript[] =
    u"(function() {"
    u"  try {"
    u"    if (document.querySelector('input[type=password]')) {"
    u"      return {blocked: 'password'};"
    u"    }"
    u"    if (document.querySelector('input[autocomplete^=\"cc-\"]')) {"
    u"      return {blocked: 'payment'};"
    u"    }"
    u"    var t = (document.body && document.body.innerText) || '';"
    u"    return {text: t.slice(0, 4000), title: document.title || ''};"
    u"  } catch (e) {"
    u"    return {blocked: 'error'};"
    u"  }"
    u"})()";

void OnScriptResult(GURL url,
                    SwanPageContext::Callback callback,
                    base::Value result) {
  const base::DictValue* dict = result.GetIfDict();
  if (!dict) {
    std::move(callback).Run(std::nullopt, "unreadable");
    return;
  }
  if (const std::string* blocked = dict->FindString("blocked")) {
    std::move(callback).Run(std::nullopt, "blocked_" + *blocked);
    return;
  }
  const std::string* text = dict->FindString("text");
  if (!text) {
    std::move(callback).Run(std::nullopt, "unreadable");
    return;
  }
  PageText page;
  page.url = url.spec();
  if (const std::string* title = dict->FindString("title")) {
    page.title = *title;
  }
  page.text = *text;
  std::move(callback).Run(std::move(page), std::string());
}

}  // namespace

// static
void SwanPageContext::RecordTab(content::WebContents* tab) {
  RecordedTabSlot() = tab ? tab->GetWeakPtr() : nullptr;
}

// static
content::WebContents* SwanPageContext::RecordedTab() {
  return RecordedTabSlot().get();
}

// static
void SwanPageContext::ReadText(content::WebContents* tab, Callback callback) {
  if (!tab) {
    std::move(callback).Run(std::nullopt, "no_page");
    return;
  }
  Profile* profile = Profile::FromBrowserContext(tab->GetBrowserContext());
  if (!profile || profile->IsOffTheRecord()) {
    std::move(callback).Run(std::nullopt, "incognito_not_allowed");
    return;
  }
  const GURL url = tab->GetLastCommittedURL();
  if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS()) {
    std::move(callback).Run(std::nullopt, "unsupported_page");
    return;
  }
  content::RenderFrameHost* frame = tab->GetPrimaryMainFrame();
  if (!frame || !frame->IsRenderFrameLive()) {
    std::move(callback).Run(std::nullopt, "no_page");
    return;
  }
  frame->ExecuteJavaScriptInIsolatedWorld(
      kReadScript,
      base::BindOnce(&OnScriptResult, url, std::move(callback)),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

}  // namespace swan
