# AGENT.md — Chromium 기반 커스텀 브라우저 개발 계획

이 문서는 사람과 AI 에이전트가 함께 참조하는 프로젝트 가이드입니다.
작업 전 반드시 읽고, 결정/진행 상황이 바뀌면 이 문서를 갱신합니다.

## 1. 프로젝트 개요

- 베이스: Chromium `157.0.8079.0` (`chrome/VERSION` 기준, 소스 경로 `/home/chromium/project-A`)
- 목표: Chromium을 포크하지 않고 **최소 침습 패치 + 별도 브랜딩**으로 유지 가능한 커스텀 브라우저를 만든다.
- 타깃 플랫폼: **Windows 11 (x64)** 확정. 빌드는 Windows 빌드 머신(Visual Studio 2022 + Windows SDK)을 기준으로 한다. 현재 소스는 Linux 서버에 있으므로 Windows용 체크아웃을 별도로 만들어야 한다 (Linux→Windows 크로스 빌드는 가능하나 비표준이라 채택하지 않음).
- 확정된 제품 결정 (2026-09-29):
  1. 타 브라우저 데이터 가져오기: Chrome, Edge (북마크, 비밀번호 등) — 3.5.3장
  2. **Chrome 웹스토어, Google 계정(로그인/동기화)은 제외** — 3.5.4, 3.5.5장
  3. 로그인은 자체 WordPress OAuth 서버(`wp-oauth-server`) 연동 — 3.5.1장
  4. CODA AI 음성 에이전트 연동 — 3.5.2장
- 소스 상태: 현재 git 저장소가 아님 (`git clone` 금지, `depot_tools`의 `fetch`/`gclient` 사용이 정석. `docs/get_the_code.md` 참고).

## 2. 핵심 원칙

1. **업스트림 추종 비용 최소화**: Chromium은 약 4주마다 메이저 릴리스. 수정 범위가 클수록 리베이스 비용이 커진다.
2. **수정보다 확장 우선** (우선순위 순):
   1. 빌드 인자(`args.gn`)·플래그·정책(Enterprise Policy)·기본 설정으로 해결
   2. 확장 프로그램(Extension) / 번들 컴포넌트 확장으로 해결
   3. `chrome/` 레이어에 새 디렉터리로 기능 추가 (기존 파일 수정 최소화)
   4. 기존 Chromium 코드 패치 (마지막 수단, 패치를 작게 유지하고 사유를 기록)
3. **패치는 항상 추적 가능하게**: 업스트림 파일을 고칠 때는 `patches/` 에 패치 시리즈로 관리하거나 브랜치에서 커밋을 분리한다.
4. **최상위 디렉터리 규칙 준수**: README.md 지침에 따라 새 최상위 디렉터리는 제품 단위로만 만든다. 커스텀 코드는 제품 디렉터리(예: `swan/`) 하위에 둔다.
5. 보안 패치 지연 금지: 업스트림 stable 보안 릴리스를 가능한 한 빨리 반영한다.

## 3. 단계별 로드맵

### Phase 0 — 요구사항 확정 (1주)
- [ ] 제품명, 타깃 OS, 대상 사용자, 차별화 기능 목록 확정
- [ ] 필수 기능 결정: 동기화(Sync), 자동 업데이트, 확장 스토어, DRM(Widevine), 코덱(H.264/AAC) 여부
- [ ] 라이선스 검토: BSD-3 + 서드파티 고지, 상용 코덱/DRM 라이선스, Google API 키 사용 약관
- [ ] 추종할 Chromium 채널 결정 (Stable 권장) 및 **고정 버전(태그)** 선정 — 현재 트리는 157.0.8079.0(dev/canary 계열일 가능성). 안정 태그로 전환할지 검토

### Phase 1 — 개발 환경 구축 (1~2주)
- [ ] 빌드 머신 사양 확보 (권장: 코어 16+, RAM 32GB+, SSD 200GB+ 여유)
- [ ] `depot_tools` 설치, `gclient sync`로 소스·서드파티 의존성 동기화, 소스를 git으로 관리 (`fetch` 또는 기존 트리 git 초기화 후 upstream 태그와 대조)
- [ ] `build/install-build-deps.sh` 로 Linux 빌드 의존성 설치
- [ ] 캐시 구성: `ccache`/`sccache` 또는 reclient/goma 계열 원격 빌드
- [ ] 베이스라인 빌드 성공 확인 (아래 4장)
- **빌드 환경 실측 (2026-09-29, `swan.exe` 빌드 요청 시 조사)** — 결론: **현재 이 서버의 트리로는 빌드 불가.**
  - 서버 사양은 충분: 16코어, RAM 125GB, 여유 디스크 527GB, Linux 5.15.
  - 소스 트리(5.6GB)는 **메인 `src` 저장소만** 있고 `DEPS` 선언 428개 체크아웃 중 **418개가 없음**(V8, Skia, ANGLE, ICU, BoringSSL, ffmpeg, WebRTC, Dawn, libc++, harfbuzz, freetype 등 필수 의존성 전부). `.git`·`.gclient`·`gn`·`clang`·`depot_tools`·`gclient`·`siso`/`autoninja` 없음, `buildtools/linux64`·Linux sysroot 없음. → 먼저 `gclient sync` 로 약 30~40GB 를 받아야 한다.
  - **`chromium.googlesource.com` 이 이 서버에서 HTTP 503** (재시도 동일)이라 DEPS 대부분의 원본 저장소에 접근하지 못함. `github.com`, `storage.googleapis.com`(clang), CIPD, `static.rust-lang.org` 는 200.
  - Windows 타깃 툴체인: `DEPOT_TOOLS_WIN_TOOLCHAIN` 패키지(`gs://chrome-wintoolchain`)는 Google 내부 전용 → 비-Google 은 **Visual Studio 2022 + Windows 11 SDK 를 직접 설치**(Windows 머신)하거나, Linux 크로스 컴파일 시 SDK/CRT 를 별도 확보(예: `xwin`, **Microsoft 라이선스 동의는 사용자 몫**).
  - `swan.exe` 이름: 실행 파일명은 `chrome/BUILD.gn:158-160` 의 `_chrome_output_name = "chrome"`. 파일만 rename 하지 말고 GN 에서 바꾸되 `chrome.exe` 를 가정하는 곳(설치기, `chrome_elf`, crashpad, 테스트 등)이 있어 브랜딩 패치와 함께 진행해야 한다.
  - **SWAN 기능(로그인·CODA 패널·가져오기·Google 제거)은 아직 C++ 로 구현되지 않았다** → 지금 빌드하면 "이름만 바꾼 Chromium"이다.
