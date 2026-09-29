# SWAN 빌드 시스템 (이 서버: Linux → Windows x64 크로스 컴파일)

> 마지막 갱신: 2026-09-29 17:15. **표기**: ✅ = 실행해서 확인함, ⏳ = 진행 중, ❓ = 가정(검증 전).
> 실시간 상태는 `/home/chromium/logs/`, 결정·이력은 `../AGENT.md`. 이 문서는 **재현·운영 절차**를 다룬다.

## 0. ⚠ 서비스 보호 (필독) — 이 서버는 nginx/WordPress/CODA 운영 서버다

Chromium 빌드는 제한 없이 돌리면 16코어를 모두 점유한다(실측 **부하 평균 113**, nginx·php-fpm·MariaDB 와 같은 우선순위로 경쟁). 그래서:

- **모든 빌드 관련 명령은 `swan-build/limited_run.sh` 로만 실행한다.** systemd 전용 슬라이스(`swan.slice/swan-build.slice`)에서 실행하며 제한은 다음과 같다(검증 ✅: cgroup·nice·quota·메모리·OOM 값 확인):
  | 제한 | 값 | 이유 |
  |---|---|---|
  | `AllowedCPUs`(cpuset) | 낮 **4-7,12-15**(물리 코어 4-7), 야간 2-7,10-15 | 코어 0-1(스레드 0,1,8,9)은 항상 서비스 전용. **SMT·캐시 공유 영향을 줄이는 가장 효과적인 장치** |
  | `CPUQuota` | 낮 400%, 야간(01~07시) 1000% | 상한. 야간엔 트래픽이 적어 여유 활용 |
  | `CPUWeight` / `IOWeight` | 1 (최저) | 경합 시 서비스 우선 |
  | `Nice` | 19 | 스케줄러 우선순위 최저 |
  | `MemoryMax` / `MemorySwapMax` | 48G / 0 | 링크 단계 폭주로 서비스가 메모리를 잃지 않게 |
  | `OOMScoreAdjust` | 1000 | 메모리 부족 시 **빌드 프로세스가 먼저 종료** |
  | `TasksMax` | 8192 | 프로세스 폭주 방지 |
- **실측(2026-09-29, 원점 서버 로컬 요청·캐시 우회 `curl --resolve www.swn.kr:443:127.0.0.1 "https://www.swn.kr/?nc=랜덤"` 10회 평균)**: 빌드 정지 **2.5초** / 빌드 실행(400%, 고정 없음) **3.3초(+30%)** / **빌드 실행 + 코어 4-7 고정 2.7초(+7%)**. → 우선순위·쿼터만으로는 부족했고 **코어 고정이 필요**했다.
- ⚠ **측정 방법 주의**: 서버 안에서 공개 URL(`https://www.swn.kr/`)로 재면 CDN/네트워크 경로 때문에 원점 상태와 무관하게 20~30초 타임아웃이 나올 수 있다(빌드를 완전히 멈춰도 발생 확인). 원점은 위의 `--resolve` 방식으로 재고, 비교는 **`echo 1 > <cgroup>/cgroup.freeze`(빌드 일시정지) ↔ `0`(재개)** 로 한다. 이 사이트의 캐시 없는 페이지는 빌드와 무관하게 원래 2~3초로 느리다.
- **야간 부스트 타이머**(systemd, `swan/build/systemd/` 사본): `swan-build-boost.timer` 매일 01:00 KST → `swan-build-normal.timer` 07:00 KST 복귀. 서비스 유닛이 `systemctl --runtime set-property swan-build.service CPUQuota=… AllowedCPUs=…` 를 실행(빌드가 없으면 조용히 무시). 상태: `systemctl list-timers 'swan-build-*'`. `start_build.sh` 는 시작 시각에 맞는 값을 선택. 수동 조정: `systemctl set-property swan-build.service CPUQuota=NNN%  AllowedCPUs=…`(재시작 불필요).
- 사용법: 짧은 명령 `swan-build/limited_run.sh -- <명령>` (끝날 때까지 대기, 종료코드 전달) / 장시간 `swan-build/start_build.sh` (= `--detach swan-build`, systemd 서비스로 세션과 무관하게 실행, `systemctl status swan-build`, 중지 `systemctl stop swan-build`).
- 빌드 병렬도는 `autoninja -j 14`. 제한 후 부하 평균 ≈ 16, 사이트 응답 정상(0.3~0.9초) 확인.
- **금지**: 제한 없이 `autoninja`/`siso`/`gclient sync`/`gn gen` 을 직접 실행하지 않는다. `pkill` 로 중단할 땐 `pkill -x siso` 등 정확한 이름만.
- 영향 모니터링: `uptime`, `curl -w '%{time_total}' https://www.swn.kr/`, `cat /sys/fs/cgroup/swan.slice/swan-build.slice/cpu.stat`(`nr_throttled`).

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 목표 산출물 | `swan.exe` (Windows 11 x64, Chromium 157.0.8079.0 기반) — 서명 안 된 테스트 빌드, zip 배포 |
| 호스트 | 이 서버: Linux 5.15 (Ubuntu 22.04 계열), 16코어, RAM 125GB, 여유 디스크 ≈480GB ✅ |
| 타깃 | `target_os="win"`, `target_cpu="x64"` |
| 방식 | 공식 지원 크로스 컴파일(`docs/win_cross.md`). 컴파일러 = Chromium 이 받는 clang(clang-cl) + lld-link ✅ |
| Windows SDK/CRT | Google 내부 패키지 대신 **xwin(패치판)** 으로 MS 에서 받은 **MSVC 14.51.36231 + SDK 10.0.28000.0** ✅ (Chromium 이 요구하는 정확한 조합) |
| 소스 | `/home/chromium/project-A` (= `/home/chromium/src` 링크). git 이력 없는 스냅샷 + 빈 baseline 커밋 |
| 검증된 것 | 동기화 ✅, 훅 ✅, `gn gen`(37,419 타깃) ✅, 오브젝트 1개 컴파일 ✅, 전체 빌드 ⏳ |

