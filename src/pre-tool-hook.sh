#!/bin/bash
# PreToolUse Hook - Task 호출 감지
# Claude Code에서 Task tool 호출 시 실행됨

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
FORMATTER="$SCRIPT_DIR/formatter.sh"
DEBUG_LOG="$PLUGIN_DIR/debug.log"

# 디버그 로그 (선택적)
if [ "${BACKSTAGE_DEBUG:-false}" = "true" ]; then
    mkdir -p "$(dirname "$DEBUG_LOG")"
    echo "[$(date '+%H:%M:%S')] PreToolUse hook called" >> "$DEBUG_LOG"
fi

# stdin에서 JSON 입력 읽기
input=$(cat)

# tool_name 확인 - Task만 처리
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

if [ "$tool_name" != "Task" ]; then
    exit 0
fi

# Task 정보 추출
agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // .tool_input.agent // "unknown"')
prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""')

# 오피스 형식으로 출력 (stderr로 - Claude Code UI에 표시됨)
"$FORMATTER" assign "$agent_type" "$prompt" >&2

exit 0
