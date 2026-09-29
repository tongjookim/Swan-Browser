#!/bin/bash
# stage A: (동기화 종료 대기) → gclient runhooks → gn gen.  실패 시 즉시 멈추고 마커를 남긴다.
export PATH=/home/chromium/depot_tools:$PATH DEPOT_TOOLS_UPDATE=0
L=/home/chromium/logs; cd /home/chromium/src
rm -f $L/stageA.ok $L/stageA.fail
while [ ! -f $L/sync.end ]; do sleep 30; done
if ! tail -1 $L/sync.log | grep -q '^exit=0'; then echo "sync failed" > $L/stageA.fail; exit 1; fi
echo "[$(date -Is)] sync done, running hooks" >> $L/stageA.log
# Google 내부 Windows 툴체인 훅(vs_toolchain.py update, ciopfs/FUSE 필요)은 xwin 을 쓰므로 건너뛴다.
# ⚠ 훅에서만 0 — gn gen/빌드에서는 기본값(1)이어야 SetEnv.x64.json 경로를 쓴다.
if ! DEPOT_TOOLS_WIN_TOOLCHAIN=0 gclient runhooks -j 16 >> $L/hooks.log 2>&1; then echo "hooks failed (see hooks.log)" > $L/stageA.fail; exit 1; fi
echo "[$(date -Is)] hooks done, gn gen" >> $L/stageA.log
if ! gn gen out/win >> $L/gn_gen.log 2>&1; then echo "gn gen failed (see gn_gen.log)" > $L/stageA.fail; exit 1; fi
echo "[$(date -Is)] gn gen OK" >> $L/stageA.log
touch $L/stageA.ok