## 2. 디렉터리 (`/home/chromium/`)

```
.gclient                 gclient 설정 (사본: project-A/swan/build/gclient.config)
src -> project-A         gclient 가 기대하는 solution 이름 "src"
project-A/               Chromium 소스 + 의존성 418개(≈26GB)
  out/win/args.gn        GN 인자 (사본: swan/build/args.win.gn)
  build/win_toolchain.json   ★ setup_wintc.py 가 생성(추적 안 함) — 아래 3.2
  swan/                  제품 디렉터리: BUILD_SYSTEM.md, build/(스크립트)
depot_tools/             git clone. gn/autoninja/siso/gclient 래퍼 (ensure_bootstrap 필요)
xwin-cache/  winsdk-raw/ xwin 다운로드 캐시 / splat 결과(crt/, sdk/)
xwin-src/                ★ 패치한 xwin 소스 + target/release/xwin (3.2)
sdk-redist/              d3dcompiler_47.dll 추출용(msis/, cabs/, out/)
tools/msi-pull/          MSI+CAB 에서 파일을 꺼내는 작은 Rust 도구 (사본: swan/build/msi-pull/)
wintc/                   ★ Chromium 이 쓰는 툴체인 루트 (심볼릭 링크 + JSON, setup_wintc.py 가 재생성)
swan-build/              운영 스크립트 원본 (사본: swan/build/)
logs/                    sync.log hooks.log gn_gen.log build.log, 마커 stageA.{ok,fail} build.{start,ok,fail}
```

## 3. 구성 요소와 이유

### 3.1 소스 트리와 gclient ✅
- 받은 트리는 메인 저장소만 있었다: `DEPS` 428개 중 **418개 의존성 없음**(V8, Skia, ANGLE, ICU, ffmpeg, WebRTC, Dawn …), `.git`·`gn`·`clang`·`depot_tools` 도 없음.
- `.gclient`: `"managed": False`(이력 없는 스냅샷), `target_os=["win"]`, `checkout_configuration="small"`, `checkout_pgo_profiles=False`.
- `git init` + **빈 baseline 커밋**(`build/util/lastchange.py` 요건). 파일은 미추적 → **프로젝트 루트에서 `git status`/`git add -A` 금지**(수십 GB).
- 동기화: `gclient sync --nohooks --no-history -j 16` → **약 16분, 26GB** (`chromium.googlesource.com` 웹 페이지는 503 이지만 **git 프로토콜은 정상**). 로그의 `git fetch … failed; will retry` 는 자동 재시도, 최종 `exit=0` 로 판단.
- `depot_tools/ensure_bootstrap` 을 1회 실행해야 `gn` 래퍼가 동작한다(`python3_bin_reldir.txt` 오류).
- **훅은 `DEPOT_TOOLS_WIN_TOOLCHAIN=0` 으로 실행**: 기본값(1)이면 Google 툴체인 훅(`vs_toolchain.py update`)이 `ciopfs`(FUSE, `libfuse.so.2`)를 요구하며 실패한다. **`gn gen`/빌드에서는 이 변수를 두지 말 것**(기본값 1 이어야 `SetEnv.x64.json` 경로 사용). 훅 소요 ≈2.5분.

