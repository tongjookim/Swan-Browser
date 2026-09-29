#!/bin/bash
cd /home/chromium
~/.cargo/bin/xwin --accept-license --cache-dir /home/chromium/xwin-cache --arch x86_64 --variant desktop --include-atl splat --output /home/chromium/winsdk-raw --preserve-ms-arch-notation > logs/xwin.log 2>&1
echo "exit=$?" >> logs/xwin.log
