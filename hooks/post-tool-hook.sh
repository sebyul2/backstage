#!/bin/bash
# PostToolUse Hook - dialogue-generator 결과 처리 + Task 완료 대화 트리거

# Backstage 비활성 상태면 즉시 종료 (토큰 절약)
[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && exit 0

HISTORY_FILE="$HOME/.claude/plugins/backstage/history.jsonl"
ACTIVE_AGENT_FILE="$HOME/.claude/plugins/backstage/active-agent.json"
DEBUG_LOG="$HOME/.claude/plugins/backstage/debug-hook.log"

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# DEBUG: 모든 호출 기록
mkdir -p "$(dirname "$DEBUG_LOG")"
echo "[$(date '+%H:%M:%S')] post-hook tool=$tool_name" >> "$DEBUG_LOG"

# Chris 도구 기록은 pre-tool-hook.sh에서 처리 (중복 방지)

# ── JSON 추출 함수: 혼합 텍스트에서 유효한 JSON 추출 ──────────
extract_json() {
    local text="$1"

    # 1) 직접 jq 파싱 시도 (순수 JSON인 경우)
    local direct=$(echo "$text" | jq -c '.' 2>/dev/null)
    if [ -n "$direct" ] && [ "$direct" != "null" ]; then
        echo "$direct"
        return
    fi

    # 2) 마크다운 코드블록에서 추출: ```json ... ``` 또는 ``` ... ```
    local from_block=$(echo "$text" | sed -n '/```[jJ]*[sS]*[oO]*[nN]*/,/```/{/```/d;p;}' | jq -c '.' 2>/dev/null)
    if [ -n "$from_block" ] && [ "$from_block" != "null" ]; then
        echo "$from_block"
        return
    fi

    # 3) python으로 첫 번째 유효 JSON 객체 추출 (가장 안정적)
    local from_python=$(python3 -c "
import json, re, sys
text = sys.stdin.read()
# Find all potential JSON objects
for m in re.finditer(r'\{', text):
    start = m.start()
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{': depth += 1
        elif text[i] == '}': depth -= 1
        if depth == 0:
            try:
                obj = json.loads(text[start:i+1])
                if 'lines' in obj or 'boss' in obj or 'agent' in obj:
                    print(json.dumps(obj, ensure_ascii=False))
                    sys.exit(0)
            except: pass
            break
" <<< "$text" 2>/dev/null)
    if [ -n "$from_python" ]; then
        echo "$from_python"
        return
    fi

    echo ""
}

# ── dialogue-generator Task 결과 처리 ────────────────────────────
if [ "$tool_name" = "Task" ]; then
    agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // .tool_input.agent // "unknown"')

    if [ "$agent_type" = "dialogue-generator" ]; then
        echo "[$(date '+%H:%M:%S')] DIALOGUE-GEN detected! extracting result..." >> "$DEBUG_LOG"
        tool_result=$(echo "$input" | jq -r '.tool_response.content[0].text // ""')
        echo "[$(date '+%H:%M:%S')] tool_result length=${#tool_result} first80=$(echo "$tool_result" | head -c 80)" >> "$DEBUG_LOG"
        prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""')

        timestamp=$(date '+%H:%M:%S')
        epoch=$(date '+%s')

        dialogue_type=$(echo "$prompt" | grep -o 'type: [a-z]*' | head -1 | cut -d' ' -f2)
        agent_name=$(echo "$prompt" | grep -oE 'agent: [A-Za-z]+' | head -1 | cut -d' ' -f2)
        agent_role=$(echo "$prompt" | grep -o 'agent_type: [a-z-]*' | head -1 | cut -d' ' -f2)

        [ -z "$dialogue_type" ] && dialogue_type="assign"
        [ -z "$agent_name" ] && agent_name="Agent"
        [ -z "$agent_role" ] && agent_role="agent"

        # JSON 추출 (혼합 텍스트 대응)
        json=$(extract_json "$tool_result")

        if [ -z "$json" ]; then
            echo "[$(date '+%H:%M:%S')] FAILED to extract JSON from dialogue-generator" >> "$DEBUG_LOG"
            exit 0
        fi

        mkdir -p "$(dirname "$HISTORY_FILE")"

        # 새 lines 배열 포맷: {"lines": [{"speaker": "boss", "msg": "..."}, ...]}
        lines_count=$(echo "$json" | jq '.lines | length' 2>/dev/null)
        if [ -n "$lines_count" ] && [ "$lines_count" -gt 0 ] 2>/dev/null; then
            for i in $(seq 0 $((lines_count - 1))); do
                speaker_type=$(echo "$json" | jq -r ".lines[$i].speaker // \"agent\"" 2>/dev/null)
                line_msg=$(echo "$json" | jq -r ".lines[$i].msg // empty" 2>/dev/null)

                [ -z "$line_msg" ] && continue

                if [ "$speaker_type" = "boss" ]; then
                    sp_name="Chris"; sp_role="boss"
                else
                    sp_name="$agent_name"; sp_role="$agent_role"
                fi

                line_type="$dialogue_type"
                [ "$dialogue_type" = "complete" ] && line_type="done"

                jq -nc --arg ts "$timestamp" --arg ep "$epoch" --arg type "$line_type" \
                    --arg speaker "$sp_name" --arg role "$sp_role" --arg msg "$line_msg" \
                    '{ts:$ts,epoch:($ep|tonumber),type:$type,speaker:$speaker,role:$role,msg:$msg}' >> "$HISTORY_FILE"
                epoch=$((epoch + 1))
            done
            exit 0
        fi

        # 기존 포맷: {"boss": "...", "agent": "..."}
        boss_line=$(echo "$json" | jq -r '.boss // empty' 2>/dev/null)
        agent_line=$(echo "$json" | jq -r '.agent // empty' 2>/dev/null)

        # work 타입: agent만
        if [ "$dialogue_type" = "work" ] && [ -n "$agent_line" ]; then
            jq -nc --arg ts "$timestamp" --arg ep "$epoch" --arg type "work" \
                --arg speaker "$agent_name" --arg role "$agent_role" --arg msg "$agent_line" \
                '{ts:$ts,epoch:($ep|tonumber),type:$type,speaker:$speaker,role:$role,msg:$msg}' >> "$HISTORY_FILE"
            exit 0
        fi

        if [ -n "$boss_line" ] && [ -n "$agent_line" ]; then
            if [ "$dialogue_type" = "complete" ]; then
                jq -nc --arg ts "$timestamp" --arg ep "$epoch" --arg type "done" \
                    --arg speaker "$agent_name" --arg role "$agent_role" --arg msg "$agent_line" \
                    '{ts:$ts,epoch:($ep|tonumber),type:$type,speaker:$speaker,role:$role,msg:$msg}' >> "$HISTORY_FILE"
                epoch=$((epoch + 1))
                jq -nc --arg ts "$timestamp" --arg ep "$epoch" --arg type "done" \
                    --arg speaker "Chris" --arg role "boss" --arg msg "$boss_line" \
                    '{ts:$ts,epoch:($ep|tonumber),type:$type,speaker:$speaker,role:$role,msg:$msg}' >> "$HISTORY_FILE"
            else
                jq -nc --arg ts "$timestamp" --arg ep "$epoch" --arg type "assign" \
                    --arg speaker "Chris" --arg role "boss" --arg msg "$boss_line" \
                    '{ts:$ts,epoch:($ep|tonumber),type:$type,speaker:$speaker,role:$role,msg:$msg}' >> "$HISTORY_FILE"
                epoch=$((epoch + 1))
                jq -nc --arg ts "$timestamp" --arg ep "$epoch" --arg type "assign" \
                    --arg speaker "$agent_name" --arg role "$agent_role" --arg msg "$agent_line" \
                    '{ts:$ts,epoch:($ep|tonumber),type:$type,speaker:$speaker,role:$role,msg:$msg}' >> "$HISTORY_FILE"
            fi
            exit 0
        fi

        echo "[$(date '+%H:%M:%S')] JSON found but no valid lines/boss/agent: $json" >> "$DEBUG_LOG"
        exit 0
    fi
fi

# ── 일반 Task 완료 시: complete 대화 요청 ────────────────────────
if [ "$tool_name" = "Task" ]; then
    agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // "unknown"')

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
            qa-tester) agent_name="Sam" ;;
            *) agent_name="Agent" ;;
        esac

        description=$(echo "$input" | jq -r '.tool_input.description // "작업"')
        # 실제 결과 요약 추출 (첫 300자)
        result_text=$(echo "$input" | jq -r '.tool_response.content[0].text // ""' | head -c 300)

        jq -n --arg agent "$agent_name" --arg atype "$agent_type" --arg task "$description" --arg result "$result_text" '{
          "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": ("🎬 COMPLETE: dialogue-generator(sonnet)로 완료 대화 생성:\ntype: complete\nagent: " + $agent + "\nagent_type: " + $atype + "\ntask: " + $task + "\nresult: " + $result + "\n\nJSON만: {\"lines\": [{\"speaker\": \"agent\", \"msg\": \"...\"}, {\"speaker\": \"boss\", \"msg\": \"...\"}]}")
          }
        }'
        exit 0
    fi
