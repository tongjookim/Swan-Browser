#!/bin/bash
# xwin 은 헤더/라이브러리만 받는다. ANGLE 이 SDK 의 Redist/D3D/x64/d3dcompiler_47.dll 을 복사하므로
# Microsoft 공식 SDK 패키지(Windows SDK for Windows Store Apps Tools .msi + .cab)에서 직접 꺼낸다.
# 필요 도구: /home/chromium/tools/msi-pull (Rust, msi+cab 크레이트; 소스는 swan/build/msi-pull/).
set -e
OUT=/home/chromium/sdk-redist; TOOL=/home/chromium/tools/msi-pull/target/release/msi-pull
B="https://download.visualstudio.microsoft.com/download/pr/336fd7d6-f1e9-4b2f-906b-bb4760a09390/Win11Sdk/July2026Servicing28000/w%20kits2/Installers"   # 공백을 %20 으로(xwin 패치와 같은 이유)
mkdir -p $OUT/msis $OUT/cabs $OUT/out; cd $OUT
M="Windows SDK for Windows Store Apps Tools-x86_en-us.msi"
[ -s "msis/$M" ] || curl -sf -m 120 -o "msis/$M" "$B/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$M")"
for c in 69661e20556b3ca9456b946c2c881ddd b82881a61b7477bd4eb5de2cd5037fe2 e3d1b35aecfccda1b4af6fe5988ac4be 2630bae9681db6a9f6722366f47d055c 61d57a7a82309cd161a854a6f4619e52 68de71e3e2fb9941ee5b7c77500c0508; do
  [ -s cabs/$c.cab ] || curl -sf -m 300 -o cabs/$c.cab "$B/$c.cab"
done
$TOOL extract "msis/$M" cabs d3dcompiler_47 out
test -s "out/Windows Kits/10/Redist/D3D/x64/d3dcompiler_47.dll"

# ── DIA SDK (dia2.h, diaguids.lib): DXC/Dawn 의 dxildia 가 "$visual_studio_path/DIA SDK/include" 를 요구한다. xwin 은 받지 않는다.
python3 - <<'PY'
import hashlib, json, os, subprocess, zipfile
m = json.load(open('/home/chromium/xwin-cache/dl/pkg_manifest_95081e02eac1c1b58b7297b93dcea5d64fd43a0d20a1323486b636df95875f31.vsman'))
pl = [x for x in m['packages'] if x.get('id') == 'Microsoft.VisualCpp.DIA.SDK'][0]['payloads'][0]
os.chdir('/home/chromium/sdk-redist'); os.makedirs('dia', exist_ok=True)
if not os.path.exists('dia/dia.vsix'):
    subprocess.run(['curl', '-sf', '-m', '200', '-o', 'dia/dia.vsix', pl['url'].replace(' ', '%20')], check=True)
assert hashlib.sha256(open('dia/dia.vsix', 'rb').read()).hexdigest().lower() == pl['sha256'].lower(), 'DIA SDK checksum'
zipfile.ZipFile('dia/dia.vsix').extractall('dia/x')
PY
test -s "dia/x/Contents/DIA%20SDK/include/dia2.h"