### 3.2 Windows 툴체인 ✅
Chromium(`build/vs_toolchain.py`)이 요구: **SDK 10.0.28000.0**, VS 버전 `2026`.

1. **SDK/CRT 다운로드 — xwin 0.10.0 패치판** (`/home/chromium/xwin-src`)
   - Microsoft 라이선스 동의는 사용자가 직접 했다(2026-09-29). 재현 시에도 동의는 사용자 몫.
   - SDK 28000 은 **VS 2026 매니페스트(`--manifest-version 18`)** 에만 있다(기본 17 은 SDK 26100).
   - 이 매니페스트의 SDK 페이로드 URL 에 **공백**(`…/w kits2/…`)이 있어 xwin 0.10.0(최신)이 `http: invalid uri character` 로 실패 → `src/ctx.rs` `get_and_validate` 에서 URL 의 공백을 `%20` 으로 바꾸는 3줄 패치(서버는 `%20` 을 받아 줌, HTTP 200 확인). 요청 대상은 MS 공식 서버 그대로.
   - 실행: `xwin-src/target/release/xwin --accept-license --manifest-version 18 --cache-dir xwin-cache --arch x86_64 --variant desktop --include-atl splat --output winsdk-raw --preserve-ms-arch-notation` (`--include-atl` 필수).
2. **`d3dcompiler_47.dll`** — ANGLE 이 `$windows_sdk_path/Redist/D3D/x64/d3dcompiler_47.dll` 을 복사하는데 xwin 은 받지 않는다(빈 파일로 대체 금지: 앱 폴더의 가짜 DLL 이 시스템 DLL 보다 먼저 로드돼 GPU 가 깨짐).
   - `swan-build/fetch_sdk_redist.sh`: MS 공식 `Windows SDK for Windows Store Apps Tools-x86_en-us.msi` + `.cab` 6개를 받아 `msi-pull` 로 추출 → `sdk-redist/out/`. 진짜 x64 PE(4.7MB) 확인 ✅. (`msiextract`/`7z`/`cabextract` 는 서버에 없어 자체 도구 사용.)
3. **조립 — `swan/build/setup_wintc.py`** (`wintc/` 재생성; 멱등)
   - 공식 depot_tools 패키지와 같은 구조: `VC/Tools/MSVC/14.51.36231/{include,lib/x64,atlmfc}`, `Windows Kits/10/{Include,Lib,bin,Redist}/10.0.28000.0/…` (실파일은 `winsdk-raw` 로의 심볼릭 링크) + `bin/SetEnv.x64.json`.
   - `build/toolchain/win/win_toolchain_data.gni` 가 **x86 도 평가**하므로 `SetEnv.x86.json` 과 **빈 x86 폴더 스텁**이 필요(검증 코드가 경로 존재를 확인). `cl.exe` 는 위치만 찾으므로 **빈 자리표시 파일**(실행 안 함, 컴파일은 clang-cl).
   - **`build/win_toolchain.json` 작성**(`path`, `version:"2026"`, `win_sdk`, `wdk`, `runtime_dirs`). `version` 이 `vs_toolchain.GetVisualStudioVersion()`(="2026")과 다르면 다시 다운로드를 시도한다. `runtime_dirs=[]` → `copy_dlls` 생략(비컴포넌트 빌드는 정적 CRT `/MT`).
   - ⚠ `args.gn` 에 `visual_studio_path` 를 직접 지정하지 말 것: `visual_studio_runtime_dirs` 가 리스트가 되어 GN 이 `This is not a string` 로 실패(Chromium 쪽 결함).
