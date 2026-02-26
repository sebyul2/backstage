#!/bin/bash
# Stop Hook - 세션 종료 시 viewer 서버 정리

PID_FILE="$HOME/.claude/plugins/backstage/viewer.pid"

if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null
    fi
    rm -f "$PID_FILE"
fi

echo '{"continue": true}'
exit 0
