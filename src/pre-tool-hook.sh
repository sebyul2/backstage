#!/bin/bash
# PreToolUse Hook - Task 호출 감지
# Claude Code에서 Task tool 호출 시 실행됨

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
FORMATTER="$SCRIPT_DIR/formatter.sh"

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

# 오피스 형식으로 출력
output=$("$FORMATTER" assign "$agent_type" "$prompt" 2>&1)

# JSON으로 additionalContext 반환 (Claude Code가 표시함)
jq -n --arg ctx "$output" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": $ctx
  }
}'

exit 0
