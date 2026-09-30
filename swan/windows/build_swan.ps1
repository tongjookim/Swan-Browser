# SWAN Windows 빌드 자동화 (작성만 — 실제 Windows 에서는 아직 실행해 보지 않음)
# 사용: PowerShell(관리자 아님)에서  .\build_swan.ps1 -Root C:\src\swan
param([string]$Root = 'C:\src\swan', [string]$Archive = "$HOME\Downloads\swan-src.tar.zst")
$ErrorActionPreference = 'Stop'
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what 실패 (exit $LASTEXITCODE) — 위 메시지를 확인하세요" } }
# 이 스크립트가 들어 있는 소스 폴더(…\swan\windows 의 2단계 위)가 이미 $Root\src 라면 압축 해제 없이 그대로 쓴다.
$here = (Resolve-Path "$PSScriptRoot\..\..").Path
if ((Test-Path "$here\chrome\VERSION") -and ($here -ne (Join-Path $Root 'src'))) {
  throw "소스가 '$here' 에 있습니다. gclient 는 '<Root>\src' 구조가 필요하니 폴더를 '$Root\src' 로 옮기고(이름을 src 로) 다시 실행하세요."
}
$src = Join-Path $Root 'src'
git config --global core.autocrlf false
git config --global core.filemode false
git config --global core.preloadindex true
git config --global core.longpaths true
if (-not (Test-Path "$Root\depot_tools")) {
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$Root\depot_tools"
}
$env:PATH = "$Root\depot_tools;$env:PATH"
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'          # 로컬에 설치된 Visual Studio 사용
$env:vs2022_install = ''                        # 필요 시 VS 경로 지정(예: C:\Program Files\Microsoft Visual Studio\2022\Community)
if (-not (Test-Path "$src\chrome\VERSION")) {
  New-Item -ItemType Directory -Force $src | Out-Null
  if (-not (Test-Path $Archive)) { throw "소스가 없습니다: $src\chrome\VERSION / $Archive" }
  tar --zstd -xf $Archive -C $src; Check 'tar'
}
Set-Location $src
if (-not (Test-Path "$Root\.gclient")) {
  @'
solutions = [{
  "name": "src", "url": "https://chromium.googlesource.com/chromium/src.git",
  "managed": False, "custom_deps": {},
  "custom_vars": {"checkout_configuration": "small", "checkout_pgo_profiles": False},
}]
target_os = ["win"]
'@ | Set-Content -Encoding ascii "$Root\.gclient"
}
if (-not (Test-Path "$src\.git")) {              # lastchange.py 가 git 기록을 요구
  $ErrorActionPreference = 'Continue'            # git 경고(stderr)가 오류로 처리되지 않게
  git init -q
  git config core.autocrlf false
  git config core.safecrlf false
  git add -A -f 2>&1 | Out-Null
  git commit -q -m "SWAN snapshot`n`nChange-Id: I0000000000000000000000000000000000000001" 2>&1 | Out-Null
  $ErrorActionPreference = 'Stop'
  if ((git rev-parse --verify HEAD 2>$null) -eq $null) { throw 'git 커밋 생성 실패' }
}
gclient sync --nohooks --no-history -j 8; Check 'gclient sync'
gclient runhooks; Check 'gclient runhooks'
New-Item -ItemType Directory -Force out\swan | Out-Null
Copy-Item "$PSScriptRoot\args.windows.gn" out\swan\args.gn -Force
gn gen out\swan; Check 'gn gen'
autoninja -C out\swan chrome; Check 'autoninja'
Write-Host "완료: $src\out\swan\swan.exe"
