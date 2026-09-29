// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/swan/swan_login_tab_helper.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/swan/swan_url_safety.h"
#include "content/public/browser/web_contents.h"

namespace swan {

namespace {

void CloseTab(base::WeakPtr<content::WebContents> web_contents) {
  if (web_contents) {
    web_contents->ClosePage();
  }
}

}  // namespace

WEB_CONTENTS_USER_DATA_KEY_IMPL(SwanLoginTabHelper);

// static
void SwanLoginTabHelper::Attach(content::WebContents* web_contents,
                                Callback callback) {
  if (SwanLoginTabHelper* existing = FromWebContents(web_contents)) {
    existing->Restart(std::move(callback));
    return;
  }
  CreateForWebContents(web_contents, std::move(callback));
}

void SwanLoginTabHelper::Restart(Callback callback) {
  if (callback_) {
    std::move(callback_).Run(std::nullopt, "cancelled");
  }
  callback_ = std::move(callback);
  timer_.Start(FROM_HERE, kLoginTimeout,
               base::BindOnce(&SwanLoginTabHelper::OnTimeout,
                              base::Unretained(this)));
}

SwanLoginTabHelper::SwanLoginTabHelper(content::WebContents* web_contents,
                                       Callback callback)
    : content::WebContentsObserver(web_contents),
      content::WebContentsUserData<SwanLoginTabHelper>(*web_contents),
      callback_(std::move(callback)) {
  timer_.Start(FROM_HERE, kLoginTimeout,
               base::BindOnce(&SwanLoginTabHelper::OnTimeout,
                              base::Unretained(this)));
}

SwanLoginTabHelper::~SwanLoginTabHelper() = default;

bool SwanLoginTabHelper::HandleNavigation(const GURL& url) {
  if (!IsLoopbackCallbackUrl(url)) {
    return false;
  }
  Finish(url, std::string());
  return true;
}

void SwanLoginTabHelper::WebContentsDestroyed() {
  // The user closed the login tab before finishing.
  if (callback_) {
    std::move(callback_).Run(std::nullopt, "cancelled");
  }
}

void SwanLoginTabHelper::OnTimeout() {
  Finish(std::nullopt, "timeout");
}

void SwanLoginTabHelper::Finish(std::optional<GURL> callback_url,
                                std::string error) {
  timer_.Stop();
  if (!callback_) {
    return;
  }
  std::move(callback_).Run(std::move(callback_url), std::move(error));
  // Closing a tab from inside a navigation throttle is not safe: do it on the
  // next turn of the message loop.
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(&CloseTab, web_contents()->GetWeakPtr()));
}

}  // namespace swan
