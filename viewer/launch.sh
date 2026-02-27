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

# Bun 서버를 새 세션으로 시작 (부모 셸 프로세스 그룹에서 분리 → SIGTERM 전파 차단)
# macOS에 setsid가 없으므로 perl POSIX::setsid()로 대체
BACKSTAGE_PORT="$PORT" nohup perl -e 'use POSIX "setsid"; setsid(); exec @ARGV' bun "$SERVER_FILE" > /tmp/backstage-viewer.log 2>&1 &
SERVER_PID=$!
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
