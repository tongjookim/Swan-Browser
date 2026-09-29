#!/usr/bin/env python3
"""Assemble an xwin download into the layout of depot_tools' win_toolchain package
(what build/toolchain/win/setup_toolchain.py expects on a non-Windows host) and write
build/win_toolchain.json, the file build/vs_toolchain.py reads for the *default* GN path.
(Setting visual_studio_path in args.gn instead breaks: visual_studio_runtime_dirs becomes a list.)"""
import json, os, shutil, sys

RAW = '/home/chromium/winsdk-raw'
ROOT = '/home/chromium/wintc'
VC_VER = '14.51.36231'          # MSVC toolset of VS 2026 (xwin --manifest-version 18)
SDK_VER = '10.0.28000.0'          # must equal SDK_VERSION in build/vs_toolchain.py

shutil.rmtree(ROOT, ignore_errors=True)
vc = f'{ROOT}/VC/Tools/MSVC/{VC_VER}'
wk = f'{ROOT}/Windows Kits/10'

def link(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    assert os.path.exists(src), src
    os.symlink(src, dst)

link(f'{RAW}/crt/include', f'{vc}/include')
link(f'{RAW}/crt/lib/x64', f'{vc}/lib/x64')
link(f'{RAW}/crt/include', f'{vc}/atlmfc/include')      # xwin merges ATL headers into crt/include
link(f'{RAW}/crt/lib/x64', f'{vc}/atlmfc/lib/x64')      # atls.lib lives with the CRT libs
for d in ('ucrt', 'um', 'shared', 'winrt', 'cppwinrt'):
    link(f'{RAW}/sdk/include/{d}', f'{wk}/Include/{SDK_VER}/{d}')
for d in ('um', 'ucrt'):
    link(f'{RAW}/sdk/lib/{d}/x64', f'{wk}/Lib/{SDK_VER}/{d}/x64')
os.makedirs(f'{wk}/bin/{SDK_VER}/x64', exist_ok=True)
os.makedirs(f'{wk}/UnionMetadata/{SDK_VER}', exist_ok=True)


# ── case-insensitive include names ─────────────────────────────────────────────────────────────
# Google's toolchain lives on a case-insensitive ciopfs (FUSE) mount, so #include <ObjBase.h> finds objbase.h.
# This server has no FUSE. include_names.txt = every <...> include used by the source tree (collected with grep, see
# swan/BUILD_SYSTEM.md). For each name that does not exist with that exact case but does case-insensitively, add an
# alias symlink NEXT TO the real header (inside the same include root). It has to be there and not in a separate
# directory: Chromium builds with clang-cl /winsysroot, which derives the include roots (VC/include and
# Windows Kits/10/Include/<ver>/{um,shared,ucrt,winrt,cppwinrt}) from the sysroot layout itself and ignores INCLUDE.
NAMES = '/home/chromium/swan-build/include_names.txt'
if os.path.exists(NAMES):
    roots = [f'{vc}/include'] + [f'{wk}/Include/{SDK_VER}/{d}' for d in ('um', 'shared', 'ucrt', 'winrt', 'cppwinrt')]
    index, exact = {}, set()          # lower rel path -> (real root, abs path);  exact rel paths (any root)
    for r in roots:
        real = os.path.realpath(r)
        for dp, _dn, fns in os.walk(real):
            for fn in fns:
                ap = os.path.join(dp, fn)
                rel = os.path.relpath(ap, real).replace(os.sep, '/')
                exact.add(rel)
                index.setdefault(rel.lower(), (real, ap))
    made = 0
    for name in (l.strip() for l in open(NAMES, encoding='utf-8', errors='replace')):
        if not name or name.startswith('/') or '..' in name or name in exact:
            continue
        hit = index.get(name.lower())
        if not hit:
            continue
        root_real, target = hit
        dst = os.path.join(root_real, name)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.lexists(dst):
            os.symlink(target, dst)
            made += 1
    print(f'case aliases: {made} symlinks for mixed-case includes (inside the include roots)')
else:
    print('WARNING: include_names.txt missing -> mixed-case includes (e.g. <ObjBase.h>) will fail')

# ── case-insensitive LIBRARY names (Cfgmgr32.lib vs cfgmgr32.lib, LIBCMT.LIB ...) — same story as the headers ──
LIBNAMES = '/home/chromium/swan-build/lib_names.txt'          # scan_libs.py
if os.path.exists(LIBNAMES):
    ldirs = [os.path.realpath(f'{wk}/Lib/{SDK_VER}/um/x64'), os.path.realpath(f'{wk}/Lib/{SDK_VER}/ucrt/x64'), os.path.realpath(f'{vc}/lib/x64')]
    lindex, lexact = {}, set()
    for d in ldirs:
        for fn in os.listdir(d):
            lexact.add(fn); lindex.setdefault(fn.lower(), (d, os.path.join(d, fn)))
    lmade = 0
    for name in (l.strip() for l in open(LIBNAMES)):
        if not name or name in lexact:
            continue
        hit = lindex.get(name.lower())
        if hit and not os.path.lexists(os.path.join(hit[0], name)):
            os.symlink(hit[1], os.path.join(hit[0], name)); lmade += 1
    print(f'lib aliases: {lmade}')

vct = ['VC', 'Tools', 'MSVC', VC_VER]
inc = [['Windows Kits', '10', 'Include', SDK_VER, d] for d in ('um', 'shared', 'winrt', 'ucrt')]
inc += [vct + ['include'], vct + ['atlmfc', 'include']]
env = {
    'VSINSTALLDIR': [['.\\']],
    'VCINSTALLDIR': [['VC\\']],
    'INCLUDE': inc,
    'LIBPATH': [vct + ['lib', 'x86', 'store', 'references'], ['Windows Kits', '10', 'UnionMetadata', SDK_VER]],
    'VCToolsInstallDir': [vct[:-1] + [VC_VER + os.sep]],
    'PATH': [['Windows Kits', '10', 'bin', SDK_VER, 'x64'], vct + ['bin', 'HostX64', 'x64']],
    'LIB': [vct + ['lib', 'x64'], ['Windows Kits', '10', 'Lib', SDK_VER, 'um', 'x64'],
            ['Windows Kits', '10', 'Lib', SDK_VER, 'ucrt', 'x64'], vct + ['atlmfc', 'lib', 'x64']],
}
os.makedirs(f'{vc}/bin/HostX64/x64', exist_ok=True)
json.dump({'env': env}, open(f'{wk}/bin/SetEnv.x64.json', 'w'), indent=2)
# build/toolchain/win/win_toolchain_data.gni evaluates the x86 toolchain as well, even for an x64-only
# build, so SetEnv.x86.json must exist. It is never used for compiling here (no x86 libs are installed).
# setup_toolchain.py verifies that every path in the x86 env exists -> create EMPTY stubs (x86 is never built).
for d in (f'{vc}/lib/x86/store/references', f'{vc}/atlmfc/lib/x86', f'{vc}/bin/HostX64/x86',
          f'{wk}/Lib/{SDK_VER}/um/x86', f'{wk}/Lib/{SDK_VER}/ucrt/x86'):
    os.makedirs(d, exist_ok=True)
# build/toolchain/win/setup_toolchain.py only *locates* cl.exe (vc_bin_dir); Chromium compiles with clang-cl and
# links with lld-link, so an empty placeholder file is enough. It is never executed.
for d in (f'{vc}/bin/HostX64/x64', f'{vc}/bin/HostX64/x86'):
    os.makedirs(d, exist_ok=True)
    open(f'{d}/cl.exe', 'w').close()
env_x86 = dict(env)
env_x86['PATH'] = [['Windows Kits', '10', 'bin', SDK_VER, 'x64'], vct + ['bin', 'HostX64', 'x86'], vct + ['bin', 'HostX64', 'x64']]
env_x86['LIB'] = [vct + ['lib', 'x86'], ['Windows Kits', '10', 'Lib', SDK_VER, 'um', 'x86'],
                  ['Windows Kits', '10', 'Lib', SDK_VER, 'ucrt', 'x86'], vct + ['atlmfc', 'lib', 'x86']]
json.dump({'env': env_x86}, open(f'{wk}/bin/SetEnv.x86.json', 'w'), indent=2)
print('toolchain root :', ROOT)
print('visual_studio_path  =', ROOT)
print('windows_sdk_path    =', wk)
print('windows_sdk_version =', SDK_VER)
# sanity: every path in the JSON must resolve
bad = [os.path.join(ROOT, *p) for k in ('INCLUDE', 'LIB') for p in env[k] if not os.path.exists(os.path.join(ROOT, *p))]
print('unresolved paths:', bad or 'none')
for f in ('Windows.h', 'winsock2.h', 'atlbase.h', 'dxgi.h', 'd3d11.h'):
    hits = [d for d in ('um', 'shared') if os.path.exists(f'{wk}/Include/{SDK_VER}/{d}/{f}')] or (['vc'] if os.path.exists(f'{vc}/include/{f}') else [])
    print(f'  header {f:12}', 'OK' if hits else 'MISSING')
for l in ('kernel32.lib', 'user32.lib', 'msvcrt.lib', 'libcmt.lib', 'ucrt.lib', 'legacy_stdio_definitions.lib'):
    ok = any(os.path.exists(p) for p in (f'{wk}/Lib/{SDK_VER}/um/x64/{l}', f'{wk}/Lib/{SDK_VER}/ucrt/x64/{l}', f'{vc}/lib/x64/{l}'))
    print(f'  lib    {l:28}', 'OK' if ok else 'MISSING')

# ── Redist/D3D/x64/d3dcompiler_47.dll (ANGLE copies it from the SDK; fetched by fetch_sdk_redist.sh) ──
REDIST = '/home/chromium/sdk-redist/out/Windows Kits/10/Redist'
if os.path.isdir(REDIST):
    shutil.copytree(REDIST, f'{wk}/Redist', dirs_exist_ok=True)
    print('copied Redist/D3D from', REDIST)
else:
    print('WARNING: run fetch_sdk_redist.sh first (d3dcompiler_47.dll missing -> ANGLE link step fails)')

# ── DIA SDK (fetched by fetch_sdk_redist.sh; vsix folder names are percent-encoded) ──
DIA = '/home/chromium/sdk-redist/dia/x/Contents/DIA%20SDK'
if os.path.isdir(DIA):
    shutil.rmtree(f'{ROOT}/DIA SDK', ignore_errors=True)
    shutil.copytree(DIA, f'{ROOT}/DIA SDK')
    print('copied DIA SDK')
else:
    print('WARNING: DIA SDK missing (dia2.h) -> DXC dxildia fails')

# ── build/win_toolchain.json: what depot_tools' get_toolchain_if_necessary.py would write ──
# `version` must equal vs_toolchain.GetVisualStudioVersion() ("2026" with DEPOT_TOOLS_WIN_TOOLCHAIN=1),
# otherwise vs_toolchain.py tries to "update" (download) the toolchain again.
SRC = '/home/chromium/project-A'
for d in ('sys64', 'sys32', 'wdk'):
    os.makedirs(f'{ROOT}/{d}', exist_ok=True)
json.dump({
    'path': ROOT,
    'version': '2026',
    'win_sdk': wk,
    'wdk': f'{ROOT}/wdk',
    # Empty on purpose: vs_toolchain.py copy_dlls then does nothing. is_component_build=false links the CRT
    # statically (/MT), so msvcp140.dll & co. are not needed next to swan.exe.
    'runtime_dirs': [],
}, open(f'{SRC}/build/win_toolchain.json', 'w'), indent=2)
print('wrote', f'{SRC}/build/win_toolchain.json')
