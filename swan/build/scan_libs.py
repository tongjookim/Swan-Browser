#!/usr/bin/env python3
"""Collect every *.lib name referenced by the source tree (GN `libs`, #pragma comment(lib, ...), ldflags) -> lib_names.txt."""
import os, re, sys
ROOT = '/home/chromium/project-A'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/chromium/swan-build/lib_names.txt'
SKIP = {'out', '.git', 'node_modules', 'llvm-build', 'android_sdk', 'sysroot', 'test_data', 'testdata'}
EXT = ('.gn', '.gni', '.h', '.hpp', '.cc', '.cpp', '.c', '.cxx', '.inc', '.py', '.cmake', '.txt')
pat = re.compile(rb'(?<![A-Za-z0-9_./\\-])([A-Za-z][A-Za-z0-9_+.-]{0,60}\.[Ll][Ii][Bb])(?![A-Za-z0-9_])')
names, seen = set(), set()
for dp, dns, fns in os.walk(ROOT, followlinks=True):
    real = os.path.realpath(dp)
    if real in seen:
        dns[:] = []; continue
    seen.add(real)
    dns[:] = [d for d in dns if d not in SKIP]
    for fn in fns:
        if not fn.endswith(EXT): continue
        try: data = open(os.path.join(dp, fn), 'rb').read()
        except OSError: continue
        for m in pat.finditer(data): names.add(m.group(1).decode('ascii', 'replace'))
open(OUT, 'w').write('\n'.join(sorted(names)) + '\n')
print(len(names), 'lib names;', 'Cfgmgr32.lib' in names)
