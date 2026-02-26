#!/bin/bash
# PreToolUse Hook - 도구 사용 기록 + Task 에이전트 정보 저장

# Backstage 비활성 상태면 즉시 종료 (토큰 절약)
[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && exit 0

ACTIVE_AGENT_FILE="$HOME/.claude/plugins/backstage/active-agent.json"
HISTORY_FILE="$HOME/.claude/plugins/backstage/history.jsonl"
LAST_TOOL_FILE="$HOME/.claude/plugins/backstage/last-chris-tool.txt"

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# Chris(메인 Claude)가 직접 도구 사용 시 기록
# 읽기(Read/Glob/Grep)는 노이즈가 많으므로 10초 간격 제한
# 쓰기(Edit/Write/Bash)는 중요하므로 항상 기록
LAST_CHRIS_EPOCH_FILE="$HOME/.claude/plugins/backstage/last-chris-epoch.txt"

case "$tool_name" in
    Edit|Write|Bash)
        # 쓰기 도구: 항상 기록 (중요한 작업)
        case "$tool_name" in
            Edit)
                target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                emoji="✏️"; verb="수정 중" ;;
            Write)
                target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                emoji="📝"; verb="작성 중" ;;
            Bash)
                target=$(echo "$input" | jq -r '.tool_input.command // ""' | head -c 30)
                emoji="💻"; verb="실행 중" ;;
        esac

        ts=$(date '+%H:%M:%S')
        epoch=$(date '+%s')
        msg="$emoji $target $verb"

        mkdir -p "$(dirname "$HISTORY_FILE")"
        jq -nc --arg ts "$ts" --arg ep "$epoch" --arg msg "$msg" \
            '{ts:$ts,epoch:($ep|tonumber),type:"work",speaker:"Chris",role:"boss",msg:$msg}' >> "$HISTORY_FILE"
        echo "$epoch" > "$LAST_CHRIS_EPOCH_FILE"
        ;;
    Read|Glob|Grep)
        # 읽기 도구: 10초 간격으로만 기록 (노이즈 방지)
        now_epoch=$(date '+%s')
        last_epoch=0
        [ -f "$LAST_CHRIS_EPOCH_FILE" ] && last_epoch=$(cat "$LAST_CHRIS_EPOCH_FILE" 2>/dev/null)
        [ -z "$last_epoch" ] && last_epoch=0

        if [ $((now_epoch - last_epoch)) -ge 10 ]; then
            case "$tool_name" in
                Read)
                    target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                    emoji="📖"; verb="확인 중" ;;
                Glob)
                    target=$(echo "$input" | jq -r '.tool_input.pattern // ""')
                    emoji="🔍"; verb="찾는 중" ;;
                Grep)
                    target=$(echo "$input" | jq -r '.tool_input.pattern // ""' | head -c 20)
                    emoji="🔎"; verb="검색 중" ;;
            esac

            ts=$(date '+%H:%M:%S')
            msg="$emoji $target $verb"

            mkdir -p "$(dirname "$HISTORY_FILE")"
            jq -nc --arg ts "$ts" --arg ep "$now_epoch" --arg msg "$msg" \
                '{ts:$ts,epoch:($ep|tonumber),type:"work",speaker:"Chris",role:"boss",msg:$msg}' >> "$HISTORY_FILE"
            echo "$now_epoch" > "$LAST_CHRIS_EPOCH_FILE"
        fi
        ;;
esac

if [ "$tool_name" = "Task" ]; then
    agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // "unknown"')
    description=$(echo "$input" | jq -r '.tool_input.description // ""')

    if [ "$agent_type" != "dialogue-generator" ]; then
        case "$agent_type" in
            explore|explore-medium) agent_name="Jake" ;;
            oracle|oracle-medium) agent_name="David" ;;
            oracle-low) agent_name="Danny" ;;
            sisyphus-junior) agent_name="Kevin" ;;
            sisyphus-junior-low) agent_name="Ken" ;;
            sisyphus-junior-high) agent_name="Karl" ;;
            frontend-engineer*) agent_name="Sophie" ;;
            document-writer) agent_name="Emily" ;;
            librarian*) agent_name="Michael" ;;
            prometheus) agent_name="Alex" ;;
            momus) agent_name="Rachel" ;;
            metis) agent_name="Tom" ;;
            multimodal-looker) agent_name="Luna" ;;
            qa-tester) agent_name="Sam" ;;
            *) agent_name="Agent" ;;
        esac

        mkdir -p "$(dirname "$ACTIVE_AGENT_FILE")"
        jq -nc --arg type "$agent_type" --arg name "$agent_name" --arg desc "$description" \
            '{type:$type, name:$name, description:$desc, start_time:'$(date +%s)'}' > "$ACTIVE_AGENT_FILE"
    fi
fi

exit 0
