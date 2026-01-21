#!/bin/bash
# PostToolUse Hook - Task 결과/실패 감지
# Claude Code에서 Task tool 완료 시 실행됨

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORMATTER="$SCRIPT_DIR/formatter.sh"

# stdin에서 JSON 입력 읽기
input=$(cat)

# tool_name 확인 - Task만 처리
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

if [ "$tool_name" != "Task" ]; then
    exit 0
fi

# 결과 정보 추출
agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // .tool_input.agent // "unknown"')
tool_result=$(echo "$input" | jq -r '.tool_result // ""')

# 성공/실패 판단 (에러 키워드 확인)
success="true"
if echo "$tool_result" | grep -qi -E "(error|failed|exception|실패|에러|Error|Failed)"; then
    success="false"
fi

# 오피스 형식으로 출력 (stderr로)
"$FORMATTER" result "$agent_type" "$success" "$tool_result" >&2

exit 0
