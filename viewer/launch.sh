#!/bin/bash
# Backstage Viewer - Launch Script
# server.ts가 스스로 데몬화하므로 bun 실행만 하면 됨

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_FILE="$SCRIPT_DIR/server.ts"
PORT="${BACKSTAGE_PORT:-7777}"

# 이미 실행 중인지 확인 (포트 체크)
if lsof -ti:"$PORT" > /dev/null 2>&1; then
    echo "Backstage viewer already running on port $PORT"
    open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null
    exit 0
fi

# 서버 시작 (server.ts가 자체 데몬화 → 즉시 리턴)
BACKSTAGE_PORT="$PORT" bun "$SERVER_FILE"

# 시작 확인
sleep 0.5
if lsof -ti:"$PORT" > /dev/null 2>&1; then
    echo "Backstage viewer started"
    echo "URL: http://localhost:$PORT"
    open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null
else
    echo "Failed to start viewer. Check /tmp/backstage-viewer.log"
    exit 1
fi