4. **대소문자 무시 include 보완 (별칭 심볼릭 링크)** — Google 툴체인은 대소문자 무시 FUSE(`ciopfs`) 위에 있어 `#include <ObjBase.h>` 가 `objbase.h` 를 찾는다. 이 서버엔 FUSE 가 없어 Skia 등에서 `'ObjBase.h' file not found`.
   - `swan-build/include_names.txt` = 소스 트리의 모든 `<...>` include 이름(grep 으로 수집, 7,122개). `setup_wintc.py` 가 이를 SDK/CRT 헤더 색인과 대소문자 무시로 대조해, **정확한 이름이 없는 것만** 실제 헤더 **바로 옆(같은 include 루트 안)** 에 별칭 심볼릭 링크로 만든다(29개, 예: `um/ObjBase.h -> objbase.h`).
   - ⚠ 별도 폴더(`case_fix/`)에 두고 INCLUDE 에 추가하는 방식은 **동작하지 않았다**(3차 빌드 실패): Chromium 은 **`clang-cl /winsysroot`** 로 컴파일해서 include 루트(`VC/Tools/MSVC/<ver>/include`, `Windows Kits/10/Include/<ver>/{um,shared,ucrt,winrt,cppwinrt}`)를 sysroot 구조에서 직접 계산하고 INCLUDE 환경변수를 무시한다.
   - 별칭은 `winsdk-raw`(xwin 결과)를 수정하므로 xwin 을 다시 실행하면 사라진다 → `setup_wintc.py` 재실행. 새 소스가 다른 이름을 요구하면 `include_names.txt` 를 다시 수집하고 (`grep -rhoE --include='*.h' --include='*.cc' … '^[[:space:]]*#[[:space:]]*(include|import)[[:space:]]*<[^>]+>' . | sed … | sort -u`) `setup_wintc.py` 실행. `gn gen` 불필요.
5. **DIA SDK** — DXC(Dawn)의 dxildia 가 `$visual_studio_path/DIA SDK/include/dia2.h` 를 요구(`fatal error: 'dia2.h' file not found`). xwin 은 받지 않음 → `fetch_sdk_redist.sh` 가 VS 매니페스트의 `Microsoft.VisualCpp.DIA.SDK` vsix 를 받아 **체크섬 검증** 후 추출, `setup_wintc.py` 가 `wintc/DIA SDK/` 로 복사(vsix 안 폴더명이 `DIA%20SDK` 로 퍼센트 인코딩되어 있어 이름을 바꿔 복사).
6. **라이브러리 대소문자 별칭** — 링크 단계에서 `lld-link: could not open 'Cfgmgr32.lib'`. 헤더와 같은 문제. `swan-build/scan_libs.py` 가 소스의 모든 `*.lib` 참조(262개)를 수집(`lib_names.txt`), `setup_wintc.py` 가 SDK/CRT 라이브러리 옆에 별칭 링크 28개 생성.
7. **`fatal_linker_warnings = false`**(args.gn) — xwin CRT 라이브러리는 원본 PDB 없이 배포되어 lld-link 가 `LNK4099 Cannot use debug info for 'libcmt.lib(...)'` 를 내고, 기본값(true)은 `/WX` 라 링크가 실패한다.
- 제약(공식 문서): `.asm` 스텁 → **크래시 리포트 불가**, js2gtest 제외.

### 3.3 GN 인자 (`out/win/args.gn`)
`target_os="win"`, `target_cpu="x64"`, `is_debug=false`, `is_component_build=false`, `is_official_build=false`(PGO/ThinLTO 회피), `symbol_level=0`, `blink_symbol_level=0`, `dcheck_always_on=false`, `treat_warnings_as_errors=false`, `proprietary_codecs=true`, `ffmpeg_branding="Chrome"`(**릴리스 전 라이선스 재검토**), `google_api_key=""` 등 3종(Google 서비스 미사용). `enable_nacl` 은 이 버전에 없는 인자(경고) → 넣지 않음. SDK 관련 인자는 넣지 않음(3.2).

## 4. 파이프라인

공통: `export PATH=/home/chromium/depot_tools:$PATH DEPOT_TOOLS_UPDATE=0 GCLIENT_SUPPRESS_GIT_VERSION_WARNING=1; cd /home/chromium/src`

