# SWAN — 수완뉴스의 Chromium 기반 브라우저

Chromium 157.0.8079.0 기반, Windows 11 x64 타깃. **Google 계정·Chrome 웹스토어 없이** 수완뉴스(swn.kr) 계정으로 로그인하고 **CODA AI 챗봇**을 내장한다.

> 상태 표기: ✅ 실행해서 검증 / 🔧 컴파일 ✅·링크/실행 미검증 / 🧪 작성만 / ❌ 미구현
> (2026-09-29 저녁: SWAN C++ 소스 11개 + 수정한 공유 파일 15개가 **개별 컴파일에 성공**, WebUI(TS 컴파일·ESLint·Stylelint·리소스 팩) 빌드 성공. 전체 링크와 Windows 실행은 아직.)
> 계획·결정·이력: [`../AGENT.md`](../AGENT.md) · 빌드 절차: [`BUILD_SYSTEM.md`](BUILD_SYSTEM.md)

## 1. 기능과 위치

| 기능 | 위치 | 상태 |
|---|---|---|
| **수완뉴스 OAuth 로그인** (PKCE S256, 루프백 리다이렉트를 로그인 탭에서 가로챔 — 포트를 열지 않음) | 서버: `wp-oauth-server` 1.2.0. 브라우저: `chrome/browser/swan/swan_login_tab_helper.*`, `swan_navigation_throttle.*`, TS `coda_client.ts` | 서버 ✅ (실서버 E2E 39/39) · 브라우저 🧪 |
| **토큰 암호화 저장** (OSCryptAsync = Windows DPAPI) | `chrome/browser/swan/swan_token_store.*` | 🔧 |
| **CODA 챗봇 + 자동 검색** (근거 부족 시 학습 자료 재검색, 최대 3회) | 서버: `class-wpos-coda-gateway.php`. 브라우저: `chrome/browser/resources/swan/coda_client.ts` (`CodaAgent`) | 서버 ✅ (39+39) · TS ✅ (32 테스트) · UI 🔧 |
| **웹 검색(DuckDuckGo, 기본 꺼짐)** — 브라우저가 검색·본문 읽기, CODA 는 요약만 | `web_search_duckduckgo.ts`, `swan_fetcher.*` (격리 요청, LNA=block) | TS ✅ (실제 응답 10/10 파싱) · C++ 🔧 |
| **현재 페이지 요약** (버튼을 누를 때만, 기본 꺼짐) | `swan_page_context.*` | 🔧 |
| **chrome://swan 패널** + 앱 메뉴 "SWAN CODA" | `chrome/browser/resources/swan/`, `chrome/browser/ui/webui/swan/`, `chrome/browser/ui/swan/` | 🔧 |
| **Chrome / Edge 데이터 가져오기** (북마크·기록) | `chrome/utility/importer/chromium_importer.*` + `importer_list.cc` 감지 | 🔧 |
| **기본 검색엔진 DuckDuckGo, Google 제외** | `regional_capabilities_utils.cc` 수정 | 🔧 |
| **Google 계정 로그인/동기화 차단, 웹스토어 URL 제거** | `account_consistency_mode_manager.cc`, `extension_urls.cc` 수정 | 🔧 |
| **swan.exe / 제품명·데이터 폴더 SWAN** | `chrome/BUILD.gn`, `chrome_constants.cc`, `BRANDING`, `chromium_install_modes.h` … | 🔧 |
| 비밀번호 가져오기 | Chromium 기본 "비밀번호 CSV 가져오기"(Chrome/Edge 에서 내보낸 CSV) — 직접 복호화는 **하지 않음**(DPAPI·App-Bound Encryption 우회는 채택 안 함) | 기본 기능 |
| Chrome 확장 스토어 대체 | ❌ (결정 필요) | ❌ |
| 자동 업데이트, 코드 서명, 크래시 리포트 | ❌ | ❌ |

## 2. 구조

```
swan/                                   제품 디렉터리
  README.md  BUILD_SYSTEM.md            이 문서 / 서버 빌드 시스템
  build/                                빌드 스크립트·설정, apply_swan_wiring.py(공유 파일 수정)
  server_tests/                         WordPress 플러그인·게이트웨이 테스트, 사용자 직접 로그인 E2E
chrome/browser/swan/                    코어: 토큰 저장소, 페처(SwanFetcher), 로그인 탭, 스로틀, URL 안전성, 페이지 컨텍스트, prefs
chrome/browser/ui/webui/swan/           chrome://swan 컨트롤러 + 메시지 핸들러(SwanHandler)
chrome/browser/ui/swan/                 메뉴 명령(ShowSwanPanel)
chrome/browser/resources/swan/          WebUI(TypeScript): main.ts, coda_client.ts, web_search_duckduckgo.ts, browser_proxy.ts …
  node_tests/                           TS 단위 테스트 (Node ≥ 22.18)
chrome/utility/importer/chromium_importer.*   Chrome/Edge 가져오기
```

