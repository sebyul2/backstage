#!/bin/bash
# Agent Office Formatter
# 에이전트 통신을 IT 스타트업 오피스 스타일로 변환
# AI(Haiku)로 동적 대화 생성, 실패 시 폴백 대사 사용

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
CHARACTERS_FILE="$SCRIPT_DIR/characters.json"
HISTORY_FILE="$PLUGIN_DIR/history.log"
DIALOGUE_GENERATOR="$SCRIPT_DIR/dialogue-generator.ts"

# jq 확인
if ! command -v jq &> /dev/null; then
    exit 0
fi

# AI 대화 생성 시도
generate_ai_dialogue() {
    local type="$1"
    local agent_type="$2"
    local description="$3"
    local result="$4"

    # bun과 ANTHROPIC_API_KEY 확인
    if ! command -v bun &> /dev/null || [ -z "$ANTHROPIC_API_KEY" ]; then
        echo "{}"
        return
    fi

    # AI 대화 생성 (타임아웃 3초)
    local dialogue
    dialogue=$(timeout 3 bun "$DIALOGUE_GENERATOR" "$type" "$agent_type" "$description" "$result" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$dialogue" ]; then
        echo "$dialogue"
    else
        echo "{}"
    fi
}

# 작업 유형 추론
infer_task_type() {
    local desc="$1"
    local agent_type="$2"
    local desc_lower=$(echo "$desc" | tr '[:upper:]' '[:lower:]')

    if echo "$desc_lower" | grep -qE "찾|검색|조회|확인|읽|어디|뭐가|있는지|알려|목록|리스트"; then
        echo "search"
    elif echo "$desc_lower" | grep -qE "분석|왜|원인|디버그|문제|에러|버그|이유"; then
        echo "analyze"
    elif echo "$desc_lower" | grep -qE "수정|변경|업데이트|고치|fix|edit|change"; then
        echo "modify"
    elif echo "$desc_lower" | grep -qE "생성|만들|추가|작성|new|create|add"; then
        echo "create"
    elif echo "$desc_lower" | grep -qE "삭제|제거|remove|delete"; then
        echo "delete"
    elif echo "$desc_lower" | grep -qE "테스트|test|검증"; then
        echo "test"
    else
        case "$agent_type" in
            explore|explore-medium|librarian|librarian-low) echo "search" ;;
            oracle|oracle-medium|oracle-low|metis|momus) echo "analyze" ;;
            sisyphus-junior*) echo "modify" ;;
            frontend-engineer*|document-writer) echo "create" ;;
            qa-tester) echo "test" ;;
            *) echo "general" ;;
        esac
    fi
}

# 폴백 대사 - 할당
get_fallback_assign() {
    local task_type="$1"
    local lines=""
    case "$task_type" in
        search) lines="야 이거 어딨어\n찾아봐 급함 ㅋㅋ\n어디갔지 이거" ;;
        analyze) lines="이거 왜이래 봐봐\n뭔가 이상한데?\n분석 좀 ㄱㄱ" ;;
        modify) lines="이거 좀 손봐줘\n고쳐야되는데 ㅠ\n수정 ㄱ" ;;
        create) lines="새로 만들어야해\n하나 뚝딱해줘\n추가 ㄱㄱ" ;;
        delete) lines="이거 날려줘\n정리 좀 ㅋㅋ\n삭제 ㄱ" ;;
        test) lines="테스트 ㄱㄱ\n돌려봐 한번\n검증 좀" ;;
        *) lines="이거 좀\n부탁 ㅋㅋ\n도와줘" ;;
    esac
    echo -e "$lines" | shuf -n 1
}

# 폴백 대사 - 작업 중
get_fallback_working() {
    local agent_type="$1"
    local lines=$(jq -r --arg type "$agent_type" '.agents[$type].working_lines // ["작업 중..."] | .[]' "$CHARACTERS_FILE" 2>/dev/null)
    echo "$lines" | shuf -n 1
}

# 폴백 대사 - 완료
get_fallback_complete() {
    local agent_type="$1"
    local lines=$(jq -r --arg type "$agent_type" '.agents[$type].success_lines // ["완료!"] | .[]' "$CHARACTERS_FILE" 2>/dev/null)
    echo "$lines" | shuf -n 1
}

# 폴백 대사 - 보스 반응
get_fallback_boss_reaction() {
    local task_type="$1"
    local success="$2"
    local lines=""
    if [ "$success" = "true" ]; then
        case "$task_type" in
            search) lines="오 ㅋㅋ 찾았네\n거기 있었구나 ㅋ\nㄳㄳ" ;;
            analyze) lines="아~ 그래서\n오호 이해됐어\nㅇㅋㅇㅋ" ;;
            modify) lines="PR ㄱㄱ\n리뷰 달아놓을게\nㅇㅋ 머지하자 ㅋ" ;;
            create) lines="오 괜찮은데? ㅋㅋ\n굳굳\nㅇㅋ 좋아" ;;
            delete) lines="깔끔 ㅋㅋ\n정리 완 ㄱㅅ\nㅇㅋㅇㅋ" ;;
            test) lines="통과? ㅋㅋ\n결과 어때\nㅇㅋ 굳" ;;
            *) lines="ㅇㅋ\nㄱㅅㄱㅅ\n굳 ㅋㅋ" ;;
        esac
    else
        lines="왜 안돼 ㅋㅋ\n다시 ㄱ\n뭐가 문제"
    fi
    echo -e "$lines" | shuf -n 1
}

