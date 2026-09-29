# SWAN Windows 빌드 자동화 (작성만 — 실제 Windows 에서는 아직 실행해 보지 않음)
# 사용: PowerShell(관리자 아님)에서  .\build_swan.ps1 -Root C:\src\swan
param([string]$Root = 'C:\src\swan', [string]$Archive = "$HOME\Downloads\swan-src.tar.zst")
$ErrorActionPreference = 'Stop'
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
  tar --zstd -xf $Archive -C $src               # Windows 11 기본 tar(bsdtar) 사용. 실패 시 7-Zip 2단계 해제
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
  git init -q; git add -A -f 2>$null
  git commit -q -m "SWAN snapshot`n`nChange-Id: I0000000000000000000000000000000000000001"
}
gclient sync --nohooks --no-history -j 8
gclient runhooks
New-Item -ItemType Directory -Force out\swan | Out-Null
Copy-Item "$PSScriptRoot\args.windows.gn" out\swan\args.gn -Force
gn gen out\swan
autoninja -C out\swan chrome
Write-Host "완료: $src\out\swan\swan.exe"
