#!/bin/bash
# SubagentStop Hook - 서브에이전트 종료 시 done 이벤트 발행
# Claude Code v2.1.x+ 가 제공하는 SubagentStop 이벤트를 이용해
# 캐릭터(Jake/David/등)를 정확한 완료 시점에 퇴근시킴.

[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{"continue":true}' && exit 0
exec 2>/dev/null

PLUGIN_DIR="$HOME/.claude/plugins/backstage"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$PLUGIN_DIR}"
mkdir -p "$STATE_DIR"
HISTORY_FILE="$STATE_DIR/history.jsonl"
DEBUG_LOG="$STATE_DIR/debug-hook.log"

input=$(cat)
# SubagentStop 입력은 subagent_type / agent_type / subagent.name 등 다양한 키로 올 수 있음
agent_type=$(echo "$input" | jq -r '.subagent_type // .agent_type // .subagent.type // .tool_input.subagent_type // ""')
agent_short=$(echo "$agent_type" | sed 's/^[^:]*://')

mkdir -p "$(dirname "$DEBUG_LOG")"
echo "[$(date '+%H:%M:%S')] subagent-stop type=$agent_type short=$agent_short" >> "$DEBUG_LOG"

case "$agent_short" in
    explore|explore-medium) done_name="Jake" ;;
    oracle|oracle-medium|oracle-low|architect) done_name="David" ;;
    sisyphus-junior|sisyphus-junior-low|sisyphus-junior-high|executor) done_name="Kevin" ;;
    frontend-engineer|frontend-engineer-low|frontend-engineer-high|designer) done_name="Sophie" ;;
    document-writer|writer) done_name="Emily" ;;
    librarian|librarian-low) done_name="Michael" ;;
    prometheus|planner) done_name="Alex" ;;
    momus) done_name="Rachel" ;;
    metis) done_name="Tom" ;;
    multimodal-looker) done_name="Luna" ;;
    qa-tester) done_name="Sam" ;;
    dialogue-generator) done_name="" ;;  # 대사 생성 에이전트는 캐릭터 없음
    *) done_name="" ;;
esac

if [ -n "$done_name" ]; then
    ts=$(date '+%H:%M:%S')
    ep=$(date '+%s')
    mkdir -p "$(dirname "$HISTORY_FILE")"
    jq -nc --arg ts "$ts" --arg ep "$ep" --arg sp "$done_name" --arg role "$agent_short" \
        '{ts:$ts,epoch:($ep|tonumber),type:"done",speaker:$sp,role:$role,msg:""}' >> "$HISTORY_FILE"
fi

echo '{"continue":true}'
exit 0