| 단계 | 명령/스크립트 | 로그/마커 | 상태 |
|---|---|---|---|
| 0 도구 | `git clone --depth 1 …/depot_tools.git`, `depot_tools/ensure_bootstrap`, `cargo install xwin`, `msi-pull` 빌드 | | ✅ |
| 1 SDK | xwin(3.2-1) → `fetch_sdk_redist.sh` → `python3 setup_wintc.py` | `logs/xwin18.log` | ✅ |
| 2 동기화 | `swan-build/run_sync.sh` | `logs/sync.{start,end,log}` (마지막 줄 `exit=0`) | ✅ 16분 |
| A 준비 | `swan-build/pipeline_prepare.sh` (훅은 `DEPOT_TOOLS_WIN_TOOLCHAIN=0`) → `gn gen out/win` | `logs/stageA.*`, `hooks.log` | 훅 ✅, `gn gen` 은 수동(1~3 수정 후) ✅ |
| 3 빌드 | `swan-build/start_build.sh` → `limited_run.sh --detach swan-build -- run_build.sh` (= `autoninja -C out/win -k 0 -j 14 chrome`) | `logs/build.{start,ok,fail,log}` | ⏳ |
| 4 패키징 | 6장 | | ❓ |

- 분리 실행: `(nohup setsid script >/dev/null 2>&1 </dev/null &)` — 도구 호출 타임아웃(≤10분)과 무관.
- 재개: 각 단계 멱등. 빌드는 같은 명령을 다시 실행하면 이어서 진행.
- **부분 컴파일 검증**: `autoninja -C out/win obj/<경로>/<파일>.obj` (예: `obj/base/base/lock.obj`, 첫 실행 ≈2분 — 부속 도구 빌드 포함).
- 빌드는 `siso` 사용: 상태 `siso ps -C out/win`. 이 서버에서 부하가 크므로(load ≈80) 빌드 중 다른 무거운 작업은 피한다.
- ⚠ **빌드 중에 공유 BUILD.gn/소스를 수정·연결하지 말 것**: 실행 중인 빌드의 그래프에 없는 새 타깃 때문에 링크가 깨진다. 연결 작업은 빌드 종료 후 → `gn gen` → 증분 빌드.

## 5. 교훈 · 함정 (실제로 겪은 것)
1. `gclient sync --delete_unversioned_trees=false` → 옵션이 값을 받지 않아 즉시 실패.
2. `pkill -f "<패턴>"` 은 자기 셸 명령줄과도 일치해 자신을 죽인다(exit 144). `pkill -x`/PID 사용.
3. xwin 을 `--include-atl` 없이 받으면 `atlbase.h` 없음.
4. `chromium.googlesource.com` 웹이 503 이어도 git 은 된다(`git ls-remote` 로 확인).
5. 자동 모드 권한 분류기 일시 오류로 Bash 가 막힌 적 있음: 같은 명령 1회 재시도, 우회 금지.
6. 프로젝트 루트에서 `git status`/`git add -A` 금지.
7. 훅에서 `vs_toolchain.py update` 실패(ciopfs) → 훅만 `DEPOT_TOOLS_WIN_TOOLCHAIN=0`.
8. `gn` 래퍼 `python3_bin_reldir.txt not found` → `depot_tools/ensure_bootstrap`.
9. SDK 버전은 코드에 못박혀 있다(`vs_toolchain.py` `SDK_VERSION`). 기본 xwin 매니페스트의 26100 으로는 안 맞는다 → 매니페스트 18 + xwin 패치.
10. GN `visual_studio_path` 수동 지정 금지(3.2). `win_toolchain.json` 방식 사용.
11. `d3dcompiler_47.dll` 누락(`missing and no known rule to make it`) → 3.2-2.
12-b. 링크 실패 `lld-link: invalid timestamp: -2142000` → `build/util/LASTCHANGE` 가 `0000…/1970`. `lastchange.py` 가 커밋 메시지의 **`Change-Id:` 줄**을 찾는데 빈 baseline 커밋에 없었다 → 커밋을 `--amend` 로 `Change-Id: I…` 포함하도록 고치고 `python3 build/util/lastchange.py -o build/util/LASTCHANGE` 재실행.
12. Node 22 의 `node --test <디렉터리>` 는 동작하지 않는다(파일 지정).
13-c. 링크 실패는 컴파일이 한참 진행된 뒤에야 나온다(vulkan-1.dll 등 DLL 링크, ≈30~60분 후): 링크 관련 문제(라이브러리 이름·경고·DIA)는 전체 빌드에서만 드러난다.
13-b. **`sort -u` 는 아님, `grep -r` 이 문제**였다: `grep -r`(ugrep) 전체 트리 스캔이 일부 파일(`ObjIdl.h` 를 include 하는 dawn/DXC 헤더)을 놓쳐 별칭이 빠졌다 → `swan-build/scan_includes.py`(자체 워커, 링크 추적, 298,914개 파일·131,219개 이름)로 교체. 따옴표 include(`"ObjIdl.h"`)도 수집.
13. 대소문자 include 실패(`'ObjBase.h' file not found`) → 3.2-4 별칭 링크(INCLUDE 경로에 폴더를 추가하는 방식은 `/winsysroot` 때문에 무효).
14. 부분 컴파일 통과(`base/lock.obj`)로 안심하지 말 것: Skia XPS·ANGLE 등 Windows 전용 코드는 전체 빌드에서야 문제가 드러난다. 실패는 한 번에 하나씩이 아니라 `FAILED:` 를 모아서 본다.

