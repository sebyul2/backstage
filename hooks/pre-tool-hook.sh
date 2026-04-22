#!/bin/bash
# PreToolUse Hook - 도구 사용 기록 + Task 에이전트 정보 저장

# Backstage 비활성 상태면 즉시 종료 (토큰 절약)
[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{}' && exit 0
# stderr 억제 (다른 세션에서 hook error 표시 방지)
exec 2>/dev/null

PLUGIN_DIR="$HOME/.claude/plugins/backstage"
# C7: state files in $CLAUDE_PLUGIN_DATA when provided, else fall back to PLUGIN_DIR
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$PLUGIN_DIR}"
mkdir -p "$STATE_DIR"

ACTIVE_AGENT_FILE="$STATE_DIR/active-agent.json"
HISTORY_FILE="$STATE_DIR/history.jsonl"
LAST_TOOL_FILE="$STATE_DIR/last-chris-tool.txt"
DIALOGUE_QUEUE_FILE="$STATE_DIR/dialogue-queue.jsonl"

# i18n loading (static plugin resource)
_LANG=$(cat "$PLUGIN_DIR/config.json" 2>/dev/null | jq -r '.language // "en"')
_I18N="$PLUGIN_DIR/hooks-i18n/${_LANG}.json"
[ ! -f "$_I18N" ] && _I18N="$PLUGIN_DIR/hooks-i18n/en.json"
_tv() { jq -r ".tool_verbs.${1}.verb // \"working\"" "$_I18N" 2>/dev/null; }
_te() { jq -r ".tool_verbs.${1}.emoji // \"🔧\"" "$_I18N" 2>/dev/null; }

# 활성 세션의 cwd 기록 (서버가 올바른 transcript를 선택하도록)
echo "$(pwd)" > "$STATE_DIR/active-session-cwd.txt" 2>/dev/null

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# Chris(메인 Claude)가 직접 도구 사용 시 기록
# 읽기(Read/Glob/Grep)는 노이즈가 많으므로 10초 간격 제한
# 쓰기(Edit/Write/Bash)는 중요하므로 항상 기록
LAST_CHRIS_EPOCH_FILE="$STATE_DIR/last-chris-epoch.txt"

case "$tool_name" in
    Edit|Write|Bash)
        # 쓰기 도구: 항상 기록 (중요한 작업)
        case "$tool_name" in
            Edit)
                target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                emoji=$(_te Edit); verb=$(_tv Edit) ;;
            Write)
                target=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                emoji=$(_te Write); verb=$(_tv Write) ;;
            Bash)
                target=$(echo "$input" | jq -r '.tool_input.command // ""' | head -c 30)
                emoji=$(_te Bash); verb=$(_tv Bash) ;;
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
                    emoji=$(_te Read); verb=$(_tv Read) ;;
                Glob)
                    target=$(echo "$input" | jq -r '.tool_input.pattern // ""')
                    emoji=$(_te Glob); verb=$(_tv Glob) ;;
                Grep)
                    target=$(echo "$input" | jq -r '.tool_input.pattern // ""' | head -c 20)
                    emoji=$(_te Grep); verb=$(_tv Grep) ;;
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

# TaskCreate 기록은 post-tool-hook.sh 에서 수행 (tool_response 로 실제 task id 추출 가능).
# 여기서 중복 기록하면 id 없는 레코드가 같은 epoch 에 또 들어가 뷰어 칸반에 유령 카드 생성.

# 서버에 즉시 transcript 스캔 트리거 (thinking 실시간 반영)
# I1a: --max-time/connect-timeout 으로 서버 down 시 훅 stuck 방지
curl -s --max-time 0.2 --connect-timeout 0.2 http://localhost:7777/trigger-scan >/dev/null 2>&1 &

# PreToolUse는 반드시 decision JSON을 stdout으로 반환해야 함
# 빈 stdout이면 Claude Code가 "hook error"로 표시함
RESPONSE='{"decision":"allow"}'

if [ "$tool_name" = "Task" ] || [ "$tool_name" = "Agent" ]; then
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

        # 에이전트 시작 시 AI 대화 생성 요청 (사무실 분위기 대화)
        # 캐릭터별 성격 (i18n에서 로드)
        c_desc=$(jq -r --arg n "$agent_name" '.c_team[$n] // .characters[$n] // "IT team member"' "$_I18N" 2>/dev/null)
        _atpl=$(jq -r '.dialogue_prompt.assign_template // "IT startup office. Chris(boss,witty+blunt) assigns to ${speaker}(${desc}): \"${task}\". Rules: mention specific task content, dev humor required, no generic phrases, each speaks 2-3 times, 30-50 chars/line. JSON only: {\"lines\":[{\"speaker\":\"boss\",\"msg\":\"..\"},{\"speaker\":\"agent\",\"msg\":\"..\"}]}"' "$_I18N" 2>/dev/null)
        # B3: sed injection 방지 — 환경변수로 전달 후 python에서 리터럴 치환
        _aprompt=$(_TPL="$_atpl" _SPEAKER="$agent_name" _DESC="$c_desc" _TASK="$description" python3 -c '
import os
tpl = os.environ.get("_TPL","")
s = os.environ.get("_SPEAKER","")
d = os.environ.get("_DESC","")
t = os.environ.get("_TASK","")
print(tpl.replace("${speaker}", s).replace("${desc}", d).replace("${task}", t))
' 2>/dev/null)
        mkdir -p "$(dirname "$DIALOGUE_QUEUE_FILE")"
        jq -nc --arg ep "$(date +%s)" --arg speaker "$agent_name" --arg role "$agent_type" --arg dtype "assign" --arg prompt "$_aprompt" \
            '{epoch:($ep|tonumber),speaker:$speaker,role:$role,type:$dtype,prompt:$prompt}' >> "$DIALOGUE_QUEUE_FILE"
    fi
fi

exit 0