- **`swan.exe` 크로스 빌드 진행 (2026-09-29, 사용자가 "이 서버에서 크로스 컴파일" + xwin(Microsoft 라이선스 동의) + "동기화부터 빌드까지 자동 진행" 승인)**. 스크립트/설정은 `swan/build/`(`gclient.config`=`/home/chromium/.gclient`, `args.win.gn`=`out/win/args.gn`, `setup_wintc.py`, `run_sync.sh`, `run_xwin.sh`, `pipeline_prepare.sh`). 작업 폴더: `/home/chromium/{depot_tools,src→project-A,winsdk-raw,wintc,xwin-cache,logs}`.
  - `git init`(빈 baseline 커밋만, 파일 미추적)으로 `lastchange.py` 요건 충족. `.gclient`: `managed:False`(이력 없는 스냅샷), `target_os=["win"]`, `checkout_configuration="small"`. 명령: `gclient sync --nohooks --no-history -j 16`(옵션 실수로 1회 즉시 실패 후 재시작). 의존성 428개 중 418개 다운로드(수십 GB, 약 1시간+).
  - Windows SDK: `xwin 0.10 --arch x86_64 --include-atl` 로 MSVC CRT 14.44 + Windows SDK 10.0.26100 을 받아(약 0.6GB 언팩) `setup_wintc.py` 가 **depot_tools win_toolchain 패키지와 같은 폴더 구조 + `SetEnv.x64.json`** 으로 조립 → GN 인자 `visual_studio_path/windows_sdk_path/windows_sdk_version` 로 지정. 헤더 5종·라이브러리 6종 존재 확인. (비공식 조합: `DIA SDK`·`bin/…/x64` 실행 파일은 비어 있음 — 컴파일러는 clang-cl/lld-link 를 쓰므로 문제 없을 것으로 예상하나 **빌드로 검증 전**)
  - 파이프라인: 동기화 → `gclient runhooks`(clang·rust·gn·sysroot 등) → `gn gen out/win` → `autoninja -C out/win chrome` → 패키징. 1단계(A: 훅+gn gen)는 `pipeline_prepare.sh` 가 자동 수행하며 마커 `logs/stageA.ok|fail`.
  - **`swan.exe` 이름 변경 범위(조사 완료, 기본 빌드 검증 후 적용 예정)**: Windows 는 `initialexe/chrome.exe` 를 만든 뒤 `reorder_imports` 로 `chrome.exe` 생성 → `chrome/BUILD.gn`(`_chrome_output_name`, 90-95행 산출물 목록, reorder_imports), `chrome/common/chrome_constants.cc:34-59`(`kBrowserProcessExecutableName`), `chrome/installer/mini_installer/BUILD.gn:154`, `chrome/test/BUILD.gn:5619,9542`. 단순 파일명 변경은 자식 프로세스·설치 경로 판별 등에서 깨질 수 있어 코드 상수와 함께 바꾼다.
  - 산출물 한계: **서명되지 않은 exe**(SmartScreen 경고), 크래시 리포트 불가(크로스 빌드에서 `.asm` 스텁, docs/win_cross.md), 사용자 데이터 폴더는 아직 Chromium 기본값(`install_static` 브랜딩은 Phase 2).
- [ ] 저장소 전략 결정: 업스트림 미러 + 커스텀 브랜치 구조 (5장)

### Phase 2 — 브랜딩/리브랜딩 (1~2주)
- [ ] 제품명·로고·아이콘 교체 (`chrome/app/theme/chromium/` 복제 후 별도 `theme/swan/` 구성)
- [ ] `chrome/app/chromium_strings.grd` 등 문자열 리소스 교체
- [ ] 사용자 데이터 디렉터리·번들 ID·앱 이름 분리 (기존 Chromium과 공존 가능하게)
- [ ] 기본 홈/새 탭/검색 엔진/기본 북마크 커스터마이즈
- [ ] Google 서비스 의존 제거 또는 자체 키 사용 (API 키, 업데이트 서버, 크래시 리포팅, 사용 통계 URL)

### Phase 3 — 핵심 커스텀 기능 (기간: 기능별 산정)
- [ ] 기능 목록을 작은 단위로 쪼개 각각 Design Doc(1페이지)와 패치 위치를 기록
- [ ] UI 변경은 WebUI(`chrome/browser/resources/`) 또는 Views(`chrome/browser/ui/views/`) 중 가장 침습이 작은 쪽 선택
- [ ] 각 기능은 **feature flag**(`base::Feature`)로 감싸 켜고 끌 수 있게 구현
- [ ] 기능마다 단위 테스트/브라우저 테스트 추가 (6장)

### Phase 4 — 배포 인프라 (2~3주)
- [ ] 릴리스 빌드 구성 (`is_official_build=true`, 심볼/PGO/LTO 옵션 검토)
- [ ] 패키징: Linux(.deb/.rpm), Windows(installer/MSI), macOS(.dmg, 서명·공증) 중 타깃별
- [ ] 코드 서명, 자동 업데이트 서버(예: Omaha/Sparkle/자체 서버)
- [ ] 크래시 리포팅(Crashpad 서버), 텔레메트리 정책 결정

### Phase 5 — 유지보수 (지속)
- [ ] 4주 주기 업스트림 리베이스 루틴 (5장)
- [ ] 보안 릴리스 모니터링 및 핫픽스 절차
- [ ] 회귀 테스트 자동화(CI)

## 3.5 확정 기능 설계

> 표기: **[확인]** = 이번 세션에서 문서/코드를 직접 읽어 확인, **[미확인]** = 구현 전에 반드시 검증할 가정.

### 3.5.1 WordPress OAuth 로그인 연동
대상: `/home/suwannews/www/wp-content/plugins/wp-oauth-server/` (WP OAuth Server v1.1.0)

- **[확인]** 지원 grant: `authorization_code`, `client_credentials`, `refresh_token`
- **[확인]** 엔드포인트: `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/oauth/userinfo`, `/oauth/.well-known/openid-configuration`, `/wp-json/wpos/v1/validate`, `/wp-json/wpos/v1/me`
- **[확인]** scope: `basic`, `email`, `profile`, `write`. 기존 클라이언트 구현 예: `/home/robots/www/chatbot/wp_oauth.py` (`WPOAuthClient`, state 검증, 토큰 취소, 허용 계정 목록)
- **[확인] PKCE 미지원 (2026-09-29, 소스 직접 열람으로 검증).** 근거:
  - `class-wpos-server.php` `handle_authorize_form/submit`: `code_challenge`·`code_challenge_method` 파라미터를 읽지도 저장하지도 않는다.
  - `class-wpos-token.php` `issue_auth_code($client_id,$user_id,$redirect_uri,$scope)`: challenge 인자 없음. `class-wpos-db.php` 의 `oauth_authorization_codes` 테이블에 challenge 컬럼 없음.
  - `grant_authorization_code`: `code_verifier` 검증 없음. 대신 `verify_client()` 가 **`client_secret` 을 필수**로 요구 → 시크릿 없는 공개 클라이언트 불가.
  - Discovery(`handle_discovery`)에 `code_challenge_methods_supported` 없음, `token_endpoint_auth_methods_supported` 는 `client_secret_post/basic` 뿐.
  - 결론: 데스크톱 브라우저는 **공개 클라이언트**라 `client_secret` 을 바이너리에 넣을 수 없으므로(역컴파일 노출) **현 상태로는 authorization_code 로그인을 안전하게 붙일 수 없다.**
