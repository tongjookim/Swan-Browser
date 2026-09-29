#!/usr/bin/env python3
"""Apply SWAN's changes to shared Chromium files (SWAN's own new files are already in place).

Idempotent: an edit whose result is already present is skipped. `--check` only verifies that every anchor
still exists as expected (safe while a build is running) and changes nothing. `--only <group>` applies one group.

    python3 swan/build/apply_swan_wiring.py --check
    python3 swan/build/apply_swan_wiring.py [--only wiring|menu|importer|search|nogoogle|rename|brand]

⚠ Do NOT apply while a build is in progress: new GN targets are unknown to the running build and the link
step would fail. Apply after the build, then `gn gen out/win` and rebuild (incremental).

Edit = (group, file, anchor, text, mode[, count])
  modes: after / before      insert text next to the anchor (the text's first line is the idempotency marker)
         replace             replace the anchor by text (all `count` occurrences; count defaults to 1)
         close_brace         anchor ends with "}\\n"; insert text before that closing brace
         regex               re.sub(anchor, text) — skipped when the pattern no longer matches
"""
import os, re, sys

ROOT = '/home/chromium/project-A'
CHECK = '--check' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None

EDITS = [
    # ═══ wiring: chrome://swan, prefs, OAuth login tab ═══════════════════════════════════════
    ('wiring', 'chrome/browser/resources/BUILD.gn', '      "about_sys:resources",\n', '      "swan:resources",\n', 'after'),
    ('wiring', 'chrome/chrome_paks.gni', '        "$root_gen_dir/chrome/about_sys_resources.pak",\n',
     '        "$root_gen_dir/chrome/swan_resources.pak",\n', 'after'),
    ('wiring', 'tools/gritsettings/resource_ids.spec', '    "includes": [2700],\n  },\n',
     '  "<(SHARED_INTERMEDIATE_DIR)/chrome/browser/resources/swan/resources.grd": {\n'
     '    "META": {"sizes": {"includes": [10]}},\n    "includes": [2710],\n  },\n', 'after'),
    ('wiring', 'chrome/common/webui_url_constants.h', 'inline constexpr char kChromeUISystemInfoHost[] = "system";\n',
     'inline constexpr char kChromeUISwanHost[] = "swan";\n', 'after'),
    ('wiring', 'chrome/common/webui_url_constants.cc', '      kChromeUISystemInfoHost,\n', '      kChromeUISwanHost,\n', 'after'),
    ('wiring', 'chrome/browser/ui/webui/chrome_web_ui_configs.cc', '#include "chrome/browser/ui/webui/system/system_info_ui.h"\n',
     '#include "chrome/browser/ui/webui/swan/swan_ui.h"\n', 'before'),
    ('wiring', 'chrome/browser/ui/webui/chrome_web_ui_configs.cc', '  map.AddWebUIConfig(std::make_unique<SystemInfoUIConfig>());\n',
     '  map.AddWebUIConfig(std::make_unique<swan::SwanUIConfig>());\n', 'after'),
    ('wiring', 'chrome/browser/ui/webui/BUILD.gn', '      "//chrome/browser/ui/webui/system",\n',
     '      "//chrome/browser/ui/webui/swan",\n', 'before'),
    ('wiring', 'chrome/browser/prefs/browser_prefs.cc', '#include "chrome/browser/signin/chrome_signin_client.h"\n',
     '#include "chrome/browser/swan/swan_prefs.h"\n', 'after'),
    ('wiring', 'chrome/browser/prefs/browser_prefs.cc', '  TRACE_EVENT0("browser", "chrome::RegisterProfilePrefs");\n',
     '  swan::RegisterProfilePrefs(registry);\n', 'after'),
    ('wiring', 'chrome/browser/prefs/BUILD.gn', '    "//chrome/browser/devtools",\n', '    "//chrome/browser/swan",\n', 'after'),
    ('wiring', 'chrome/browser/chrome_content_browser_client_navigation_throttles.cc',
     '#include "chrome/browser/pwc/pwc_navigation_throttle.h"\n', '#include "chrome/browser/swan/swan_navigation_throttle.h"\n', 'after'),
    ('wiring', 'chrome/browser/chrome_content_browser_client_navigation_throttles.cc',
     '  glic::GlicGuestNavigationThrottle::MaybeCreateAndAdd(registry);\n\n  pwc::PwcNavigationThrottle::MaybeCreateAndAdd(registry);\n}\n',
     '  swan::SwanNavigationThrottle::MaybeCreateAndAdd(registry);\n', 'close_brace'),
    ('wiring', 'chrome/browser/BUILD.gn', '    "//chrome/browser/pwc",\n', '    "//chrome/browser/swan",\n', 'after'),

    # ═══ importer: Chrome / Edge (Chromium) bookmarks + history ═════════════════════════════
    ('importer', 'components/user_data_importer/common/importer_type.h', '  TYPE_EDGE = 6,\n',
     '  TYPE_CHROME = 7,\n  TYPE_EDGE_CHROMIUM = 8,\n', 'after'),
    ('importer', 'chrome/common/importer/profile_import_process_param_traits_macros.h',
     'user_data_importer::TYPE_EDGE)', 'user_data_importer::TYPE_EDGE_CHROMIUM)', 'replace'),
    ('importer', 'chrome/browser/importer/importer_uma.cc', '      metrics_type = IMPORTER_METRICS_EDGE;\n      break;\n',
     '    case user_data_importer::TYPE_CHROME:\n    case user_data_importer::TYPE_EDGE_CHROMIUM:\n'
     '      metrics_type = IMPORTER_METRICS_UNKNOWN;  // SWAN: no dedicated histogram bucket yet\n      break;\n', 'after'),
    ('importer', 'chrome/utility/importer/importer_creator.cc', '#include "chrome/utility/importer/bookmarks_file_importer.h"\n',
     '#include "chrome/utility/importer/chromium_importer.h"\n', 'after'),
    ('importer', 'chrome/utility/importer/importer_creator.cc', '    case user_data_importer::TYPE_BOOKMARKS_FILE:\n      return new BookmarksFileImporter();\n',
     '#if BUILDFLAG(IS_WIN)\n    case user_data_importer::TYPE_CHROME:\n    case user_data_importer::TYPE_EDGE_CHROMIUM:\n'
     '      return new ChromiumImporter();\n#endif\n', 'before'),
    ('importer', 'chrome/utility/BUILD.gn', '      "importer/bookmarks_file_importer.h",\n',
     '      "importer/chromium_importer.cc",\n      "importer/chromium_importer.h",\n', 'after'),
    ('importer', 'chrome/browser/importer/importer_list.cc', '#include "base/functional/bind.h"\n',
     '#include "base/files/file_util.h"\n#include "base/json/json_reader.h"\n#include "base/path_service.h"\n'
     '#include "base/strings/utf_string_conversions.h"\n#include "base/values.h"\n', 'before'),
    ('importer', 'chrome/browser/importer/importer_list.cc', '#include "chrome/common/importer/edge_importer_utils_win.h"\n',
     '#include "base/base_paths_win.h"\n', 'after'),
    ('importer', 'chrome/browser/importer/importer_list.cc',
     'std::vector<user_data_importer::SourceProfile> DetectSourceProfilesWorker(\n',
     '''#if BUILDFLAG(IS_WIN)
// SWAN: profiles of other Chromium-based browsers (Google Chrome, Microsoft Edge). Only bookmarks and history
// are offered; passwords go through the source browser's CSV export (see ChromiumImporter).
void DetectChromiumBrowserProfiles(
    std::vector<user_data_importer::SourceProfile>* profiles) {
  base::ScopedBlockingCall scoped_blocking_call(FROM_HERE,
                                                base::BlockingType::MAY_BLOCK);
  base::FilePath local_app_data;
  if (!base::PathService::Get(base::DIR_LOCAL_APP_DATA, &local_app_data)) {
    return;
  }

  struct Browser {
    const wchar_t* user_data_dir;
    const char16_t* name;
    user_data_importer::ImporterType type;
  };
  static constexpr Browser kBrowsers[] = {
      {L"Google\\\\Chrome\\\\User Data", u"Google Chrome",
       user_data_importer::TYPE_CHROME},
      {L"Microsoft\\\\Edge\\\\User Data", u"Microsoft Edge",
       user_data_importer::TYPE_EDGE_CHROMIUM},
  };

  for (const Browser& browser : kBrowsers) {
    const base::FilePath user_data = local_app_data.Append(browser.user_data_dir);
    if (!base::DirectoryExists(user_data)) {
      continue;
    }

    // Profile directory -> display name, from "Local State" profile.info_cache.
    std::vector<std::pair<std::string, std::string>> candidates;
    std::string local_state;
    if (base::ReadFileToStringWithMaxSize(user_data.Append(L"Local State"),
                                          &local_state, 16 * 1024 * 1024)) {
      std::optional<base::Value> root = base::JSONReader::Read(local_state, base::JSON_PARSE_RFC);
      const base::DictValue* dict = root ? root->GetIfDict() : nullptr;
      const base::DictValue* cache =
          dict ? dict->FindDictByDottedPath("profile.info_cache") : nullptr;
      if (cache) {
        for (const auto [dir, info] : *cache) {
          const base::DictValue* info_dict = info.GetIfDict();
          const std::string* name =
              info_dict ? info_dict->FindString("name") : nullptr;
          candidates.emplace_back(dir, name ? *name : std::string());
        }
      }
    }
    if (candidates.empty()) {
      candidates.emplace_back("Default", std::string());
    }

    for (const auto& [dir, profile_name] : candidates) {
      // Directory names come from a file the source browser wrote; never let
      // them escape the User Data directory.
      if (dir.empty() || dir.find_first_of("/\\\\:") != std::string::npos ||
          dir == "." || dir == "..") {
        continue;
      }
      const base::FilePath profile_dir = user_data.AppendASCII(dir);
      if (!base::PathExists(profile_dir.AppendASCII("Bookmarks")) &&
          !base::PathExists(profile_dir.AppendASCII("History"))) {
        continue;
      }
      user_data_importer::SourceProfile source;
      source.importer_name = browser.name;
      if (candidates.size() > 1 && !profile_name.empty()) {
        source.importer_name += u" - " + base::UTF8ToUTF16(profile_name);
      }
      source.importer_type = browser.type;
      source.services_supported =
          user_data_importer::FAVORITES | user_data_importer::HISTORY;
      source.source_path = profile_dir;
      profiles->push_back(source);
    }
  }
}
#endif  // BUILDFLAG(IS_WIN)

''' + 'std::vector<user_data_importer::SourceProfile> DetectSourceProfilesWorker(\n', 'replace'),
    ('importer', 'chrome/browser/importer/importer_list.cc',
     '    DetectBuiltinWindowsProfiles(&profiles);\n    DetectFirefoxProfiles(locale, &profiles);\n  }\n#elif BUILDFLAG(IS_MAC)\n',
     '    DetectBuiltinWindowsProfiles(&profiles);\n    DetectFirefoxProfiles(locale, &profiles);\n  }\n'
     '  DetectChromiumBrowserProfiles(&profiles);\n#elif BUILDFLAG(IS_MAC)\n', 'replace'),

    # ═══ menu: app-menu item "SWAN CODA" opens chrome://swan ═══════════════════════════════════
    ('menu', 'chrome/app/chrome_command_ids.h', '#define IDC_SHOW_DOWNLOADS              40012\n',
     '#define IDC_SHOW_SWAN                   40950\n', 'after'),
    ('menu', 'chrome/app/generated_resources.grd',
     '        <message name="IDS_SHOW_DOWNLOADS" desc="The show downloads menu in the app menu">\n',
     '        <message name="IDS_SHOW_SWAN" desc="App menu item that opens SWAN\'s CODA AI panel (chrome://swan)">\n'
     '          SWAN &amp;CODA\n        </message>\n', 'before'),
    ('menu', 'chrome/browser/ui/toolbar/app_menu_model.cc',
     '  SetElementIdentifierAt(GetIndexOfCommandId(IDC_SHOW_DOWNLOADS).value(),\n                         kDownloadsMenuItem);\n',
     '  AddItemWithStringId(IDC_SHOW_SWAN, IDS_SHOW_SWAN);\n', 'after'),
    ('menu', 'chrome/browser/ui/browser_command_controller.cc', '#include "chrome/browser/ui/singleton_tabs.h"\n',
     '#include "chrome/browser/ui/swan/swan_commands.h"\n', 'after'),
    ('menu', 'chrome/browser/ui/browser_command_controller.cc',
     '    case IDC_SHOW_DOWNLOADS:\n      ShowDownloads(webui::GetBrowserForOpeningWebUi(browser_));\n      break;\n',
     '    case IDC_SHOW_SWAN:\n      swan::ShowSwanPanel(browser_);\n      break;\n', 'after'),
    ('menu', 'chrome/browser/ui/browser_command_controller.cc',
     '  command_updater_->UpdateCommandEnabled(IDC_SHOW_DOWNLOADS, true);\n',
     '  command_updater_->UpdateCommandEnabled(IDC_SHOW_SWAN, true);\n', 'after'),
    ('menu', 'chrome/browser/ui/BUILD.gn',
     '      "//chrome/browser/ui/lens",\n      "//chrome/browser/ui/navigator",\n',
     '      "//chrome/browser/ui/swan",\n', 'after'),

    # ═══ search: DuckDuckGo is the default, Google is not offered ═══════════════════════════
    ('search', 'components/regional_capabilities/regional_capabilities_utils.cc',
     '  CHECK(!engines.empty()) << "Unexpected PrepopulatedEngines to be empty. "\n',
     '''  // SWAN: Google is not offered; DuckDuckGo is first, which makes it the default.
  std::erase_if(engines, [](const raw_ptr<const PrepopulatedEngine>& engine) {
    return engine->id == TemplateURLPrepopulateData::google.id;
  });
  auto ddg = std::find_if(engines.begin(), engines.end(),
                          [](const raw_ptr<const PrepopulatedEngine>& engine) {
                            return engine->id ==
                                   TemplateURLPrepopulateData::duckduckgo.id;
                          });
  if (ddg == engines.end()) {
    engines.insert(engines.begin(), &TemplateURLPrepopulateData::duckduckgo);
  } else {
    std::rotate(engines.begin(), ddg, ddg + 1);
  }

''', 'before'),

    # ═══ nogoogle: no account sign-in, no Chrome Web Store ═════════════════════════════════
    ('nogoogle', 'chrome/browser/signin/account_consistency_mode_manager.cc',
     '  prefs->SetBoolean(prefs::kSigninAllowed, signin_allowed);\n',
     '  // SWAN: Google account sign-in / sync is not offered.\n  signin_allowed = false;\n', 'before'),
    ('nogoogle', 'extensions/common/extension_urls.cc',
     'const char kChromeWebstoreBaseURL[] = "https://chrome.google.com/webstore";',
     'const char kChromeWebstoreBaseURL[] = "https://www.swn.kr/swan/extensions";', 'replace'),
    ('nogoogle', 'extensions/common/extension_urls.cc',
     'const char kNewChromeWebstoreBaseURL[] = "https://chromewebstore.google.com/";',
     'const char kNewChromeWebstoreBaseURL[] = "https://www.swn.kr/swan/extensions/";', 'replace'),
    ('nogoogle', 'extensions/common/extension_urls.cc',
     'const char kChromeWebstoreUpdateURL[] =\n    "https://clients2.google.com/service/update2/crx";',
     'const char kChromeWebstoreUpdateURL[] =\n    "https://www.swn.kr/swan/extensions/update";', 'replace'),
    ('nogoogle', 'extensions/common/extension_urls.cc',
     'const char kChromeWebstoreApiURL[] = "https://chromewebstore.googleapis.com/";',
     'const char kChromeWebstoreApiURL[] = "https://www.swn.kr/swan/extensions/api/";', 'replace'),

    # ═══ rename: chrome.exe -> swan.exe (chrome.dll keeps its name) ════════════════════════
    ('rename', 'chrome/BUILD.gn', '    _chrome_output_name = "initialexe/chrome"\n', '    _chrome_output_name = "initialexe/swan"\n', 'replace'),
    ('rename', 'chrome/BUILD.gn', '      "$root_out_dir/initialexe/chrome.exe",\n      "$root_out_dir/initialexe/chrome.exe.pdb",\n',
     '      "$root_out_dir/initialexe/swan.exe",\n      "$root_out_dir/initialexe/swan.exe.pdb",\n', 'replace'),
    ('rename', 'chrome/BUILD.gn', '      "$root_out_dir/chrome.exe",\n      "$root_out_dir/chrome.exe.pdb",\n',
     '      "$root_out_dir/swan.exe",\n      "$root_out_dir/swan.exe.pdb",\n', 'replace'),
    ('rename', 'build/win/reorder-imports.py', "os.path.join(input_dir, 'chrome.exe')", "os.path.join(input_dir, 'swan.exe')", 'replace'),
    ('rename', 'build/win/reorder-imports.py', "os.path.join(output_dir, 'chrome.exe')", "os.path.join(output_dir, 'swan.exe')", 'replace'),
    ('rename', 'build/win/reorder-imports.py', "os.path.join(input_dir, 'chrome.exe.*')", "os.path.join(input_dir, 'swan.exe.*')", 'replace'),
    ('rename', 'chrome/common/chrome_constants.cc', 'FPL("chrome.exe");', 'FPL("swan.exe");', 'replace', 4),
    ('rename', 'chrome/app/chrome_exe.ver', 'ORIGINAL_FILENAME=chrome.exe', 'ORIGINAL_FILENAME=swan.exe', 'replace'),
    ('rename', 'chrome/installer/util/util_constants.h', 'inline constexpr wchar_t kChromeExe[] = L"chrome.exe";',
     'inline constexpr wchar_t kChromeExe[] = L"swan.exe";', 'replace'),
    ('rename', 'chrome/installer/util/util_constants.h', 'kChromeNewExe[] = L"new_chrome.exe";', 'kChromeNewExe[] = L"new_swan.exe";', 'replace'),
    ('rename', 'chrome/installer/util/util_constants.h', 'kChromeOldExe[] = L"old_chrome.exe";', 'kChromeOldExe[] = L"old_swan.exe";', 'replace'),
    ('rename', 'chrome/installer/launcher_support/chrome_launcher_support.cc', 'const wchar_t kChromeExe[] = L"chrome.exe";',
     'const wchar_t kChromeExe[] = L"swan.exe";', 'replace'),
    ('rename', 'chrome/chrome_proxy/chrome_proxy_main_win.cc', 'FILE_PATH_LITERAL("chrome.exe");', 'FILE_PATH_LITERAL("swan.exe");', 'replace'),
    ('rename', 'chrome/installer/mini_installer/BUILD.gn', '    "$root_out_dir/chrome.exe",\n', '    "$root_out_dir/swan.exe",\n', 'replace'),

    # ═══ brand: product name, user data directory, ProgIDs ═════════════════════════════════
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'COMPANY_FULLNAME=The Chromium Authors', 'COMPANY_FULLNAME=The Suwan News Company', 'replace'),
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'COMPANY_SHORTNAME=The Chromium Authors', 'COMPANY_SHORTNAME=The Suwan News Company', 'replace'),
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'PRODUCT_FULLNAME=Chromium', 'PRODUCT_FULLNAME=SWAN', 'replace'),
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'PRODUCT_SHORTNAME=Chromium', 'PRODUCT_SHORTNAME=SWAN', 'replace'),
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'PRODUCT_INSTALLER_FULLNAME=Chromium Installer', 'PRODUCT_INSTALLER_FULLNAME=SWAN Installer', 'replace'),
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'PRODUCT_INSTALLER_SHORTNAME=Chromium Installer', 'PRODUCT_INSTALLER_SHORTNAME=SWAN Installer', 'replace'),
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'COPYRIGHT=Copyright @LASTCHANGE_YEAR@ The Chromium Authors. All rights reserved.',
     'COPYRIGHT=Copyright @LASTCHANGE_YEAR@ The Suwan News Company. All rights reserved.', 'replace'),
    ('brand', 'chrome/app/theme/chromium/BRANDING', 'MAC_BUNDLE_ID=org.chromium.Chromium', 'MAC_BUNDLE_ID=kr.swn.SWAN', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', 'kProductPathName[] = L"Chromium";', 'kProductPathName[] = L"SWAN";', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', '.base_app_name = L"Chromium",', '.base_app_name = L"SWAN",', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', '.base_app_id = L"Chromium",', '.base_app_id = L"SWAN",', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', '.browser_prog_id_prefix = L"ChromiumHTM",', '.browser_prog_id_prefix = L"SWANHTM",', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', 'L"Chromium HTML Document"', 'L"SWAN HTML Document"', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', '.direct_launch_url_scheme = "chromium",', '.direct_launch_url_scheme = "swan",', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', '.pdf_prog_id_prefix = L"ChromiumPDF",', '.pdf_prog_id_prefix = L"SWANPDF",', 'replace'),
    ('brand', 'chrome/install_static/chromium_install_modes.h', 'L"Chromium PDF Document"', 'L"SWAN PDF Document"', 'replace'),
    # User-visible strings: every "Chromium" in the English source strings becomes "SWAN". (Messages whose English text
    # changes lose their Korean .xtb translation and fall back to English until re-translated.)
    ('brand', 'chrome/app/chromium_strings.grd', r'(?<![A-Za-z_])Chromium(?![A-Za-z_])', 'SWAN', 'regex'),
]