# 캐릭터 이름 가져오기
get_character_name() {
    local agent_type="$1"
    jq -r --arg type "$agent_type" '.agents[$type].name // "Unknown"' "$CHARACTERS_FILE"
}

# 프롬프트 요약
summarize_prompt() {
    local prompt="$1"
    local summary=$(echo "$prompt" | head -c 50 | tr '\n' ' ' | tr -d '\r')
    if [ ${#prompt} -gt 50 ]; then
        summary="${summary}..."
    fi
    echo "$summary"
}

# 결과 요약
summarize_result() {
    local result="$1"
    local summary=$(echo "$result" | grep -v "^#" | grep -v "^-" | grep -v "^|" | grep -v "agentId:" | head -3 | tr '\n' ' ' | sed 's/[*`]//g' | head -c 40)
    if [ -n "$summary" ] && [ ${#summary} -gt 10 ]; then
        echo "$summary..."
    fi
}

# 할당 포맷
format_assignment() {
    local agent_type="$1"
    local prompt="$2"
    local timestamp=$(date '+%H:%M:%S')

    local agent_name=$(get_character_name "$agent_type")
    local summary=$(summarize_prompt "$prompt")
    local task_type=$(infer_task_type "$prompt" "$agent_type")

    # AI 대화 생성 시도
    local ai_dialogue=$(generate_ai_dialogue "assign" "$agent_type" "$summary")
    local boss_line=$(echo "$ai_dialogue" | jq -r '.boss // empty')
    local agent_line=$(echo "$ai_dialogue" | jq -r '.agent // empty')

    # 폴백
    [ -z "$boss_line" ] && boss_line=$(get_fallback_assign "$task_type")
    [ -z "$agent_line" ] && agent_line=$(get_fallback_working "$agent_type")

    # 출력
    echo ""
    echo "━━━ Backstage [$timestamp] ━━━"
    echo ""
    echo "Chris (tech-lead) → $agent_name ($agent_type):"
    echo "  \"$boss_line\" ($summary)"
    echo ""
    echo "$agent_name ($agent_type):"
    echo "  \"$agent_line\""
    echo ""

    # 히스토리
    mkdir -p "$(dirname "$HISTORY_FILE")"
    echo "[$timestamp] Chris (tech-lead) → $agent_name ($agent_type): \"$boss_line\"" >> "$HISTORY_FILE"
    echo "[$timestamp] $agent_name ($agent_type): $agent_line" >> "$HISTORY_FILE"
}

# 결과 포맷
format_result() {
    local agent_type="$1"
    local success="$2"
    local result="$3"
    local timestamp=$(date '+%H:%M:%S')

    local agent_name=$(get_character_name "$agent_type")
    local result_summary=$(summarize_result "$result")
    local task_type=$(infer_task_type "" "$agent_type")

    local dialogue_type="complete"
    [ "$success" != "true" ] && dialogue_type="fail"

    # AI 대화 생성 시도
    local ai_dialogue=$(generate_ai_dialogue "$dialogue_type" "$agent_type" "" "$result_summary")
    local agent_line=$(echo "$ai_dialogue" | jq -r '.agent // empty')
    local boss_line=$(echo "$ai_dialogue" | jq -r '.boss // empty')

    # 폴백
    if [ -z "$agent_line" ]; then
        if [ "$success" = "true" ]; then
            agent_line=$(get_fallback_complete "$agent_type")
        else
            agent_line=$(jq -r --arg type "$agent_type" '.agents[$type].fail_lines // ["실패..."] | .[]' "$CHARACTERS_FILE" 2>/dev/null | shuf -n 1)
        fi
    fi
    [ -z "$boss_line" ] && boss_line=$(get_fallback_boss_reaction "$task_type" "$success")

    # 출력
    echo ""
    echo "━━━ Backstage [$timestamp] ━━━"
    echo ""
    echo "$agent_name ($agent_type):"
    echo "  \"$agent_line\""
    if [ -n "$result_summary" ]; then
        echo "  → $result_summary"
    fi
    echo ""
    echo "Chris (tech-lead):"
    echo "  \"$boss_line\""
    echo ""

    # 히스토리
    echo "[$timestamp] $agent_name ($agent_type): $agent_line" >> "$HISTORY_FILE"
    echo "[$timestamp] Chris (tech-lead): $boss_line" >> "$HISTORY_FILE"
}

# 메인
case "$1" in
    "assign") format_assignment "$2" "$3" ;;
    "result") format_result "$2" "$3" "$4" ;;
    *) echo "Usage: $0 {assign|result} <agent_type> <content> [success]" ;;
esac
