#!/bin/bash
# SessionEnd Hook - 세션 종료 시 임시 상태 정리
# v2.1.101+: subagent --resume 전환 시에도 트리거됨
# 세션이 끝나면 pending-steps / active-agent / 오래된 queue 항목 정리

[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{"continue":true}' && exit 0
exec 2>/dev/null

PLUGIN_DIR="$HOME/.claude/plugins/backstage"
ACTIVE_AGENT_FILE="$PLUGIN_DIR/active-agent.json"
PENDING_STEPS_FILE="$PLUGIN_DIR/pending-steps.jsonl"
DIALOGUE_QUEUE_FILE="$PLUGIN_DIR/dialogue-queue.jsonl"
DEBUG_LOG="$PLUGIN_DIR/debug-hook.log"
HISTORY_FILE="$PLUGIN_DIR/history.jsonl"

mkdir -p "$(dirname "$DEBUG_LOG")"
echo "[$(date '+%H:%M:%S')] session-end" >> "$DEBUG_LOG"

# 1) active-agent 제거 (캐릭터 정리 신호)
[ -f "$ACTIVE_AGENT_FILE" ] && rm -f "$ACTIVE_AGENT_FILE"

# 2) pending-steps truncate (다음 세션 노이즈 방지)
[ -f "$PENDING_STEPS_FILE" ] && : > "$PENDING_STEPS_FILE"

# 3) dialogue-queue 에서 10분 이상 묵은 pending 항목 제거
if [ -f "$DIALOGUE_QUEUE_FILE" ]; then
    cutoff=$(( $(date +%s) - 600 ))
    tmpfile="${DIALOGUE_QUEUE_FILE}.tmp.$$"
    jq -c --argjson cut "$cutoff" 'select(.epoch >= $cut)' "$DIALOGUE_QUEUE_FILE" > "$tmpfile" 2>/dev/null \
        && mv "$tmpfile" "$DIALOGUE_QUEUE_FILE" \
        || rm -f "$tmpfile"
fi

# 4) 세션 종료 이벤트 기록 (뷰어가 원하면 잔존 캐릭터 일괄 퇴근 처리)
ts=$(date '+%H:%M:%S')
ep=$(date '+%s')
reason=$(echo "$input" | jq -r '.reason // ""' 2>/dev/null)
mkdir -p "$(dirname "$HISTORY_FILE")"
jq -nc --arg ts "$ts" --arg ep "$ep" --arg reason "$reason" \
    '{ts:$ts,epoch:($ep|tonumber),type:"session-end",speaker:"system",role:"system",msg:$reason}' >> "$HISTORY_FILE"

echo '{"continue":true}'
exit 0
