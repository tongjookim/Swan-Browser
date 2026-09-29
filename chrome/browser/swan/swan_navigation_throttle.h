// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SWAN_SWAN_NAVIGATION_THROTTLE_H_
#define CHROME_BROWSER_SWAN_SWAN_NAVIGATION_THROTTLE_H_

#include "content/public/browser/navigation_throttle.h"

namespace content {
class NavigationThrottleRegistry;
}  // namespace content

namespace swan {

// Cancels the OAuth loopback callback navigation in a SwanLoginTabHelper tab
// and passes the URL to the helper. Added only for the primary main frame of
// tabs that have a SwanLoginTabHelper.
class SwanNavigationThrottle : public content::NavigationThrottle {
 public:
  static void MaybeCreateAndAdd(content::NavigationThrottleRegistry& registry);

  explicit SwanNavigationThrottle(content::NavigationThrottleRegistry& registry);
  SwanNavigationThrottle(const SwanNavigationThrottle&) = delete;
  SwanNavigationThrottle& operator=(const SwanNavigationThrottle&) = delete;
  ~SwanNavigationThrottle() override;

  // content::NavigationThrottle:
  ThrottleCheckResult WillStartRequest() override;
  ThrottleCheckResult WillRedirectRequest() override;
  const char* GetNameForLogging() override;

 private:
  ThrottleCheckResult CheckUrl();
};

}  // namespace swan

#endif  // CHROME_BROWSER_SWAN_SWAN_NAVIGATION_THROTTLE_H_
