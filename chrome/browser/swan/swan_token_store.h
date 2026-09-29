// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SWAN_SWAN_TOKEN_STORE_H_
#define CHROME_BROWSER_SWAN_SWAN_TOKEN_STORE_H_

#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"

class PrefService;

namespace os_crypt_async {
class Encryptor;
}  // namespace os_crypt_async

namespace swan {

// Stores the OAuth token JSON encrypted with OSCryptAsync (DPAPI-backed on
// Windows) in a profile pref. The encryptor is obtained asynchronously, so all
// operations are asynchronous and must be called on the UI thread.
class SwanTokenStore {
 public:
  using LoadCallback = base::OnceCallback<void(std::optional<std::string>)>;
  using SaveCallback = base::OnceCallback<void(bool success)>;

  // Tokens are a few hundred bytes; refuse anything absurd.
  static constexpr size_t kMaxTokenJsonBytes = 16 * 1024;

  explicit SwanTokenStore(PrefService* prefs);
  SwanTokenStore(const SwanTokenStore&) = delete;
  SwanTokenStore& operator=(const SwanTokenStore&) = delete;
  ~SwanTokenStore();

  // Runs |callback| with the decrypted JSON, or nullopt when nothing is stored
  // or it can no longer be decrypted (treated as "logged out").
  void Load(LoadCallback callback);
  void Save(std::string json, SaveCallback callback);
  void Clear();

 private:
  void DoLoad(LoadCallback callback,
              scoped_refptr<os_crypt_async::Encryptor> encryptor);
  void DoSave(std::string json,
              SaveCallback callback,
              scoped_refptr<os_crypt_async::Encryptor> encryptor);

  raw_ptr<PrefService> prefs_;
  base::WeakPtrFactory<SwanTokenStore> weak_factory_{this};
};

}  // namespace swan

#endif  // CHROME_BROWSER_SWAN_SWAN_TOKEN_STORE_H_