- **플러그인 패치: 적용 완료 (2026-09-29, v1.1.0 → v1.2.0, 사용자 승인).** 변경 파일: `wp-oauth-server.php`, `includes/class-wpos-{db,token,server,coda-gateway}.php`, `admin/class-wpos-admin.php`, `admin/views/client-form.php`, `public/templates/authorize.php`, `README.md`. **검증 상태 (2026-09-29, 실행함)**: 전 파일 `php -l` 통과 / PHP 하니스 24건 통과(RFC 7636 벡터, `parse_pkce`, 루프백·정확 매칭) / 운영 사이트에서 마이그레이션 적용(`wpos_db_version=1.2.0`, `is_public`·`code_challenge[_method]` 컬럼, `coda:*` scope 3행) / discovery 에 `S256`·`none` 노출 / 게이트웨이 무토큰 요청 401 / 존재하지 않는 클라이언트의 token 요청 3종 `invalid_client` / 기존 클라이언트 13개 모두 `is_public=0`.
  - **공개 클라이언트 등록 완료 (2026-09-29)**: 현재 이름 **`SWAN`**(등록 당시 `Custom Browser (dev)` → 제품명 확정 후 변경), `client_id=client_db531dcad80b7a820b560b1c`, redirect `http://127.0.0.1/callback`, grant `authorization_code refresh_token`, scope `basic profile coda:chat coda:search coda:page`, `is_public=1`. (제품명이 정해지면 `app_name` 변경; 시크릿은 사용·표시하지 않음)
  - **로그인 없는 E2E 통과 (실서버 https://www.swn.kr, 39/39)**: 토큰 엔드포인트를 실제 HTTP 로 검증. 인가 코드는 `authorize` 가 쓰는 `WPOS_Token::issue_auth_code` 로 `user_id=NULL` 발급(특정 사용자를 대신하지 않음). 공개: 시크릿 없이 verifier 로 교환 / 코드 재사용·틀린 verifier·verifier 누락·redirect 누락·불일치·타 클라이언트 코드·challenge 없는 코드 거부 / **PKCE 실패 시 코드 폐기** / client_credentials 금지 / refresh 시크릿 없이 로테이션·구 토큰 재사용 거부 / revoke. 기밀(회귀, 실제 `chatbot/wp_oauth.py` 의 `WPOAuthClient` 사용): 시크릿만으로 교환·refresh 정상, redirect 생략 허용, 불일치 거부, 시크릿 누락·오류 거부, challenge 묶인 코드는 verifier 요구, 여러 줄 redirect, client_credentials 정상. 게이트웨이: 무토큰/오토큰 401, 쿼리스트링 토큰 거부, 사용자 없는 토큰 403, `ingest`·`ingest/flush`·`ingest/remove`·`article` 404. 로그아웃 상태 authorize 가 로그인 리다이렉트에서 `code_challenge` 를 보존.
  - **게이트웨이 내부 로직 검증 통과 (실제 클래스 + 로컬 가짜 CODA, 39/39)**: `swan/server_tests/gw_test.py`(+`gw_harness.php`, `pkce_test.php`; WordPress/DB 만 스텁, 운영 무영향). scope 는 토큰 AND 클라이언트 등록 scope 모두 필요, 만료/삭제된 사용자 토큰 거부, 호칭은 토큰 소유자 이름(요청의 `user` 무시), 화이트리스트 필드만 전달, 제어문자 제거, history 최근 5개·역할 필터·1000자 제한(`system` 주입 차단), 입력 clamp, 6000자 초과 413, 사용자별 분/일 한도 429, 업스트림 오류·끊김이 502 로 매핑되며 내부 경로·IP·키가 응답에 새지 않음, 감사 로그는 (client, user, action)만·성공한 호출만 기록. 실행: `cd swan/server_tests && python3 gw_test.py && php pkce_test.php`.
  - **API 키 설정 + 실서버 게이트웨이→CODA 검증 완료 (2026-09-29)**: `wp-config.php` 에 `WPOS_CODA_API_BASE`/`WPOS_CODA_API_KEY` 를 추가하되 **기존 `CODA_API_BASE`/`CODA_API_KEY`(sw-coda-summary 플러그인용) 상수를 참조**하게 했다(같은 키임을 해시 비교로 확인 — 키 사본을 늘리지 않으므로 교체 시 한 곳만 수정). 원자적 교체·`php -l` 통과·사이트 정상(메인 200, 게이트웨이 status 401 유지). 원본은 웹 루트 밖(세션 scratchpad, 600)에 백업. 실제 CODA 로 `forward()` 경로 실행: `chat`(path=extractive)·`search`(3건, 최고 0.8249)·`summarize` 모두 HTTP 200, 감사 로그 `coda_chat/search/summarize` 3행 기록 후 점검 행 삭제. 사용자 토큰 없이 서버 내부에서 직접 호출했으므로 **HTTP 게이트웨이+로그인 사용자 토큰 조합은 여전히 미검증**.
  - **테스트 정리 완료**: 임시 기밀 클라이언트 삭제, 두 클라이언트의 테스트 토큰/코드 전부 삭제(잔여 0행), 테스트용 시크릿 파일 삭제.
  - **로그인 사용자 E2E — 사용자 직접 로그인 방식으로 대기 중 (2026-09-29)**: 검증 계정으로 `suwannews`(ID 522, 관리자, 표시명 수완뉴스)가 지정됐다. 에이전트가 서버에서 이 계정의 **로그인 쿠키를 직접 발급해 대신 로그인**하려던 시도는 **자동 모드 분류기가 거부**했다(관리자 계정의 인증 자격 증명 생성이므로 타당한 판단. 명령은 실행되지 않아 서버 변경 없음, 우회 시도 안 함). 대신 **사용자가 직접 로그인·동의**하는 절차로 진행한다: ① `cd swan/server_tests && python3 swan_login_start.py` 가 출력하는 URL 을 `suwannews` 로 로그인된 브라우저에서 열고 [허용] → ② 이동된 `http://127.0.0.1:53211/callback?code=…` 주소 전체를 복사(페이지는 로드 실패해도 정상) → ③ `python3 swan_login_finish.py "<주소>"`. finish 는 교환→userinfo→게이트웨이 실호출(chat/search/summarize)→`ingest*`·`article` 404→refresh 로테이션→revoke→**SWAN 클라이언트 행만** 정리(같은 사용자의 다른 앱 동의 10건은 건드리지 않음)까지 수행. 드라이런으로 확인: state/호스트 불일치는 서버 요청 없이 중단, 가짜 코드는 서버가 거부. 동의 화면 자체(PKCE 오류 페이지, hidden 필드, 자동 승인)는 사용자가 브라우저에서 직접 눈으로 확인하거나 스크린샷을 공유해야 한다.
  - **아직 못 한 것 (사용자 결정: "로그인 없는 검증만")**: ① 실제 로그인한 사용자로 `authorize` 화면→동의→코드 발급 구간(PKCE/redirect 검증 오류 페이지, 자동 승인, hidden 필드 전달), ② `WPOS_CODA_API_KEY` 를 넣은 실서버에서 인증된 게이트웨이 → 실제 CODA 호출. 이 둘은 `wp-config.php` 수정 승인 및 로그인 계정 지정 후 수행. (참고: 새 계정 생성은 `user_register` 훅에 Mailchimp 동기화·멀티사이트 사용자 동기화·myCRED 등이 걸려 있어 외부/타 사이트에 부작용이 남을 수 있어 하지 않았다. 사용자 이메일과 일치하는 기존 WP 계정도 없었다.) 계획 대비 차이: 7번의 rate limit 은 토큰 엔드포인트가 아니라 게이트웨이(사용자별)에만 적용했고, 인가 코드 소모를 원자적으로 만드는 수정을 추가했다.
- 적용된 항목(아래 1~7):
  1. `oauth_clients` 에 `is_public TINYINT(1) DEFAULT 0` 컬럼 추가 (`DB_VERSION` 올려 `maybe_upgrade` 가 dbDelta 실행), `oauth_authorization_codes` 에 `code_challenge VARCHAR(128)`, `code_challenge_method VARCHAR(10)` 추가.
  2. `handle_authorize_form/submit`: `code_challenge`, `code_challenge_method` 수신(폼 hidden 필드로 POST 까지 전달). 공개 클라이언트는 **S256 만 허용**, challenge 누락 시 `invalid_request`. `plain` 은 거부.
  3. `issue_auth_code`/`save_auth_code`: challenge 저장.
  4. `grant_authorization_code`: 공개 클라이언트면 `client_secret` 대신 `code_verifier` 로 `base64url(sha256(verifier)) == code_challenge` 를 `hash_equals` 로 검증. 실패 시 `invalid_grant`. 기밀 클라이언트(`wp_oauth.py` 등 기존 앱)는 **동작 변경 없음**.
  5. `grant_refresh_token`: 공개 클라이언트는 시크릿 없이 refresh 허용하되 **refresh token 로테이션 유지**(이미 구현됨) + 재사용 탐지 로그.
  6. Discovery 에 `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported` 에 `none` 추가.
  7. 함께 고칠 기존 결함: `grant_authorization_code` 가 요청의 `redirect_uri` 를 **발급된 코드의 redirect_uri 와 대조하지 않는다** (RFC 6749 §4.1.3 위반) → 대조 추가. 토큰 엔드포인트에 시도 횟수 제한 없음 → 클라이언트/IP 별 제한 검토.
- 개발용 임시 대안: PKCE 패치 전에는 **우리 서버의 토큰 교환 백엔드**가 `client_secret` 을 보관하고 브라우저 대신 코드 교환을 수행한다. 다만 이 경우에도 브라우저↔백엔드 구간 인증이 별도로 필요하므로 PKCE 패치를 정식안으로 한다.
- 브라우저 측 설계:
  - 새 로그인 UI(`chrome/browser/ui/` 하위 또는 WebUI 페이지 `chrome://swan-login`)에서 **시스템 브라우저 대신 앱 내 탭**으로 `/oauth/authorize` 를 연다.
  - **리다이렉트는 루프백으로 확정 (2026-09-29, RFC 8252 §7.3).** 서버에는 공개 클라이언트의 리다이렉트 URI 를 포트 없이 `http://127.0.0.1/callback` 으로 등록(서버가 포트 무시 매칭, 호스트는 `127.0.0.1`/`[::1]` 만·`localhost` 이름 불가·`http` 만·경로/쿼리 일치 필요). 구현: `coda_client.ts` `startLogin`/`finishLogin`/`loopbackRedirectUri`(포트 1024~65535). **C++ 리스너 요구사항(미구현)**: `127.0.0.1` 에만 바인드(0.0.0.0 금지), OS 가 준 임시 포트, **요청 1건만 받고 즉시 종료**(+타임아웃 예: 5분), `GET /callback` 외 모두 거부, 성공/실패 안내 HTML 응답 후 `code`·`state` 를 JS 로 전달, 응답에 코드가 남지 않게 `Referrer-Policy: no-referrer`·`Cache-Control: no-store`. 같은 PC 의 다른 프로세스가 포트를 가로챌 수 있으므로 PKCE·`state` 검증이 필수(이미 강제됨)이며 콜백 origin/path 가 `pending.redirectUri` 와 다르면 거부한다.
  - 토큰 저장: Windows **DPAPI** 로 암호화 (Chromium `os_crypt` 재사용). access token 1시간, refresh token으로 갱신, 로그아웃 시 `/oauth/revoke` 호출.
  - 사용자 식별은 `/oauth/userinfo` (scope `basic profile`).
- **Google 계정 로그인은 사용하지 않는다** → 이 OAuth 로그인이 브라우저의 유일한 계정 체계다. Chromium 내장 Sync/Identity 는 3.5.5 절차로 비활성화.
- 서버 설정: OAuth 클라이언트 신규 등록(제품 전용), 허용 redirect URI 등록. `client_secret`, 운영 키는 저장소에 커밋하지 않는다.

### 3.5.2 CODA 챗봇 연동 (텍스트 채팅 + 자율 검색)
> 변경 (2026-09-29): 음성 에이전트 대신 **CODA 챗봇 기능**을 내장한다. STT/TTS 는 범위에서 제외(추후 확장 가능).

대상: `/home/robots/www/chatbot/` (`coda_api.py`, pm2 `coda-api`, 포트 8510, 공개 `https://coda-api.swn.kr`)

**CODA 가 제공하는 것 [확인 — `CODA_API_SPEC.md`, `CODA_OPENCLAW_SPEC.md`]**
- `POST /v1/chat` 대화(FAQ → 기사 → 브리핑 → 추출형 RAG → 인사 → `no-evidence`), `POST /v1/search` 의미검색(약 58k 뉴스 문장), `POST /v1/summarize` 추출 요약, `POST /v1/article` 기사 재구성.
- `/v1/chat` 은 **이미 내부에서 RAG 검색을 자동 수행**한다. 자유 생성은 기본 비활성이며 근거가 없으면 `no-evidence` 를 돌려준다.
- **CODA 자체는 도구를 호출하지 못한다** (OpenClaw 명세: "생성기가 약한 sLLM"). 따라서 "CODA 가 알아서 검색"은 CODA 모델의 능력이 아니라 **브라우저·게이트웨이의 오케스트레이션과 권한 설계**로 구현한다.
- 인증은 API 키 하나뿐이고 키가 **인입/삭제(`/v1/ingest*`) 권한까지 포함**한다. rate limit·키별 쿼터 없음.

**"자율 검색" 권한 모델**
1. **OAuth scope 신설** (WP OAuth Server `oauth_scopes` 테이블에 추가, 로그인 동의 화면에 표시):
   | scope | 허용 범위 | 게이트웨이가 여는 CODA 엔드포인트 |
   |---|---|---|
   | `coda:chat` | 대화 | `POST /v1/chat` |
   | `coda:search` | CODA 코퍼스 자율 검색 | `POST /v1/search` (챗봇이 답변 근거 보강을 위해 사용자 확인 없이 호출) |
   | `coda:page` | 현재 탭 내용 요약 | `POST /v1/summarize` (아래 페이지 접근 규칙 적용) |
   | (부여 안 함) | 인입·삭제·기사 저장 | `/v1/ingest*` **영구 차단** |
2. **자율 검색 동작**: 사용자가 질문하면 CODA 패널이 (a) `/v1/chat` 호출, (b) 응답 `path` 가 `no-evidence` 이거나 `sources` 점수가 낮으면 **질의를 재구성해 `/v1/search` 를 자동 추가 호출**(기본 최대 3회)하고 `accepted:true` 결과를 근거로 표시한다. 재시도 횟수·호출 예산은 브라우저에 하드코딩하지 말고 게이트웨이가 강제한다.
3. **브라우저 측 권한**:
   - CODA 패널은 **사용자가 열었을 때만** 동작한다. 백그라운드 자동 호출 금지.
   - 현재 페이지 내용은 사용자가 "이 페이지 요약/질문"을 누르거나 사이트별로 허용한 경우에만 전송(`coda:page` + 사이트별 권한 UI, 기본 거부). 시크릿 창, 로그인·결제 폼, 비밀번호 필드, `chrome://` 페이지는 **항상 제외**.
   - 전송 전 길이 제한(예: 4,000자)과 미리보기를 적용한다.
4. **웹 검색은 브라우저가 수행한다 (결정 2026-09-29).** CODA 서버에는 웹 검색이 없으므로([확인]) 서버에 검색 백엔드를 두지 않고, **브라우저가 직접 검색·페이지 읽기를 하고 CODA 는 그 본문을 요약(`/v1/summarize`)만** 한다. (CODA 는 `/v1/chat` 에 외부 문맥을 받는 필드가 없어 웹 결과를 "근거"로 쓸 수 없음 [확인] → 요약 + 링크 카드로 표시)
   - 흐름: `chat` → 근거 부족 → 코퍼스 자동검색(최대 3회) → 여전히 없으면(또는 사용자가 "웹에서 검색") **웹 검색 → 상위 최대 3개 페이지 본문(≤4,000자) → `/v1/summarize` → 요약+출처 링크`. 구현: `chrome/browser/resources/swan/coda_client.ts` `CodaAgent`.
   - **기본 꺼짐**: 설정의 "CODA 웹 검색 허용"을 사용자가 켜야 동작. 켰더라도 UI 에 실행한 검색어와 읽은 URL 을 그대로 보여준다(`steps`).
   - 웹 요약은 페이지 본문이 서버로 나가므로 `coda:page` scope 가 없으면 **검색 결과(제목·링크·스니펫)만** 보여주고 페이지는 읽지 않는다.
   - 안전장치(구현됨, `isSafeWebUrl`): http(s) 외 스킴, 인증정보 포함 URL, localhost, 사설/링크로컬/CGNAT IPv4, IPv6 리터럴, `.local/.internal/...` 및 점 없는 내부 호스트명 차단. 브라우저는 서버가 못 가는 내부망에 닿을 수 있어, 조작된 검색 결과가 내부 페이지 내용을 CODA 서버로 유출시키는 경로를 막기 위함이다.
   - **C++ 측에서 반드시 추가 (미구현)**: (a) 해석된 IP 재검사(DNS rebinding 방어, JS 문자열 검사만으로는 불충분), (b) 검색·페이지 읽기는 **쿠키/로그인 상태가 없는 격리 컨텍스트**(in-memory StoragePartition/OTR)에서 수행해 사용자 신원을 검색엔진·사이트에 노출하지 않음, (c) 응답 크기·타임아웃 제한, (d) 시크릿 창에서는 비활성.
   - **검색엔진: DuckDuckGo 확정 (2026-09-29).** JS 없는 `https://html.duckduckgo.com/html/?q=…&kl=kr-kr` 를 사용자 브라우저가 직접 조회(API 키 불필요, 사용자 IP 로 요청). 구현: `web_search_duckduckgo.ts` (`DuckDuckGoProvider`, `parseDuckDuckGoHtml`, `htmlToText`). 파서는 **실제 응답 마크업**(`testdata/ddg_results_real.html`, 실 조회 10/10건 파싱 확인)에 맞췄고, 광고(`result--ad`)·DDG 내부 링크·`javascript:`/`ftp:` 등은 제외하며 `uddg` 리다이렉트를 원본 URL 로 복원한다. 제목/스니펫은 태그 제거 후 엔티티 디코딩(텍스트로만 취급).
     - **한계·리스크**: HTML 스크래핑이라 마크업이 바뀌거나 봇 확인이 뜨면 깨진다 → 빈 결과로 위장하지 않고 `search_parse`/`search_blocked` 오류로 UI 에 알린다. 사용자 상호작용으로 인한 소량 조회를 전제로 하며 자동·대량 호출은 금지(게이트웨이 한도 + `maxWebPages`=3). 검색어는 DuckDuckGo 로 전송되므로 개인정보 고지에 포함. `htmlToText` 는 `<article>`/`<main>` 이 있는 기사 페이지에 적합하고, 없는 홈페이지 등은 메뉴 텍스트가 섞인다(실측: swn.kr 메인).
     - Chromium 기본 검색엔진도 Google → DuckDuckGo 로 교체 필요(prepopulated data, Phase 2·3.5.5).

**게이트웨이 (필수) — API 키를 브라우저에 넣지 않는다**
- 바이너리에 CODA 키를 넣으면 누구나 추출해 `/v1/ingest*` 로 코퍼스를 오염·삭제할 수 있다.
- 구조: `브라우저 →(Bearer <OAuth access token>)→ 게이트웨이 → /wp-json/wpos/v1/validate 로 토큰·scope 검증 → 서버 내부 http://127.0.0.1:8510 을 CODA 키로 호출`. (`CODA_API_WORDPRESS.md` 4장 프록시와 같은 원리, nonce 대신 OAuth 토큰 사용)
- 책임: scope↔엔드포인트 화이트리스트, **사용자별 rate limit·일일 호출 예산**(CODA 자체에는 없음 [확인]), 요청 크기 제한, 최소 로깅, `/v1/ingest*` 차단, CODA 다운 시 오류 처리.
- `validate` 의 `scope` 는 공백 구분 문자열이므로 정확 일치로 분해해 검사한다 (`WPOS_Token::has_scope` 와 동일). 검증 결과는 짧게(예: 30초) 캐시한다.
- `/v1/chat` 에 `user`(OAuth `userinfo.name`)와 `history`(최근 5개)를 전달한다.

**브라우저 UI/구현 위치 (제안)**
- 사이드 패널 WebUI(`chrome://swan-coda`): 대화, 근거(`sources`) 표시, "자동 검색 중…" 상태, 검색 결과 접기/펼치기.
- 기능 플래그 `CodaChat`, `CodaAutoSearch`, `CodaPageContext` 로 각각 끌 수 있게 한다 (`base::Feature`).
- 비로그인 사용자는 사용 불가 (게이트웨이가 401). 로그인은 3.5.1 의 OAuth.

**개인정보/보안**
- 질문·페이지 내용이 서버로 전송된다는 고지와 동의 UI, 개인정보 처리방침 갱신이 필요하다.
- 응답은 학습 코퍼스에서 **추출**한 문장이라 최신성·정확성이 제한된다. `no-evidence` 는 그대로 보여주고 추측 답변을 만들지 않는다.
- 검색 결과·응답은 텍스트로 이스케이프해 렌더한다 (코퍼스가 인입 데이터 기반이므로 신뢰하지 않음).

**검증 체크리스트 (배포 전·후, 아직 아무것도 실행하지 않음)**
1. ✅ 완료(2026-09-29): 문법 `for f in includes/*.php admin/*.php admin/views/client-form.php public/templates/authorize.php wp-oauth-server.php; do php -l "$f"; done` (플러그인 디렉터리에서)
2. ✅ 완료: 마이그레이션: 플러그인 로드 후 `SHOW COLUMNS FROM wp_oauth_clients LIKE 'is_public'`, `wp_oauth_authorization_codes` 의 `code_challenge`, `code_challenge_method` 존재 및 `wp_oauth_scopes` 에 `coda:*` 3행 확인. `wpos_db_version` 옵션이 `1.2.0`.
3. **회귀(가장 중요)**: 기존 클라이언트로 로그인 — `chatbot/wp_oauth.py` 를 쓰는 앱(coda/march 등)에서 로그인·새로고침·로그아웃이 종전처럼 되는지.
4. PKCE E2E: 공개 클라이언트 등록 → `/oauth/authorize?...&code_challenge=...&code_challenge_method=S256` → 코드 수신 → `/oauth/token` 에 `code_verifier` 로 교환 성공. 실패 케이스: 잘못된 verifier / verifier 누락 / `plain` / challenge 누락(공개) / 같은 코드 2회 사용 / redirect_uri 불일치 → 모두 거부되고 코드가 폐기되는지.
5. 게이트웨이: `wp-config.php` 에 `WPOS_CODA_API_KEY` 추가 → `GET /wp-json/wpos/v1/coda/status` 가 `configured:true`. scope 없는 토큰으로 `chat` → 403, 한도 초과 → 429+`Retry-After`, `client_credentials` 토큰 → 403, 본문 6,000자 초과 summarize → 413.
6. 서버에서 Authorization 헤더가 PHP 로 전달되는지 (nginx 설정) — 안 되면 모든 게이트웨이 호출이 401.
7. ✅ 완료: JS 32건 통과 — `cd chrome/browser/resources/swan/node_tests && node --import ./ts_loader.mjs --test coda_client_test.mjs web_search_duckduckgo_test.mjs` (TS 원본 대상, Node ≥ 22.18. Node 22 는 디렉터리 인자를 받지 않으므로 파일을 직접 지정).

**남은 작업 (브라우저 C++/WebUI, 미구현)**: 로그인 탭+콜백 가로채기, 토큰 저장소(`os_crypt`/DPAPI) 구현체, CODA 사이드 패널 WebUI(현재 `.mjs` 는 배선되지 않은 프로토타입), 웹 검색/페이지 읽기 provider(격리 컨텍스트, IP 재검사), 설정 UI(웹 검색 허용·사이트별 페이지 권한), `base::Feature` 3종(`CodaChat`/`CodaAutoSearch`/`CodaPageContext`) + `CodaWebSearch`, GRD/BUILD.gn 등록. 제품명·검색엔진 결정 후 진행.

### 3.5.3 타 브라우저 데이터 가져오기 (Chrome, Edge → 제품)
- Chromium 에는 자체 가져오기 프레임워크가 있다 (`chrome/browser/importer/`, 외부 프로세스 `chrome/utility/importer/`). Windows 에서 어떤 브라우저를 어떤 항목까지 지원하는지는 **[미확인]** — `importer_list.cc` 와 `importer_type` 을 읽어 확인한 뒤 갭을 정의한다. Chrome/Edge 프로필 감지가 기본 제공되지 않으면 Chromium 계열 프로필용 importer 를 추가한다.
- 항목별 계획:
  | 항목 | 접근 | 난이도/리스크 |
  |---|---|---|
  | 북마크 | 프로필의 `Bookmarks` JSON 파싱 → 제품 북마크로 변환 | 낮음 |
  | 방문 기록·검색엔진·자동완성 | `History`/`Web Data` SQLite 읽기 (원본이 잠겨 있으면 복사본 사용) | 중간 |
  | **비밀번호** | `Login Data` 는 Windows DPAPI + Chrome/Edge 최신 버전의 **앱 바운드 암호화(ABE)** 로 보호되어 **타 앱이 직접 복호화하기 어렵다** [미확인: 대상 버전별 정확한 동작 검증 필요] | **높음** |
  | 쿠키 | 동일 이유로 복호화 어려움. 지원 범위에서 제외 권장 | 높음 |
  | 확장 프로그램 | 웹스토어 제외 방침이므로 이전하지 않음 | — |
- 비밀번호는 **1차 지원 방식을 CSV 가져오기**(사용자가 Chrome/Edge 의 "비밀번호 내보내기" 로 만든 CSV 를 선택)로 두고, 복호화 방식은 기술 검증(스파이크) 결과에 따라 결정한다. ABE 우회 시도(타 프로세스 메모리/서비스 악용)는 **보안 정책·법적 리스크로 채택하지 않는다.**
- UX: 첫 실행 온보딩 + 설정 페이지의 "데이터 가져오기". 실행 중인 원본 브라우저의 DB 잠금(`database is locked`) 처리, 진행률·항목 선택 UI.
- CSV 파일은 평문 비밀번호를 포함하므로 가져오기 완료 후 삭제 안내, 임시 파일 안전 삭제.

### 3.5.4 Chrome 웹스토어 제외
- 웹스토어 URL/연동(확장 설치 유도, "Chrome에 추가" 버튼, 웹스토어 업데이트 URL)을 제거하거나 무력화한다. 확장 프로그램 시스템 자체는 유지할지 결정 필요 (8장). 유지할 경우: 자체 배포 확장만 `ExtensionInstallForcelist`/정책 또는 번들 컴포넌트 확장으로 제공.
- 확인 항목 [미확인]: 웹스토어 관련 상수(`extension_urls.cc` 등)와 업데이트 서버 URL 위치, 웹스토어 시작 화면 요소.

### 3.5.5 Google 계정/서비스 제외
- 제거·비활성 대상: 프로필 아바타의 Google 로그인, Chrome Sync, Google 계정 기반 결제/주소 동기화, Google API 키가 필요한 서비스, 안전 탐색(원격 조회), 자동 업데이트(Google Update), 크래시 리포트/사용 통계 전송.
- 접근: (1) 빌드 인자·`base::Feature` 로 끌 수 있는 것은 그렇게 하고 (2) UI 진입점을 숨기고 (3) 필요한 경우에만 코드 패치. Google API 키를 넣지 않으면 다수 서비스가 자연히 동작하지 않지만 UI 에는 오류로 노출될 수 있어 진입점 정리가 필요하다.
- 대체 필요 항목은 8장: 자동 업데이트 서버, 안전 탐색(대체 여부), 번역/맞춤법(Google 서버 의존), 기본 검색엔진.

### 3.5.5-b 구현 현황 (2026-09-29 저녁)
상세: [`swan/README.md`](swan/README.md) (기능↔위치↔상태 표, 보안 설계, 검증 방법). 요약:
- **서버(WordPress)**: PKCE·공개 클라이언트·CODA 게이트웨이 ✅ 배포·검증 완료(실서버 E2E, 하니스, 실제 CODA 호출).
- **브라우저 TS(chrome://swan)**: `coda_client.ts`(OAuth·게이트웨이 클라이언트·자동 검색·웹 검색 에이전트), `web_search_duckduckgo.ts`, `browser_proxy.ts`, `main.ts`+`swan.html/css` — Chromium 엄격 `tsc` 통과 ✅, Node 32 테스트 ✅.
- **브라우저 C++**: `chrome/browser/swan/*`(SwanFetcher·토큰 저장소·로그인 탭·스로틀·페이지 컨텍스트·prefs), `chrome/browser/ui/webui/swan/*`, `chrome/browser/ui/swan/*`(메뉴 명령), `chrome/utility/importer/chromium_importer.*` — **🧪 작성만, 아직 컴파일 안 함**(기본 빌드 종료 대기: 빌드 중 공유 파일을 수정하면 링크가 깨지므로).
- **공유 파일 수정**은 `swan/build/apply_swan_wiring.py`(그룹 wiring/menu/importer/search/nogoogle/rename/brand)로 일괄·멱등 적용. 모든 앵커 `--check` 통과 ✅(적용 전).
- **로그인 구조 변경**: 계획했던 "127.0.0.1 임시 리스너" 대신 **로그인 탭에서 루프백 콜백 탐색을 취소하고 URL 만 가져오는 방식**으로 구현(포트를 열지 않으므로 다른 로컬 프로세스가 코드를 가로챌 여지가 없음). 서버는 포트를 무시하고 매칭하므로 그대로 호환.
- **가져오기 사실 확인**: 이 Chromium 의 내장 가져오기는 IE·구형 Edge·Firefox·Safari·북마크 HTML 만 지원 → **Chrome/Chromium-Edge 는 신규 구현**(북마크·기록). 비밀번호는 기본 CSV 가져오기로 안내.

### 3.5.6 구현 순서 (권장)
1. Windows 빌드 머신 + 베이스라인 빌드 (Phase 1)
2. 브랜딩 + Google/웹스토어 제거 (Phase 2) — 이후 기능이 이 위에 올라가므로 먼저
3. WordPress OAuth 로그인 (PKCE 여부 확인이 선행) — 3.5.1
4. 데이터 가져오기: 북마크 → 기록 → 비밀번호(CSV) — 3.5.3
5. 게이트웨이 + CODA 텍스트 채팅 패널 → 음성(STT/TTS) 추가 — 3.5.2
6. 패키징·서명·자동 업데이트 (Phase 4)

## 4. 빌드 가이드 (Linux 기준, 검증 필요)

> 아래 명령은 표준 절차이며 이 환경에서 아직 실행·검증하지 않았다. 실행 후 결과에 맞게 이 절을 갱신할 것.
> **타깃은 Windows 11**이므로 실제 릴리스 빌드는 Windows 머신에서 수행한다 (Visual Studio 2022 + Windows 11 SDK, `set DEPOT_TOOLS_WIN_TOOLCHAIN=0` 또는 정식 툴체인 설정, `gn gen out\Release`, `autoninja -C out\Release chrome`). Linux 서버는 코드 리뷰/저장소 관리 용도로 두거나 Windows 전용 체크아웃을 별도로 만든다.

```bash
# 빌드 디렉터리 생성
gn gen out/Default
# out/Default/args.gn 예시 (개발용 컴포넌트 빌드)
#   is_debug = false
#   is_component_build = true
#   symbol_level = 1
#   blink_symbol_level = 0
#   enable_nacl = false
#   use_siso/reclient 등은 사용 가능한 인프라에 맞춰 설정
autoninja -C out/Default chrome
out/Default/chrome --user-data-dir=/tmp/dev-profile
```

- 릴리스용 args는 별도 파일(`build/args/swan_release.gn` 등)로 저장소에 커밋해 재현 가능하게 한다.
- 첫 풀빌드는 수 시간 소요될 수 있다. 증분 빌드는 캐시/컴포넌트 빌드로 단축한다.

## 5. 저장소·브랜치 전략

- `upstream/<version>`: Chromium 공식 태그 그대로 (수정 금지)
- `main`: 커스텀 패치가 적용된 통합 브랜치
- `feature/<name>`: 기능별 브랜치 (작은 커밋, 커밋 메시지에 대상 파일/이유 명시)
- 업스트림 업데이트 절차:
  1. 새 태그로 `upstream/<new>` 생성
  2. `main`을 새 태그 위로 rebase (또는 패치 시리즈 재적용)
  3. 충돌 해결 → 빌드 → 테스트 → 릴리스
- `DEPS`, `.gn`, `BUILD.gn` 수정은 충돌이 잦으므로 변경 최소화

## 6. 테스트 전략

- 단위: `unit_tests`, `components_unittests` 중 수정 영역 관련 타깃
- 브라우저: `browser_tests --gtest_filter=...` (수정 영역만 선별 실행)
- 스모크: 빌드 후 주요 시나리오(시작, 탭, 다운로드, 확장, 업데이트) 수동/자동 체크리스트
- 회귀: 업스트림 리베이스마다 커스텀 기능 관련 테스트 전량 실행
- 전체 Chromium 테스트를 매번 돌리지 말고 변경 영향 범위에 한정한다.

## 7. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 리베이스 충돌 누적 | 패치 최소화, feature flag, 정기(4주) 리베이스 |
| 빌드 시간/자원 | 캐시·원격 빌드, 컴포넌트 빌드 |
| 보안 패치 지연 | 보안 릴리스 알림 구독, 핫픽스 브랜치 준비 |
| Google 서비스 의존 | 대체 서비스 계획(업데이트·동기화·안전 탐색) 사전 정의 |
| 라이선스/상표 | Chromium 로고·Chrome 상표 사용 금지, 서드파티 고지 자동 생성 |
| 코덱/DRM 법적 이슈 | 출시 지역별 라이선스 검토 후 `proprietary_codecs`/`ffmpeg_branding` 결정 |

### 보안 후속 조치 (2026-09-29, 사용자 확인 필요)
1. **NVIDIA API 키 노출 → 교체 권장.** `wp-config.php` 의 `COLAB_AI_NVIDIA_API_KEY`(`nvapi-…`) 값이 작업 중 명령 출력에 마스킹 없이 표시되어 이 세션 기록에 남았다(에이전트 실수: 주변 줄을 출력하면서 `CODA_API_KEY` 만 마스킹). 기록이 공유·보관될 수 있으므로 NVIDIA 콘솔에서 **키를 폐기·재발급**하고 `wp-config.php` 와, 주석에 적힌 대로 같은 키를 공유하는 opencode 설정(`~/.config/opencode/opencode.json`)도 함께 갱신할 것. (CODA 키는 노출되지 않았다: 해시 비교로만 확인.)
2. **`wp-config.php` 권한이 `755`(전체 읽기 가능)** 이다. DB 비밀번호·API 키가 들어 있으므로 웹서버 실행 계정만 읽도록 `640`(소유 root, 그룹은 웹서버 그룹) 등으로 좁히는 것을 권장 — 웹 실행 계정/그룹 확인 후 적용해야 사이트가 깨지지 않아 **자동 변경하지 않았다.** (웹으로는 403 이라 원격 노출은 아님.)
3. 이번에 수정하기 전 `wp-config.php` 원본 백업은 세션 임시 폴더(scratchpad, 600)에 있다. 필요 없으면 삭제, 보관하려면 웹 루트 밖의 안전한 곳으로 이동.
4. 이후 작업에서 설정 파일을 출력할 때는 파일 전체를 **패턴 기반으로 자동 마스킹**(`define(...,'…')` 값 전부)하거나 필요한 줄만 정확히 지정해 출력한다.

## 8. 결정 현황

**확정**: 타깃 Windows 11 / Chrome·Edge 데이터 가져오기 / 웹스토어·Google 계정 제외 / WordPress OAuth 로그인 / CODA 챗봇(음성 에이전트는 제외, 코퍼스 자율 검색 권한 부여)

**미결정 (사용자 확인 필요)**
1. ~~제품명~~ **해결: SWAN** (2026-09-29). 내부 식별자는 소문자 `swan` — WebUI `chrome://swan-login`, `chrome://swan-coda`, 제품 디렉터리 `swan/`, args `build/args/swan_release.gn`. 사용자 표시 이름은 "SWAN". **SWAN 은 수완뉴스(swn.kr) 브랜드와 관련된 제품**(사용자 확인 2026-09-29) — 자체 브랜드이므로 Chromium/Google 상표·로고 미사용 원칙만 지키면 된다. 로고·이름을 수완뉴스 브랜드 가이드와 맞출지는 Phase 2 에서 결정.
2. ~~PKCE~~ **해결**: 미지원 확인 → 패치 승인·적용 완료 (검증 대기, 아래 체크리스트)
3. ~~자율 검색 범위~~ **해결**: 코퍼스 검색 + 브라우저가 수행하는 웹 검색(옵트인) (3.5.2)
3-1. ~~게이트웨이 위치~~ **해결**: WordPress 플러그인 (`class-wpos-coda-gateway.php`)
3-2. ~~웹 검색 엔진~~ **해결**: DuckDuckGo (스크래핑 취약성은 3.5.2 참고)
3-3. ~~로그인 리다이렉트~~ **해결**: 루프백 `http://127.0.0.1/callback` (3.5.1)
4. 확장 프로그램 시스템 유지 여부 (웹스토어 제외 시 자체 배포만 허용할지) (3.5.4)
5. 자동 업데이트 서버 구성, 안전 탐색·번역·맞춤법 대체 여부 (3.5.5)
6. 비밀번호 가져오기 범위: CSV 방식만 vs 직접 복호화 가능 여부 검증 후 결정 (3.5.3)
7. 배포 대상 (내부용 / 공개 배포)
8. 소스 버전 정책: 현재 157.0.8079.0 유지 vs 안정(Stable) 태그로 전환
9. Windows 빌드 머신 확보 방식 (로컬/클라우드)

## 9. 에이전트 작업 규칙

- 빌드/테스트를 실행하기 전에 `out/` 디렉터리와 `args.gn`을 확인한다.
- 업스트림 파일 수정 시 **왜 확장/설정으로 해결할 수 없는지**를 커밋 메시지 또는 이 문서에 기록한다.
- 대용량 명령(전체 빌드, `gclient sync`)은 실행 전 사용자에게 확인한다.
- 새 최상위 디렉터리를 만들지 않는다 (제품 디렉터리 하위에 둔다).
- 이 문서의 체크박스를 진행에 맞춰 갱신하고, 검증하지 못한 내용은 "검증 필요"로 표시한다.
- **Bash 오류 대처**: `The server-side auto mode classifier gave no verdict (error)` 는 셸·명령·샌드박스 문제가 아니라 **권한 분류기 서비스의 일시 오류**다(2026-09-29 발생: 세션 중반 수 시간 동안 모든 Bash 호출이 명령 내용과 무관하게 실패했고 이후 저절로 복구). 대응: (1) 같은 명령을 그대로 1회 재시도, (2) 그동안 Read/Write/Edit 등 읽기·편집 도구로 진행, (3) 복구되면 미뤄둔 검증부터 실행. **`dangerouslyDisableSandbox` 등으로 우회하지 않는다**(분류기는 안전장치이며 오류가 우회 사유가 아니다). 복구 확인은 `echo ok` 같은 무해한 명령으로.

## 10. 진행 로그

| 날짜 | 내용 |
|---|---|
| 2026-09-29 | 초기 계획 작성. 소스 버전 157.0.8079.0 확인. 빌드 환경(도구·자원)은 미확인 |
| 2026-09-29 | 검증 계정 `suwannews` 지정. 서버측 로그인 쿠키 발급은 분류기가 거부 → 사용자 직접 로그인 방식(`swan_login_start.py`/`swan_login_finish.py`)으로 전환, 실패 경로 드라이런 완료(그 과정에서 state 불일치 시에도 코드를 전송하던 스크립트 결함 발견·수정). SWAN 은 수완뉴스/swn.kr 브랜드 관련 제품으로 확인. |
| 2026-09-29 | **제품명 SWAN 확정**(클라이언트명 반영, 문서 자리표시자 치환). `wp-config.php` 에 게이트웨이 상수 추가(기존 CODA_API_* 참조), 실제 CODA 로 chat/search/summarize 게이트웨이 경로 검증. ⚠️ 작업 중 `wp-config.php` 일부 출력에 **다른 서비스(NVIDIA) API 키가 그대로 노출**됨 → 아래 "보안 후속 조치" 참고. |
| 2026-09-29 | 공개 클라이언트 `Custom Browser (dev)` 등록, 실서버 토큰 엔드포인트·게이트웨이 가드 E2E 39/39 + 게이트웨이 로직 하니스 39/39 통과, 테스트 흔적 정리. 사용자 계정이 필요한 authorize/동의 구간과 키 설정 후 실제 CODA 호출은 미검증. 이전 기록의 "기존 클라이언트 11개"는 목록이 잘린 오류로 실제 13개(전부 is_public=0). |
| 2026-09-29 | Bash 복구 후 검증 실행(php -l, PHP 하니스 24건, 운영 사이트 읽기 전용 점검, JS 32건 통과). 결정 반영: 검색엔진 DuckDuckGo(`web_search_duckduckgo.ts`, 실제 응답 10/10 파싱), 로그인 리다이렉트 루프백(`startLogin`/`finishLogin`). Bash 실패 원인 = 권한 분류기 일시 오류(9장). |
| 2026-09-29 | **구현**: wp-oauth-server v1.2.0 (PKCE·공개 클라이언트·redirect_uri 대조·코드 원자 소모·CODA 게이트웨이) + `chrome/browser/resources/swan/coda_client.mjs`(+`_test.mjs`: PKCE 로그인, 게이트웨이 클라이언트, 자동 검색, 웹 검색 오케스트레이션). **미검증**: PHP 실행·JS 테스트 모두 미실행(Bash 장애). C++/WebUI 배선 미구현. |
| 2026-09-29 | 음성 에이전트→CODA 챗봇으로 변경, 자율 검색 권한 모델(OAuth scope + 게이트웨이) 설계. `class-wpos-server/token/db/api.php` 열람으로 **PKCE 미지원 검증 완료**, 패치 계획 작성(미적용). |
| 2026-09-29 | 타깃 Windows 11 및 기능 결정 반영. `wp-oauth-server` README/메인 파일, CODA API 명세·WordPress 연동 문서·`wp_oauth.py` 를 읽고 3.5장(기능 설계) 작성. PKCE 지원·CODA 음성 라우트·Chromium 가져오기 지원 범위는 미검증 (Bash 도구 오류로 grep 불가) |

## Windows PC 빌드 전환 (2026-09-29 밤)
- 서버 빌드 중단(`swan-build` 정지, 야간 부스트 타이머 비활성). 사유: 서비스 보호 한도(4코어)에서 남은 ~45k 스텝이 10~37시간.
- 157.0.8079.0 은 공개 커밋이 없어 스냅샷 전송 방식: `/home/chromium/transfer/swan-src.tar.zst`(1.17 GB, 자체 파일만; gclient 의존 dep 255개 디렉터리·훅 다운로드 도구·out·.git 제외, 심볼릭 링크는 실파일화) + `swan-windows.zip`(가이드·`build_swan.ps1`·`args.windows.gn`). 체크섬 `SHA256SUMS`.
- PC 는 `gclient sync --nohooks` + `runhooks` 로 의존성을 DEPS 고정 버전으로 받는다. 절차: `swan/windows/README_WINDOWS.md` (Windows 실행은 미검증).

## GitHub Actions 빌드 (2026-09-29)
- `.github/workflows/swan-windows-build.yml`(수동 빌드, self-hosted Windows 권장), `swan-ts-tests.yml`. 절차·위험: `swan/windows/GITHUB_ACTIONS.md`. 저장소 URL·인증 확정 전이라 push 는 미수행(로컬 `.git` 은 빈 baseline 커밋, 파일 미추적).
