#!/bin/bash
# Agent Office Formatter
# 에이전트 통신을 IT 스타트업 오피스 스타일로 변환

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
CHARACTERS_FILE="$SCRIPT_DIR/characters.json"
HISTORY_FILE="$PLUGIN_DIR/history.log"

# jq 확인
if ! command -v jq &> /dev/null; then
    exit 0
fi

# 캐릭터 정보 가져오기
get_character_name() {
    local agent_type="$1"
    jq -r --arg type "$agent_type" '.agents[$type].name // "Unknown"' "$CHARACTERS_FILE"
}

get_random_line() {
    local agent_type="$1"
    local line_type="$2"

    local lines=$(jq -r --arg type "$agent_type" --arg lt "$line_type" \
        '.agents[$type][$lt] // ["..."] | .[]' "$CHARACTERS_FILE")

    echo "$lines" | shuf -n 1
}

get_boss_reaction() {
    local reaction_type="$1"
    jq -r --arg rt "$reaction_type" \
        '.boss_reactions[$rt] // [""] | .[]' "$CHARACTERS_FILE" | shuf -n 1
}

# 프롬프트 요약 (첫 80자)
summarize_prompt() {
    local prompt="$1"
    local summary=$(echo "$prompt" | head -c 80 | tr '\n' ' ')
    if [ ${#prompt} -gt 80 ]; then
        summary="${summary}..."
    fi
    echo "$summary"
}

# 오피스 형식으로 변환
format_assignment() {
    local agent_type="$1"
    local prompt="$2"
    local timestamp=$(date '+%H:%M:%S')

    local agent_name=$(get_character_name "$agent_type")
    local boss_line=$(get_boss_reaction "assign")
    local agent_response=$(get_random_line "$agent_type" "working_lines")
    local summary=$(summarize_prompt "$prompt")

    # 출력
    echo ""
    echo "━━━ Backstage [$timestamp] ━━━"
    echo ""
    echo "Chris (tech-lead) → $agent_name ($agent_type):"
    echo "  \"$boss_line $summary\""
    echo ""
    echo "$agent_name:"
    echo "  \"$agent_response\""
    echo ""

    # 히스토리에 기록
    mkdir -p "$(dirname "$HISTORY_FILE")"
    echo "[$timestamp] Chris → $agent_name ($agent_type): $summary" >> "$HISTORY_FILE"
    echo "[$timestamp] $agent_name: $agent_response" >> "$HISTORY_FILE"
}

format_result() {
    local agent_type="$1"
    local success="$2"
    local result="$3"
    local timestamp=$(date '+%H:%M:%S')

    local agent_name=$(get_character_name "$agent_type")
    local summary=$(summarize_prompt "$result")

    echo ""
    echo "━━━ Backstage [$timestamp] ━━━"
    echo ""

    if [ "$success" = "true" ]; then
        local agent_line=$(get_random_line "$agent_type" "success_lines")
        local boss_reaction=$(get_boss_reaction "success")

        echo "$agent_name ($agent_type):"
        echo "  \"$agent_line\""
        echo "  → $summary"
        echo ""
        echo "Chris:"
        echo "  \"$boss_reaction\""

        echo "[$timestamp] $agent_name: $agent_line" >> "$HISTORY_FILE"
        echo "[$timestamp] Chris: $boss_reaction" >> "$HISTORY_FILE"
    else
        local agent_line=$(get_random_line "$agent_type" "fail_lines")
        local boss_reaction=$(get_boss_reaction "fail")

        echo "$agent_name ($agent_type):"
        echo "  \"$agent_line\""
        echo "  → $summary"
        echo ""
        echo "Chris:"
        echo "  \"$boss_reaction\""

        echo "[$timestamp] $agent_name: $agent_line" >> "$HISTORY_FILE"
        echo "[$timestamp] Chris: $boss_reaction" >> "$HISTORY_FILE"
    fi
    echo ""
}

# 메인
case "$1" in
    "assign")
        format_assignment "$2" "$3"
        ;;
    "result")
        format_result "$2" "$3" "$4"
        ;;
    *)
        echo "Usage: $0 {assign|result} <agent_type> <content> [success]"
        ;;
esac
