#!/bin/bash
export PATH=/home/chromium/depot_tools:$PATH DEPOT_TOOLS_UPDATE=0
cd /home/chromium/src
date -Is > /home/chromium/logs/sync.start
gclient sync --nohooks --no-history -j 16 > /home/chromium/logs/sync.log 2>&1
echo "exit=$?" >> /home/chromium/logs/sync.log
date -Is > /home/chromium/logs/sync.end
