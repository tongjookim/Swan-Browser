#!/bin/bash
# stage 3: 전체 빌드 (chrome 타깃). 마커: logs/build.{start,ok,fail}
export PATH=/home/chromium/depot_tools:$PATH DEPOT_TOOLS_UPDATE=0 GCLIENT_SUPPRESS_GIT_VERSION_WARNING=1
unset DEPOT_TOOLS_WIN_TOOLCHAIN     # 기본값(1) 이어야 SetEnv.x64.json 경로를 쓴다
L=/home/chromium/logs; cd /home/chromium/src
rm -f $L/build.ok $L/build.fail; date -Is > $L/build.start
if autoninja -C out/win -k 0 -j 8 chrome > $L/build.log 2>&1; then date -Is > $L/build.ok; else date -Is > $L/build.fail; fi
