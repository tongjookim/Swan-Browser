#!/bin/bash
# 전체 빌드를 "서비스 보호" 제한이 걸린 systemd 유닛(swan-build)으로 시작한다. 상태: systemctl status swan-build / logs/build.log
# CPU 상한은 시간대에 따라: 01:00~07:00(야간 부스트) 1000%, 그 외 400%. (타이머 swan-build-boost/normal 이 실행 중에도 전환)
systemctl reset-failed swan-build 2>/dev/null
H=$(date +%-H)
if [ "$H" -ge 1 ] && [ "$H" -lt 7 ]; then export SWAN_CPUQUOTA=1000% SWAN_CPUS=2-7,10-15; else export SWAN_CPUQUOTA=400% SWAN_CPUS=4-7,12-15; fi
exec /home/chromium/swan-build/limited_run.sh --detach swan-build -- /home/chromium/swan-build/run_build.sh
