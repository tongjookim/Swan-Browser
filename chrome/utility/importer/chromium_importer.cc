// Copyright 2026 The Suwan News Company. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/utility/importer/chromium_importer.h"

#include <algorithm>
#include <optional>
#include <utility>

#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "base/json/json_reader.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "chrome/common/importer/importer_bridge.h"
#include "chrome/grit/generated_resources.h"
#include "components/user_data_importer/common/importer_data_types.h"
#include "components/user_data_importer/common/importer_url_row.h"
#include "sql/database.h"
#include "sql/statement.h"
#include "url/gurl.h"

namespace importer {

namespace {

inline constexpr sql::Database::Tag kDatabaseTag{"ChromiumImporter"};

// The bookmarks file of a real profile is a few MB; refuse absurd inputs.
constexpr int64_t kMaxBookmarksFileBytes = 64 * 1024 * 1024;
// Bound memory and IPC volume for very old profiles.
constexpr int kMaxHistoryRows = 100000;

// Chromium stores times as microseconds since 1601-01-01 (Windows epoch).
base::Time FromWindowsEpochMicros(int64_t micros) {
  return base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(micros));
}

bool CanImportUrl(const GURL& url) {
  return url.is_valid() &&
         (url.SchemeIsHTTPOrHTTPS() || url.SchemeIs("ftp") ||
          url.SchemeIsFile());
}

void WalkBookmarkNode(const base::DictValue& node,
                      const std::vector<std::u16string>& ancestors,
                      bool in_toolbar,
                      bool is_root,
                      std::vector<user_data_importer::ImportedBookmarkEntry>*
                          out) {
  const std::string* type = node.FindString("type");
  const std::string* name = node.FindString("name");
  const std::u16string title = name ? base::UTF8ToUTF16(*name) : std::u16string();

  if (type && *type == "url") {
    const std::string* url_string = node.FindString("url");
    if (!url_string) {
      return;
    }
    GURL url(*url_string);
    if (!CanImportUrl(url)) {
      return;
    }
    user_data_importer::ImportedBookmarkEntry entry;
    entry.in_toolbar = in_toolbar;
    entry.is_folder = false;
    entry.url = url;
    entry.path = ancestors;
    entry.title = title;
    if (const std::string* added = node.FindString("date_added")) {
      int64_t micros = 0;
      if (base::StringToInt64(*added, &micros) && micros > 0) {
        entry.creation_time = FromWindowsEpochMicros(micros);
      }
    }
    out->push_back(std::move(entry));
    return;
  }

  const base::ListValue* children = node.FindList("children");
  if (!children) {
    return;
  }

  // ProfileWriter builds the folder chain from |path|; for the root of the
  // toolbar it skips path[0] itself, so roots contribute their own name.
  std::vector<std::u16string> path = ancestors;
  path.push_back(title);

  if (children->empty() && !is_root) {
    // Folders are created implicitly for their children; only empty ones need
    // an explicit entry.
    user_data_importer::ImportedBookmarkEntry entry;
    entry.in_toolbar = in_toolbar;
    entry.is_folder = true;
    entry.path = ancestors;
    entry.title = title;
    out->push_back(std::move(entry));
    return;
  }
  for (const base::Value& child : *children) {
    if (const base::DictValue* child_dict = child.GetIfDict()) {
      WalkBookmarkNode(*child_dict, path, in_toolbar, /*is_root=*/false, out);
    }
  }
}

}  // namespace

ChromiumImporter::ChromiumImporter() = default;

ChromiumImporter::~ChromiumImporter() = default;

// static
std::vector<user_data_importer::ImportedBookmarkEntry>
ChromiumImporter::ParseBookmarksJson(const std::string& json) {
  std::vector<user_data_importer::ImportedBookmarkEntry> entries;
  std::optional<base::Value> root = base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  const base::DictValue* dict = root ? root->GetIfDict() : nullptr;
  const base::DictValue* roots = dict ? dict->FindDict("roots") : nullptr;
  if (!roots) {
    return entries;
  }
  // "bookmark_bar" is the toolbar; "other" and "synced" (Mobile bookmarks) are
  // imported next to it.
  static constexpr struct {
    const char* key;
    bool in_toolbar;
  } kRoots[] = {{"bookmark_bar", true}, {"other", false}, {"synced", false}};
  for (const auto& r : kRoots) {
    if (const base::DictValue* node = roots->FindDict(r.key)) {
      WalkBookmarkNode(*node, {}, r.in_toolbar, /*is_root=*/true, &entries);
    }
  }
  return entries;
}