**신규 파일은 이미 제자리에 있고, 공유 Chromium 파일 수정은 `swan/build/apply_swan_wiring.py` 로 적용한다**(그룹: `wiring`, `menu`, `importer`, `search`, `nogoogle`, `rename`, `brand`). 빌드 도중에는 적용하지 말 것.

## 3. 보안 설계

- **페이지는 네트워크에 직접 접근하지 못한다**: chrome://swan 의 CSP 는 `connect-src 'none'`. OAuth·CODA·웹 검색은 모두 브라우저 프로세스의 `SwanFetcher` 를 거친다.
- **`SwanFetcher` 두 모드**
  - `swn`: `https://www.swn.kr` 고정, 허용 경로(`/oauth/{token,revoke,userinfo}`, `/wp-json/wpos/v1/coda/*`)만, `Authorization`·`Content-Type` 헤더만, 쿼리 금지(토큰이 URL 에 남지 않게).
  - `web`: GET 만, 헤더·본문 없음, `IsSafeWebUrl`(사설·내부 주소·IPv6 리터럴·`user:pw@` 차단), 응답 1.5MB·15초 제한, `text/*` 만. **요청은 LNA(Local Network Access)=block + `ip_address_space=kPublic`** 으로 보내 **DNS rebinding·리다이렉트로 사설/루프백에 닿는 것을 네트워크 서비스가 차단**. 쿠키 없음, 캐시 없음.
- **시크릿 창에서는 비활성**(토큰·요청·페이지 읽기 모두 거부).
- **로그인**: PKCE(S256)+state, 콜백 origin/path 검증, 코드는 브라우저 밖으로 나가지 않음, 로그인 탭은 5분 후 만료. `client_secret`·CODA API 키는 브라우저에 없음(서버 게이트웨이가 보관).
- **CODA 게이트웨이**: scope(`coda:chat|search|page`)와 사용자별 한도, `/v1/ingest*`·`/v1/article` 미노출. (서버 테스트 참조)
- **페이지 읽기**: 사용자가 누른 경우에만, 비밀번호·카드 입력란이 있는 페이지 제외, 격리 월드에서 실행, 4,000자 제한.
- **렌더링**: 서버·웹 문자열은 `textContent` 로만 표시, 링크는 `isSafeWebUrl` 통과 시에만.

## 4. 검증 방법

| 대상 | 명령 |
|---|---|
| TS 단위 테스트 (32) | `cd chrome/browser/resources/swan/node_tests && node --import ./ts_loader.mjs --test coda_client_test.mjs web_search_duckduckgo_test.mjs` |
| TS 엄격 타입 검사 | Chromium 번들 `tsc` + `tools/typescript/tsconfig_base.json` (5개 파일 통과 ✅), 정식 검사는 빌드의 `swan:build_ts` |
| 서버(게이트웨이·PKCE) | `cd swan/server_tests && python3 gw_test.py && php pkce_test.php` |
| 실서버 E2E(사용자 로그인) | `python3 swan_login_start.py` → 브라우저에서 허용 → `python3 swan_login_finish.py "<콜백 URL>"` |
| C++ | 빌드 후 `autoninja -C out/win chrome` 성공 여부 + Windows 에서 실행 (서버에서는 Windows 바이너리를 실행할 수 없음) |

## 5. 알려진 한계 / 결정 대기

- 🔧 표시는 **컴파일까지만 확인**한 코드다(오브젝트 단위). 링크·실행 검증은 전체 빌드 후 Windows 에서. 첫 컴파일에서 나온 오류(SQL 태그 허용 목록, `GURL::path()` 타입, `JSONReader::Read` 인자, 원시 문자열 종결자 등)는 수정 완료.
- Chromium 빌드는 **ESLint·Stylelint 를 강제**한다(예: `chrome://resources/js/cr.js` import 는 "Mojo 사용" 규칙 위반 → 사유를 적은 `eslint-disable-next-line` 로 예외 처리, CSS 는 선언마다 한 줄·짧은 색상 표기). 정식 Mojo PageHandler 로 옮기는 것은 후속 과제.
- 가져오기: 방문 기록 출처가 `VISIT_SOURCE_FIREFOX_IMPORTED` 로 표시됨(전용 값 추가 필요). 검색엔진·쿠키·비밀번호는 가져오지 않음.
- 확장 프로그램: 웹스토어 URL 만 `www.swn.kr/swan/extensions/…` 로 바꿨다. 스토어를 어떻게 운영할지(또는 확장 시스템 자체를 끌지) 결정 필요.
- UI 문자열: 영어 원문의 "Chromium"→"SWAN" 치환으로 해당 메시지의 한국어 번역이 빠져 영어로 표시됨(재번역 필요).
- 서명 안 된 빌드(SmartScreen 경고), 크래시 리포트·자동 업데이트 없음.
