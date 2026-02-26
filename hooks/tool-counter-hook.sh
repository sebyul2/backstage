#!/bin/bash
# Tool Counter Hook - 모든 도구 호출을 카운트
# claude-hud처럼 도구 사용 현황을 history.jsonl에 기록

PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
COUNTER_FILE="$PLUGIN_DIR/tool-counts.json"

# stdin에서 JSON 입력 읽기
input=$(cat)

# tool_name 추출
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# 빈 이름이면 무시
[ -z "$tool_name" ] && exit 0

# dialogue-generator Task는 무시 (backstage 내부용)
if [ "$tool_name" = "Task" ]; then
    agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // ""')
    [ "$agent_type" = "dialogue-generator" ] && exit 0
fi

# 카운터 파일 초기화 (없으면)
if [ ! -f "$COUNTER_FILE" ]; then
    echo '{"counts":{},"last_update":0}' > "$COUNTER_FILE"
fi

# 현재 epoch
now=$(date +%s)

# 기존 카운트 읽기
counts=$(cat "$COUNTER_FILE")
last_update=$(echo "$counts" | jq -r '.last_update // 0')

# 30초 이상 지났으면 리셋
if [ $((now - last_update)) -gt 30 ]; then
    counts='{"counts":{},"last_update":'$now'}'
fi

# 카운트 증가
new_counts=$(echo "$counts" | jq --arg tool "$tool_name" --arg now "$now" '
    .counts[$tool] = ((.counts[$tool] // 0) + 1) |
    .last_update = ($now | tonumber)
')

echo "$new_counts" > "$COUNTER_FILE"

# Chris(메인 Claude) 도구 사용 기록
HISTORY_FILE="$PLUGIN_DIR/history.jsonl"
LAST_CHRIS_TOOL="$PLUGIN_DIR/last-chris-tool.txt"

case "$tool_name" in
    Read|Glob|Grep|Edit|Write|Bash)
        case "$tool_name" in
            Read)
                target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                emoji="📖"; verb="읽는 중" ;;
            Glob)
                target=$(echo "$input" | jq -r '.tool_input.pattern // ""')
                emoji="🔍"; verb="찾는 중" ;;
            Grep)
                target=$(echo "$input" | jq -r '.tool_input.pattern // ""' | head -c 20)
                emoji="🔎"; verb="검색 중" ;;
            Edit)
                target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                emoji="✏️"; verb="수정 중" ;;
            Write)
                target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                emoji="📝"; verb="작성 중" ;;
            Bash)
                target=$(echo "$input" | jq -r '.tool_input.command // ""' | head -c 25)
                emoji="💻"; verb="실행 중" ;;
        esac

        tool_id="${tool_name}:${target}"
        last_tool=""
        [ -f "$LAST_CHRIS_TOOL" ] && last_tool=$(cat "$LAST_CHRIS_TOOL" 2>/dev/null)

        if [ "$tool_id" != "$last_tool" ]; then
            echo "$tool_id" > "$LAST_CHRIS_TOOL"
            ts=$(date '+%H:%M:%S')
            epoch=$(date '+%s')
            msg="$emoji $target $verb"
            jq -nc --arg ts "$ts" --arg ep "$epoch" --arg msg "$msg" \
                '{ts:$ts,epoch:($ep|tonumber),type:"work",speaker:"Chris",role:"boss",msg:$msg}' >> "$HISTORY_FILE"
        fi
        ;;
esac

exit 0