void ChromiumImporter::StartImport(
    const user_data_importer::SourceProfile& source_profile,
    uint16_t items,
    ImporterBridge* bridge) {
  bridge_ = bridge;
  bridge_->NotifyStarted();

  if ((items & user_data_importer::HISTORY) && !cancelled()) {
    bridge_->NotifyItemStarted(user_data_importer::HISTORY);
    ImportHistory(source_profile.source_path);
    bridge_->NotifyItemEnded(user_data_importer::HISTORY);
  }
  if ((items & user_data_importer::FAVORITES) && !cancelled()) {
    bridge_->NotifyItemStarted(user_data_importer::FAVORITES);
    ImportBookmarks(source_profile.source_path);
    bridge_->NotifyItemEnded(user_data_importer::FAVORITES);
  }
  bridge_->NotifyEnded();
}

void ChromiumImporter::ImportBookmarks(const base::FilePath& profile_dir) {
  std::string json;
  if (!base::ReadFileToStringWithMaxSize(profile_dir.AppendASCII("Bookmarks"),
                                         &json, kMaxBookmarksFileBytes)) {
    return;
  }
  std::vector<user_data_importer::ImportedBookmarkEntry> entries =
      ParseBookmarksJson(json);
  if (entries.empty() || cancelled()) {
    return;
  }
  bridge_->AddBookmarks(entries, bridge_->GetLocalizedString(IDS_BOOKMARK_GROUP));
}

void ChromiumImporter::ImportHistory(const base::FilePath& profile_dir) {
  // The source browser may be running and holds its History database open.
  // Work on a private copy (with its journal files) and never write to the
  // original.
  base::ScopedTempDir temp_dir;
  if (!temp_dir.CreateUniqueTempDir()) {
    return;
  }
  const base::FilePath copy = temp_dir.GetPath().AppendASCII("History");
  if (!base::CopyFile(profile_dir.AppendASCII("History"), copy)) {
    return;
  }
  for (const char* suffix : {"-wal", "-journal"}) {
    const base::FilePath journal =
        profile_dir.AppendASCII(std::string("History") + suffix);
    if (base::PathExists(journal)) {
      base::CopyFile(journal, temp_dir.GetPath().AppendASCII(
                                  std::string("History") + suffix));
    }
  }

  sql::Database db(kDatabaseTag);
  if (!db.Open(copy)) {
    return;
  }
  const char kQuery[] =
      "SELECT url, title, visit_count, typed_count, last_visit_time, hidden "
      "FROM urls WHERE last_visit_time > 0 "
      "ORDER BY last_visit_time DESC LIMIT ?";
  sql::Statement s(db.GetUniqueStatement(kQuery));
  if (!s.is_valid()) {
    return;
  }
  s.BindInt(0, kMaxHistoryRows);

  std::vector<user_data_importer::ImporterURLRow> rows;
  while (s.Step() && !cancelled()) {
    GURL url(s.ColumnStringView(0));
    if (!CanImportUrl(url)) {
      continue;
    }
    user_data_importer::ImporterURLRow row(url);
    row.title = s.ColumnString16(1);
    row.visit_count = s.ColumnInt(2);
    row.typed_count = s.ColumnInt(3);
    row.last_visit = FromWindowsEpochMicros(s.ColumnInt64(4));
    row.hidden = s.ColumnInt(5) != 0;
    rows.push_back(std::move(row));
  }
  if (!rows.empty() && !cancelled()) {
    // TODO: add VISIT_SOURCE_CHROMIUM_IMPORTED; until then an existing
    // "imported" source is used (it only controls how the visit is labelled).
    bridge_->SetHistoryItems(rows,
                             user_data_importer::VISIT_SOURCE_FIREFOX_IMPORTED);
  }
}

}  // namespace importer
