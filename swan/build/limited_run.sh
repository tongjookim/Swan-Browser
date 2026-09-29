#!/bin/bash
# 서비스(nginx/php-fpm/MariaDB/CODA)를 보호하는 격리 실행기. 빌드 관련 모든 명령은 이 스크립트로 실행한다.
#   limited_run.sh [--detach NAME] -- 명령 인자...      (기본: 끝날 때까지 기다리며 출력/종료코드 전달)
#   --detach NAME: systemd 서비스로 분리 실행(세션과 무관하게 계속 실행), 상태: systemctl status NAME
# 제한: 낮 CPU 4코어(물리 코어 4-7 = 스레드 4-7,12-15 고정), 야간(01~07시) 10코어(코어 2-7). 코어 0-1 은 항상 서비스 전용으로 비움.
#       CPU/IO 가중치 최저, nice 19, 메모리 48GB(스왑 금지), 메모리 부족 시 이쪽이 먼저 종료.
set -e
PROPS=(-p CPUQuota=${SWAN_CPUQUOTA:-400%} -p AllowedCPUs=${SWAN_CPUS:-4-7,12-15} -p CPUWeight=1 -p IOWeight=1 -p Nice=19 -p MemoryMax=48G -p MemorySwapMax=0
       -p OOMScoreAdjust=1000 -p TasksMax=8192 --setenv=HOME=/root
       --setenv=PATH=/home/chromium/depot_tools:/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin
       --setenv=DEPOT_TOOLS_UPDATE=0 --setenv=GCLIENT_SUPPRESS_GIT_VERSION_WARNING=1)
if [ "$1" = "--detach" ]; then
  NAME="$2"; shift 2; [ "$1" = "--" ] && shift
  exec systemd-run --quiet --collect --unit="$NAME" --slice=swan-build.slice "${PROPS[@]}" "$@"
fi
[ "$1" = "--" ] && shift
exec systemd-run --quiet --collect --wait --pipe --slice=swan-build.slice "${PROPS[@]}" -p WorkingDirectory="$PWD" "$@"
