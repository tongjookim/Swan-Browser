// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/swan/swan_token_store.h"

#include <utility>

#include "base/base64.h"
#include "base/functional/bind.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/swan/swan_prefs.h"
#include "components/os_crypt/async/browser/os_crypt_async.h"
#include "components/os_crypt/async/common/encryptor.h"
#include "components/prefs/pref_service.h"

namespace swan {

SwanTokenStore::SwanTokenStore(PrefService* prefs) : prefs_(prefs) {}

SwanTokenStore::~SwanTokenStore() = default;

void SwanTokenStore::Load(LoadCallback callback) {
  if (prefs_->GetString(prefs::kEncryptedTokens).empty()) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  g_browser_process->os_crypt_async()->GetInstance(base::BindOnce(
      &SwanTokenStore::DoLoad, weak_factory_.GetWeakPtr(),
      std::move(callback)));
}

void SwanTokenStore::DoLoad(
    LoadCallback callback,
    scoped_refptr<os_crypt_async::Encryptor> encryptor) {
  std::string ciphertext;
  std::string plaintext;
  if (!base::Base64Decode(prefs_->GetString(prefs::kEncryptedTokens),
                          &ciphertext) ||
      !encryptor->DecryptString(ciphertext, &plaintext)) {
    // Corrupt or undecryptable (e.g. profile moved to another Windows user):
    // behave as logged out and drop the unusable blob.
    prefs_->ClearPref(prefs::kEncryptedTokens);
    std::move(callback).Run(std::nullopt);
    return;
  }
  std::move(callback).Run(std::move(plaintext));
}

void SwanTokenStore::Save(std::string json, SaveCallback callback) {
  if (json.empty() || json.size() > kMaxTokenJsonBytes) {
    std::move(callback).Run(false);
    return;
  }
  g_browser_process->os_crypt_async()->GetInstance(base::BindOnce(
      &SwanTokenStore::DoSave, weak_factory_.GetWeakPtr(), std::move(json),
      std::move(callback)));
}

void SwanTokenStore::DoSave(
    std::string json,
    SaveCallback callback,
    scoped_refptr<os_crypt_async::Encryptor> encryptor) {
  std::string ciphertext;
  if (!encryptor->EncryptString(json, &ciphertext)) {
    // Never fall back to storing plain text.
    std::move(callback).Run(false);
    return;
  }
  prefs_->SetString(prefs::kEncryptedTokens, base::Base64Encode(ciphertext));
  std::move(callback).Run(true);
}

void SwanTokenStore::Clear() {
  prefs_->ClearPref(prefs::kEncryptedTokens);
}

}  // namespace swan
