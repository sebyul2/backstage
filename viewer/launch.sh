#!/bin/bash
# Backstage Viewer - Launch Script
# Bun 서버를 백그라운드로 시작하고 브라우저를 엶

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_FILE="$SCRIPT_DIR/server.ts"
PID_FILE="$HOME/.claude/plugins/backstage/viewer.pid"
PORT="${BACKSTAGE_PORT:-7777}"

mkdir -p "$(dirname "$PID_FILE")"

# 이미 실행 중인지 확인
if [ -f "$PID_FILE" ]; then
    existing_pid=$(cat "$PID_FILE")
    if kill -0 "$existing_pid" 2>/dev/null; then
        echo "Backstage viewer already running (PID: $existing_pid)"
        echo "Opening browser..."
        open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

# Bun 서버 백그라운드 시작 (bun 직접 실행 — bun run은 자식 프로세스 생성으로 PID 불일치)
BACKSTAGE_PORT="$PORT" nohup bun "$SERVER_FILE" > /tmp/backstage-viewer.log 2>&1 &
SERVER_PID=$!
disown $SERVER_PID 2>/dev/null
echo "$SERVER_PID" > "$PID_FILE"

# 서버 시작 대기
sleep 0.5

if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Backstage viewer started (PID: $SERVER_PID)"
    echo "URL: http://localhost:$PORT"
    open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null
else
    echo "Failed to start viewer. Check /tmp/backstage-viewer.log"
    rm -f "$PID_FILE"
    exit 1
fi
