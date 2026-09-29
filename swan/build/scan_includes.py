#!/usr/bin/env python3
"""Collect every #include/#import name (both <> and "") used by the source tree -> include_names.txt.
Own walker (follows symlinks) instead of grep: ugrep silently missed files in a whole-tree scan."""
import os, re, sys
ROOT = '/home/chromium/project-A'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/chromium/swan-build/include_names.txt'
SKIP = {'out', '.git', 'node_modules', 'llvm-build', 'android_sdk', 'sysroot', 'test_data', 'testdata'}
EXT = ('.h', '.hpp', '.hh', '.inc', '.cc', '.cpp', '.cxx', '.c')
pat = re.compile(rb'^[ \t]*#[ \t]*(?:include|import)[ \t]*[<"]([^>"\r\n]+)[>"]', re.M)
names, files = set(), 0
seen_dirs = set()
for dp, dns, fns in os.walk(ROOT, followlinks=True):
    real = os.path.realpath(dp)
    if real in seen_dirs:
        dns[:] = []
        continue
    seen_dirs.add(real)
    dns[:] = [d for d in dns if d not in SKIP]
    for fn in fns:
        if not fn.endswith(EXT):
            continue
        try:
            data = open(os.path.join(dp, fn), 'rb').read()
        except OSError:
            continue
        files += 1
        for m in pat.finditer(data):
            names.add(m.group(1).decode('utf-8', 'replace').strip())
open(OUT, 'w', encoding='utf-8').write('\n'.join(sorted(names)) + '\n')
print(files, 'files;', len(names), 'names;', 'ObjIdl.h' in names)
