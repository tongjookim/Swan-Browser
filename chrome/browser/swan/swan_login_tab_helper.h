// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SWAN_SWAN_LOGIN_TAB_HELPER_H_
#define CHROME_BROWSER_SWAN_SWAN_LOGIN_TAB_HELPER_H_

#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/timer/timer.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/gurl.h"

namespace swan {

// Marks a tab as SWAN's OAuth login tab. The OAuth server ends the login by
// redirecting to the loopback callback (http://127.0.0.1:<port>/callback?code=
// ...&state=...). SwanNavigationThrottle cancels that navigation before any
// network request and hands the URL to this helper, so no local port is ever
// opened and no other local process can intercept the code.
//
// The callback runs exactly once: with the callback URL on success, or with an
// error ("cancelled" when the tab is closed, "timeout" after kLoginTimeout).
class SwanLoginTabHelper
    : public content::WebContentsObserver,
      public content::WebContentsUserData<SwanLoginTabHelper> {
 public:
  using Callback =
      base::OnceCallback<void(std::optional<GURL> callback_url,
                              std::string error)>;

  static constexpr base::TimeDelta kLoginTimeout = base::Minutes(5);

  // Turns |web_contents| into a login tab. Replaces a previous login state.
  static void Attach(content::WebContents* web_contents, Callback callback);

  SwanLoginTabHelper(const SwanLoginTabHelper&) = delete;
  SwanLoginTabHelper& operator=(const SwanLoginTabHelper&) = delete;
  ~SwanLoginTabHelper() override;

  // Called by the throttle for every navigation in this tab. Returns true when
  // |url| is the loopback callback: it has been consumed and the navigation
  // must be cancelled.
  bool HandleNavigation(const GURL& url);

  // Starts a new login attempt in a tab that already has a helper; the
  // previous attempt (if still pending) is reported as "cancelled".
  void Restart(Callback callback);

  // content::WebContentsObserver:
  void WebContentsDestroyed() override;

 private:
  friend class content::WebContentsUserData<SwanLoginTabHelper>;

  SwanLoginTabHelper(content::WebContents* web_contents, Callback callback);

  void Finish(std::optional<GURL> callback_url, std::string error);
  void OnTimeout();

  Callback callback_;
  base::OneShotTimer timer_;

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace swan

#endif  // CHROME_BROWSER_SWAN_SWAN_LOGIN_TAB_HELPER_H_