fi

# ── 일반 도구 완료 요약 (Edit/Write/Bash) ────────────────────────
case "$tool_name" in
    Edit)
        file=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
        [ -n "$file" ] && {
            ts=$(date '+%H:%M:%S'); ep=$(date '+%s')
            old_str=$(echo "$input" | jq -r '.tool_input.old_string // ""' | head -c 200)
            new_str=$(echo "$input" | jq -r '.tool_input.new_string // ""' | head -c 200)
            detail="- ${old_str}
+ ${new_str}"
            jq -nc --arg ts "$ts" --arg ep "$ep" --arg file "$file" --arg detail "$detail" \
                '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:"Chris",role:"boss",msg:("✏️ " + $file + " 수정 완료"),detail:$detail}' >> "$HISTORY_FILE"
        }
        ;;
    Write)
        file=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
        [ -n "$file" ] && {
            ts=$(date '+%H:%M:%S'); ep=$(date '+%s')
            jq -nc --arg ts "$ts" --arg ep "$ep" --arg file "$file" \
                '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:"Chris",role:"boss",msg:("📝 " + $file + " → 작성 완료")}' >> "$HISTORY_FILE"
        }
        ;;
    Bash)
        cmd=$(echo "$input" | jq -r '.tool_input.command // ""' | head -c 60)
        [ -n "$cmd" ] && {
            ts=$(date '+%H:%M:%S'); ep=$(date '+%s')
            output=$(echo "$input" | jq -r '.tool_response.content[0].text // ""' | head -c 500)
            # 요약: 마지막 의미있는 줄
            summary=$(echo "$output" | grep -v '^$' | tail -1 | head -c 80)
            [ -z "$summary" ] && summary="실행 완료"
            jq -nc --arg ts "$ts" --arg ep "$ep" --arg cmd "$cmd" --arg summary "$summary" --arg detail "$output" \
                '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:"Chris",role:"boss",msg:("💻 " + $cmd + " → " + $summary),detail:$detail}' >> "$HISTORY_FILE"
        }
        ;;
esac

exit 0
