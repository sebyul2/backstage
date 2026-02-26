#!/bin/bash
# Stop Hook - 세션 종료 시 viewer 서버 강제 종료

# PID 파일로 시도
PID_FILE="$HOME/.claude/plugins/backstage/viewer.pid"
if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    kill "$pid" 2>/dev/null
    rm -f "$PID_FILE"
fi

# 포트 기반으로 확실히 종료 (PID 파일 없이 띄운 경우 대비)
lsof -ti:7777 | xargs kill -9 2>/dev/null

echo '{"continue": true}'
exit 0
