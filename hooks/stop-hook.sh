#!/bin/bash
# Stop Hook - 매 턴 종료 시 실행 (세션 종료 아님!)
# NOTE:
# - 서버는 10분 idle 시 auto-shutdown, 수동 종료는 /server off
# - 세션 전체 종료 처리는 session-end-hook.sh 로 위임
# - 여기서는 매 턴 실행되므로 **경량 작업만** 수행 (무거운 IO 금지)

# Backstage 비활성이면 즉시 종료
[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{"continue":true}' && exit 0
exec 2>/dev/null

PLUGIN_DIR="$HOME/.claude/plugins/backstage"
DEBUG_LOG="$PLUGIN_DIR/debug-hook.log"
PENDING_STEPS_FILE="$PLUGIN_DIR/pending-steps.jsonl"

# I6: debug-hook.log 가 5MB 초과하면 tail 2000 줄만 남기고 rotate (턴당 stat 1회)
if [ -f "$DEBUG_LOG" ]; then
    size=$(stat -f%z "$DEBUG_LOG" 2>/dev/null || stat -c%s "$DEBUG_LOG" 2>/dev/null || echo 0)
    if [ "$size" -gt 5242880 ]; then
        tail -n 2000 "$DEBUG_LOG" > "${DEBUG_LOG}.tmp" && mv "${DEBUG_LOG}.tmp" "$DEBUG_LOG"
    fi
fi

# pending-steps 는 턴이 끝나면 더 이상 관련 없음 (다음 사용자 질문에서 새로 쌓임)
[ -f "$PENDING_STEPS_FILE" ] && : > "$PENDING_STEPS_FILE"

echo '{"continue":true}'
exit 0
