// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_UTILITY_IMPORTER_CHROMIUM_IMPORTER_H_
#define CHROME_UTILITY_IMPORTER_CHROMIUM_IMPORTER_H_

#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/values.h"
#include "chrome/utility/importer/importer.h"
#include "components/user_data_importer/common/imported_bookmark_entry.h"

namespace importer {

// Imports bookmarks and browsing history from a profile of a Chromium-based
// browser (Google Chrome, Microsoft Edge). |SourceProfile::source_path| is the
// profile directory, e.g.
//   %LOCALAPPDATA%\Google\Chrome\User Data\Default
//
// Passwords and cookies are deliberately NOT read: they are encrypted with
// DPAPI and, in current Chrome/Edge versions, with App-Bound Encryption that
// only the owning browser is meant to unlock. Passwords are migrated through
// the browser's own CSV export + SWAN's password importer.
class ChromiumImporter : public Importer {
 public:
  ChromiumImporter();
  ChromiumImporter(const ChromiumImporter&) = delete;
  ChromiumImporter& operator=(const ChromiumImporter&) = delete;

  // Importer:
  void StartImport(const user_data_importer::SourceProfile& source_profile,
                   uint16_t items,
                   ImporterBridge* bridge) override;

  // Exposed for unit tests.
  static std::vector<user_data_importer::ImportedBookmarkEntry>
  ParseBookmarksJson(const std::string& json);

 private:
  ~ChromiumImporter() override;

  void ImportBookmarks(const base::FilePath& profile_dir);
  void ImportHistory(const base::FilePath& profile_dir);
};

}  // namespace importer

#endif  // CHROME_UTILITY_IMPORTER_CHROMIUM_IMPORTER_H_
