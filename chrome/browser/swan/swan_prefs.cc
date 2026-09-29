// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/swan/swan_prefs.h"

#include "components/prefs/pref_registry_simple.h"

namespace swan {

void RegisterProfilePrefs(PrefRegistrySimple* registry) {
  registry->RegisterStringPref(prefs::kEncryptedTokens, std::string());
  registry->RegisterBooleanPref(prefs::kAutoSearchEnabled, true);
  registry->RegisterBooleanPref(prefs::kWebSearchEnabled, false);
  registry->RegisterBooleanPref(prefs::kPageContextEnabled, false);
}

}  // namespace swan