def apply(edit):
    group, path, anchor, text, mode = edit[:5]
    count = edit[5] if len(edit) > 5 else 1
    full = os.path.join(ROOT, path)
    src = open(full, encoding='utf-8').read()
    tag = f'{group:8} {path}'
    if mode == 'regex':
        if not re.search(anchor, src):
            return 'already', f'{tag}: pattern no longer matches'
        if CHECK:
            return 'ok', f'{tag}: {len(re.findall(anchor, src))} matches'
        new, n = re.subn(anchor, text, src)
        open(full, 'w', encoding='utf-8').write(new)
        return 'applied', f'{tag}: {n} replaced'
    if mode == 'replace':
        if text in src and anchor not in src:
            return 'already', f'{tag}: {text.strip().splitlines()[0][:60]}'
        found = src.count(anchor)
        if found != count:
            return 'ANCHOR?', f'{tag}: expected {count}x, found {found}x  {anchor.strip().splitlines()[0][:60]!r}'
        if CHECK:
            return 'ok', f'{tag}: {found}x'
        open(full, 'w', encoding='utf-8').write(src.replace(anchor, text))
        return 'applied', f'{tag}: {text.strip().splitlines()[0][:60]}'
    marker = text.strip().splitlines()[0].strip()
    if marker in src:
        return 'already', f'{tag}: {marker[:60]}'
    found = src.count(anchor)
    if found != 1:
        return 'ANCHOR?', f'{tag}: found {found}x  {anchor.strip().splitlines()[0][:60]!r}'
    if CHECK:
        return 'ok', f'{tag}: anchor present ({mode})'
    if mode == 'after':
        new = src.replace(anchor, anchor + text)
    elif mode == 'before':
        new = src.replace(anchor, text + anchor)
    elif mode == 'close_brace':
        new = src.replace(anchor, anchor[:-2] + text + '}\n')
    else:
        return 'ERROR', f'{tag}: unknown mode {mode}'
    open(full, 'w', encoding='utf-8').write(new)
    return 'applied', f'{tag}: {marker[:60]}'


def main():
    problems = 0
    for e in EDITS:
        if ONLY and e[0] != ONLY:
            continue
        status, msg = apply(e)
        print(f'  {status:8} {msg}')
        if status in ('ANCHOR?', 'ERROR'):
            problems += 1
    print('problems:', problems)
    return 1 if problems else 0


sys.exit(main())
