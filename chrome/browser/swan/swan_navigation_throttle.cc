// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/swan/swan_navigation_throttle.h"

#include <memory>

#include "chrome/browser/swan/swan_login_tab_helper.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/web_contents.h"

namespace swan {

// static
void SwanNavigationThrottle::MaybeCreateAndAdd(
    content::NavigationThrottleRegistry& registry) {
  content::NavigationHandle& handle = registry.GetNavigationHandle();
  if (!handle.IsInPrimaryMainFrame()) {
    return;
  }
  if (!SwanLoginTabHelper::FromWebContents(handle.GetWebContents())) {
    return;
  }
  registry.AddThrottle(std::make_unique<SwanNavigationThrottle>(registry));
}

SwanNavigationThrottle::SwanNavigationThrottle(
    content::NavigationThrottleRegistry& registry)
    : content::NavigationThrottle(registry) {}

SwanNavigationThrottle::~SwanNavigationThrottle() = default;

content::NavigationThrottle::ThrottleCheckResult
SwanNavigationThrottle::WillStartRequest() {
  return CheckUrl();
}

// The OAuth server ends the flow with a 302 to the loopback callback, so the
// redirect is the case that matters in practice.
content::NavigationThrottle::ThrottleCheckResult
SwanNavigationThrottle::WillRedirectRequest() {
  return CheckUrl();
}

content::NavigationThrottle::ThrottleCheckResult
SwanNavigationThrottle::CheckUrl() {
  content::NavigationHandle& handle = *navigation_handle();
  SwanLoginTabHelper* helper =
      SwanLoginTabHelper::FromWebContents(handle.GetWebContents());
  if (helper && helper->HandleNavigation(handle.GetURL())) {
    return CANCEL_AND_IGNORE;
  }
  return PROCEED;
}

const char* SwanNavigationThrottle::GetNameForLogging() {
  return "SwanNavigationThrottle";
}

}  // namespace swan