## 6. 산출물 패키징 (예정 ❓)
- 실행 폴더: `out/win/` 의 `chrome.exe`(→ `swan.exe`), `chrome.dll`, `chrome_elf.dll`, `*.pak`, `locales/`, `icudtl.dat`, `v8_context_snapshot.bin`, `d3dcompiler_47.dll`, `libEGL.dll`, `libGLESv2.dll`, `vk_swiftshader.dll` 등. 필요한 목록은 gn 이 만드는 `out/win/*.runtime_deps` 로 확인.
- 배포: 필요한 파일만 zip → Windows 11 에서 압축 해제 후 실행. 서명이 없어 SmartScreen 경고. 설치 파일이 필요하면 `mini_installer`(별도 검증).
- `swan.exe` 이름 변경 범위: `chrome/BUILD.gn`(`_chrome_output_name`, 90-95행, `reorder_imports`), `chrome/common/chrome_constants.cc:34-59`, `chrome/installer/mini_installer/BUILD.gn:154`, `chrome/test/BUILD.gn:5619,9542`.

## 7. 처음부터 다시 만들기
1. depot_tools clone → `ensure_bootstrap` / 소스 트리 준비 + `src` 링크 + `.gclient` + `git init`+빈 커밋
2. `cargo install xwin` → `xwin-src` 패치·빌드(3.2-1) → xwin 실행 → `msi-pull` 빌드 → `fetch_sdk_redist.sh` → `setup_wintc.py`
3. `run_sync.sh` → `DEPOT_TOOLS_WIN_TOOLCHAIN=0 gclient runhooks -j 16` → `args.win.gn` 을 `out/win/args.gn` 으로 → `gn gen out/win` → `run_build.sh`
4. 소요: 동기화 16분, 훅 3분, `gn gen` 30초, 전체 빌드 ⏳(실측 후 기록)

## 8. 검증 로그
- ✅ 2026-09-29 16:18–16:35 동기화(26GB, exit=0)
- ✅ 16:38–16:41 훅(첫 시도는 ciopfs 실패 → 훅 환경 수정 후 성공)
- ✅ SDK 28000 + MSVC 14.51.36231 확보, 툴체인 조립, `gn gen` 성공(37,419 타깃, 5,086 파일, 27초)
- ✅ 오브젝트 컴파일 성공(`obj/base/base/lock.obj`)
- ✅ 전체 빌드 2차 시도(16:57): 약 8분·8천 단계 후 Skia XPS 에서 `ObjBase.h` 대소문자 오류로 실패 → 3.2-4 별칭 링크
- ✅ 3차 시도(17:11): 2분 만에 같은 `ObjBase.h` 오류(`case_fix` 폴더가 `/winsysroot` 에서 무시됨) → 별칭을 헤더 옆에 생성하도록 변경, 빌드는 `-k 0`(실패해도 계속) 으로
- ✅ 4차 시도: 실패 69건 → 원인 2가지(`ObjIdl.h` 별칭 누락 = grep 스캔 누락, 링커 타임스탬프 = `LASTCHANGE`)를 고침. 사용자가 서비스(nginx) 영향을 우려 → 서비스 보호 제한(0장) 도입 후 빌드 중지·재시작
- ✅ SWAN 수정 전체 적용(`apply_swan_wiring.py`, 그룹 7개) + `gn gen`(37,433 타깃) + **SWAN 소스 11개·수정 공유 파일 15개 개별 컴파일 성공**, WebUI 리소스(TS·ESLint·Stylelint·grit) 성공
- ⏳ 전체 빌드(제한 아래 `start_build.sh`, 93,733 단계): 진행 중
