# SWAN — Windows PC 에서 빌드하기

> 상태: 소스 스냅샷은 서버에서 **컴파일까지 검증**(오브젝트 단위). 이 문서의 Windows 절차와 `build_swan.ps1` 은 **아직 Windows 에서 실행해 보지 않았다**(🧪). 막히면 오류 메시지를 알려주면 고친다.

## 0. 왜 스냅샷을 보내는가
Chromium 157.0.8079.0 은 공개 저장소에 해당 커밋이 없어 `git clone` 으로 받을 수 없다. 그래서 (1) SWAN 이 수정된 **자체 소스 스냅샷(`swan-src.tar.zst`, 약 1.2 GB)** 을 보내고 (2) 의존 라이브러리(약 29 GB)와 도구(clang, rust, node …)는 PC 에서 `gclient sync` + `runhooks` 가 `DEPS` 에 고정된 버전으로 받는다. 공유 파일 수정(메뉴·검색엔진·이름 변경 등)은 스냅샷에 **이미 적용**되어 있어 `apply_swan_wiring.py` 를 다시 돌릴 필요가 없다.

## 1. PC 요구사항
- Windows 11 x64, **RAM 32 GB 이상**(16 GB 는 링크 단계 위험), **SSD 여유 150~200 GB**, 인터넷(다운로드 약 30~40 GB).
- Visual Studio 2022 17.x 이상(또는 2026) — 워크로드 **"C++를 사용한 데스크톱 개발"** + 개별 구성요소 **ATL, MFC(x86/x64), Windows SDK 10.0.26100 이상**(서버는 10.0.28000). 디버깅 도구(Windows SDK Debugging Tools)도 체크.
- Git for Windows, Python 은 depot_tools 가 자체 제공하므로 불필요. 짧은 경로 권장(`C:\src\swan`), 백신 실시간 검사에서 `C:\src` 제외하면 빌드가 크게 빨라진다.
- 시간: 코어 16개·NVMe 기준 대략 2~4시간(4코어면 10시간 이상).

## 2. 서버에서 파일 받기
서버에는 `/home/chromium/transfer/swan-src.tar.zst` 와 `SHA256SUMS` 가 있다. PC 의 PowerShell 에서(Windows 11 기본 OpenSSH):
```
scp <서버계정>@<서버주소>:/home/chromium/transfer/swan-src.tar.zst $HOME\Downloads\
scp <서버계정>@<서버주소>:/home/chromium/transfer/SHA256SUMS $HOME\Downloads\
Get-FileHash $HOME\Downloads\swan-src.tar.zst -Algorithm SHA256   # SHA256SUMS 의 값과 같아야 함
```
서버 보안 때문에 이 서버로의 SSH 가 막혀 있으면 서버 관리자가 SFTP/일회성 다운로드 링크를 열어야 한다(공개 웹 경로에 올리지 말 것 — 소스 전체가 노출됨).

## 3. 빌드
```
mkdir C:\src\swan
```
스냅샷을 먼저 해제하려면: `mkdir C:\src\swan\src; tar --zstd -xf swan-src.tar.zst -C C:\src\swan\src` (Windows 11 tar 가 zstd 를 못 읽으면 7-Zip 최신판으로 `.zst` → `.tar` → 폴더 순서로 해제).
그다음 `swan-windows.zip`(이 문서·스크립트·args, 아주 작음)도 받아 `C:\src\swan\` 에 풀고 `powershell -ExecutionPolicy Bypass -File C:\src\swan\build_swan.ps1 -Root C:\src\swan` 실행(스크립트가 스냅샷 해제부터 처리하므로 위 수동 해제는 생략해도 됨; 스냅샷은 `$HOME\Downloads\swan-src.tar.zst` 로 받아둘 것). 스크립트가 하는 일:
1. depot_tools 설치, git 설정(`core.autocrlf=false`, longpaths)
2. `.gclient` 배치(`managed: False`, `target_os=["win"]`), 로컬 git 저장소 초기화(빌드가 `Change-Id` 있는 커밋을 요구)
3. `gclient sync --nohooks --no-history` → `DEPOT_TOOLS_WIN_TOOLCHAIN=0 gclient runhooks`
4. `out\swan\args.gn`(=`args.windows.gn`) 생성 → `autoninja -C out\swan chrome`

산출물: `C:\src\swan\src\out\swan\swan.exe` (같은 폴더의 DLL·pak 와 함께 실행). 폴더째 zip 으로 묶어 배포한다. 서명하지 않은 빌드라 SmartScreen 경고가 뜬다.

## 4. 예상 문제
| 증상 | 조치 |
|---|---|
| `gclient sync` 가 특정 dep 에서 실패 | 재실행(이어받기). 회사망이면 프록시 설정 |
| `vs_toolchain` / `Visual Studio not found` | VS 설치 경로 확인, `set vs2022_install=...` |
| `dia2.h`, `atlbase.h` 없음 | VS 구성요소에서 ATL / DIA SDK 추가 |
| 링크 중 메모리 부족 | 다른 프로그램 종료, `autoninja -j 8` 로 병렬도 낮춤 |
| 서버에서 겪은 `histograms.xml` ChromiumImporter | 스냅샷에 수정 반영됨 |
| 스냅샷 해제 중 심볼릭 링크 오류 | 스냅샷은 링크를 실파일로 바꿔 만들었으므로 발생하지 않아야 함 |

## 5. 확인할 것(실행 후)
`swan.exe` 실행 → 데이터 폴더가 `%LOCALAPPDATA%\SWAN` 인지, 메뉴에 "SWAN CODA", 기본 검색엔진 DuckDuckGo, Google 로그인/웹스토어 없음, `chrome://swan` 에서 로그인(브라우저 → www.swn.kr 승인 → 루프백 리다이렉트 가로채기) 확인. 동작 결과를 알려주면 서버 쪽/코드를 이어서 고친다.
