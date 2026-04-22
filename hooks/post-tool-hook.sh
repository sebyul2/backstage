#!/bin/bash
# PostToolUse Hook - dialogue-generator 결과 처리 + Task 완료 대화 트리거

# Backstage 비활성 상태면 즉시 종료 (토큰 절약)
[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{}' && exit 0
# stderr 억제 (다른 세션에서 hook error 표시 방지)
exec 2>/dev/null

PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
# C7: state files in $CLAUDE_PLUGIN_DATA when provided, else fall back to PLUGIN_DIR
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$PLUGIN_DIR}"
mkdir -p "$STATE_DIR"

HISTORY_FILE="$STATE_DIR/history.jsonl"
ACTIVE_AGENT_FILE="$STATE_DIR/active-agent.json"
DEBUG_LOG="$STATE_DIR/debug-hook.log"
DIALOGUE_QUEUE_FILE="$STATE_DIR/dialogue-queue.jsonl"
C_TEAM_POOL_FILE="$STATE_DIR/c-team-pool.json"

# i18n loading (static plugin resource)
_LANG=$(cat "$PLUGIN_DIR/config.json" 2>/dev/null | jq -r '.language // "en"')
_I18N="$PLUGIN_DIR/hooks-i18n/${_LANG}.json"
[ ! -f "$_I18N" ] && _I18N="$PLUGIN_DIR/hooks-i18n/en.json"

# ── C-team 동적 풀 할당 함수 ──────────────────────────────────────
# B6: flock 으로 read→write 임계구역 보호 (멀티 세션 동시 실행 대응)
get_cteam_char() {
    local tool="$1"
    mkdir -p "$(dirname "$C_TEAM_POOL_FILE")"
    [ ! -f "$C_TEAM_POOL_FILE" ] && echo '{}' > "$C_TEAM_POOL_FILE"

    # macOS / Linux 모두 flock 사용 가능 여부 체크
    if ! command -v flock >/dev/null 2>&1; then
        # flock 없으면 race 가능성 있으나 기존 동작 유지 (개별 세션에선 실무상 문제 없음)
        _cteam_assign_inner "$tool"
        return
    fi

    local lock="${C_TEAM_POOL_FILE}.lock"
    (
        flock -x 9
        _cteam_assign_inner "$tool"
    ) 9>"$lock"
}

_cteam_assign_inner() {
    local tool="$1"
    local existing=$(jq -r --arg t "$tool" '.[$t] // ""' "$C_TEAM_POOL_FILE" 2>/dev/null)
    if [ -n "$existing" ] && [ "$existing" != "" ]; then
        echo "$existing"
        return
    fi
    local used=$(jq -r 'values[]' "$C_TEAM_POOL_FILE" 2>/dev/null)
    for char in Mia Kai Zoe Liam Aria Noah Luna Owen; do
        if ! echo "$used" | grep -qx "$char"; then
            jq --arg t "$tool" --arg c "$char" '.[$t] = $c' "$C_TEAM_POOL_FILE" > "$C_TEAM_POOL_FILE.tmp" && mv "$C_TEAM_POOL_FILE.tmp" "$C_TEAM_POOL_FILE"
            echo "$char"
            return
        fi
    done
    echo "Mia"
}

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

# ── ExitPlanMode 캡처 (Claude Code v2.1.105+ 는 파일 자동 저장 안 함) ────
# Plan Mode 종료 시 tool_input.plan 을 ${STATE_DIR}/plans/ 에 .md 로 저장.
# 서버 /plans 엔드포인트가 이 디렉터리를 1순위로 스캔.
if [ "$tool_name" = "ExitPlanMode" ]; then
    plan_content=$(echo "$input" | jq -r '.tool_input.plan // ""')
    if [ -n "$plan_content" ] && [ "$plan_content" != "null" ]; then
        plans_dir="$STATE_DIR/plans"
        mkdir -p "$plans_dir"
        # 첫 줄에서 # 여러 개 + 공백 제거 (macOS sed 호환: \+ 대신 *)
        raw_first=$(echo "$plan_content" | head -1 | sed 's/^#* *//')
        slug=$(echo "$raw_first" | tr -cd '[:alnum:][:space:]-' | head -c 40 | tr -s ' ' '-' | tr '[:upper:]' '[:lower:]' | sed 's/-*$//')
        [ -z "$slug" ] && slug="plan"
        file="$plans_dir/$(date +%Y%m%d-%H%M%S)-${slug}.md"
        # 파일 내용: plan_content 원문 그대로 저장. 메타는 HTML 주석(렌더링 안 됨)으로.
        # plan 원문에 이미 heading 이 있으면 그걸 씀. 없으면 첫 줄을 heading 으로 승격.
        has_heading=$(echo "$plan_content" | head -1 | grep -c '^#' || true)
        {
            echo "<!-- backstage: captured at $(date '+%Y-%m-%d %H:%M:%S') -->"
            if [ "$has_heading" = "0" ]; then
                echo "# ${raw_first:-Plan}"
                echo ""
                # 원문의 첫 줄은 이미 heading 으로 승격됐으니 나머지만
                echo "$plan_content" | tail -n +2
            else
                echo "$plan_content"
            fi
        } > "$file"
        # history.jsonl 에도 이벤트로 알림 (뷰어 타임라인에 반영)
        ts=$(date '+%H:%M:%S')
        epoch=$(date '+%s')
        plan_preview=$(echo "$raw_first" | head -c 120)
        jq -nc --arg ts "$ts" --arg ep "$epoch" --arg msg "$plan_preview" --arg fname "$(basename "$file")" \
            '{ts:$ts,epoch:($ep|tonumber),type:"plan-captured",speaker:"Chris",role:"boss",msg:$msg,data:{file:$fname}}' >> "$HISTORY_FILE"
    fi
fi

# ── TaskCreate 이벤트 기록 ────────────────────────────────────────
if [ "$tool_name" = "TaskCreate" ]; then
    task_subject=$(echo "$input" | jq -r '.tool_input.subject // ""')
    task_desc=$(echo "$input" | jq -r '.tool_input.description // ""')
    # TaskCreate 결과에서 ID 추출 (예: "Task #4 created successfully")
    task_id=$(echo "$input" | jq -r '.tool_response.content[0].text // ""' | grep -oE '#[0-9]+' | tr -d '#')

    if [ -n "$task_subject" ]; then
        ts=$(date '+%H:%M:%S')
        epoch=$(date '+%s')

        mkdir -p "$(dirname "$HISTORY_FILE")"
        jq -nc --arg ts "$ts" --arg ep "$epoch" --arg id "$task_id" --arg subj "$task_subject" --arg desc "$task_desc" \
            '{ts:$ts,epoch:($ep|tonumber),type:"task-create",speaker:"Board",role:"system",msg:"",data:{id:$id,status:"pending",subject:$subj,description:$desc}}' >> "$HISTORY_FILE"
    fi
fi

# ── TaskUpdate 이벤트 기록 ────────────────────────────────────────
if [ "$tool_name" = "TaskUpdate" ]; then
    task_id=$(echo "$input" | jq -r '.tool_input.taskId // ""')
    task_status=$(echo "$input" | jq -r '.tool_input.status // ""')
    task_subject=$(echo "$input" | jq -r '.tool_input.subject // ""')

    # 의미 있는 상태 변경만 기록 — id/status 둘 다 있어야 함.
    # "null" 문자열도 체크 (jq 의 empty fallback 이 "null" 문자열로 올 수 있음).
    if [ -n "$task_id" ] && [ "$task_id" != "null" ] && [ -n "$task_status" ] && [ "$task_status" != "null" ]; then
        ts=$(date '+%H:%M:%S')
        epoch=$(date '+%s')

        mkdir -p "$(dirname "$HISTORY_FILE")"
        jq -nc --arg ts "$ts" --arg ep "$epoch" --arg id "$task_id" --arg st "$task_status" --arg subj "$task_subject" \
            '{ts:$ts,epoch:($ep|tonumber),type:"task-update",speaker:"Board",role:"system",msg:"",data:{id:$id,status:$st,subject:$subj}}' >> "$HISTORY_FILE"
    fi
fi

# ── dialogue-generator Task/Agent 결과 처리 ────────────────────────────
if [ "$tool_name" = "Task" ] || [ "$tool_name" = "Agent" ]; then
    agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // .tool_input.agent // "unknown"')

    if echo "$agent_type" | grep -q "dialogue-generator"; then
        echo "[$(date '+%H:%M:%S')] DIALOGUE-GEN detected! extracting result..." >> "$DEBUG_LOG"
        tool_result=$(echo "$input" | jq -r '.tool_response.content[0].text // ""')
        echo "[$(date '+%H:%M:%S')] tool_result length=${#tool_result} first80=$(echo "$tool_result" | head -c 80)" >> "$DEBUG_LOG"
        prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""')

        timestamp=$(date '+%H:%M:%S')
        epoch=$(date '+%s')

        dialogue_type=$(echo "$prompt" | grep -o 'type: [a-z-]*' | head -1 | cut -d' ' -f2)
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

# ── 일반 Task/Agent 완료 시: done 이벤트 반드시 발행 (캐릭터 퇴근 트리거) ──
# B1a: dialogue-generator 여부와 무관하게 done 이벤트를 한 줄 기록.
#      AI 대사가 없어도 캐릭터가 WORKING → IDLE_BREAK 로 전환되도록 빈 msg 로 발행.
#      플러그인 네임스페이스(plugin:agent_type)는 stripping 후 매핑.
if [ "$tool_name" = "Task" ] || [ "$tool_name" = "Agent" ]; then
    agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // "unknown"')
    if ! echo "$agent_type" | grep -q "dialogue-generator"; then
        agent_short=$(echo "$agent_type" | sed 's/^[^:]*://')
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
            *) done_name="" ;;
        esac

        if [ -n "$done_name" ]; then
            done_ts=$(date '+%H:%M:%S')
            done_ep=$(date '+%s')
            mkdir -p "$(dirname "$HISTORY_FILE")"
            jq -nc --arg ts "$done_ts" --arg ep "$done_ep" --arg sp "$done_name" --arg role "$agent_short" \
                '{ts:$ts,epoch:($ep|tonumber),type:"done",speaker:$sp,role:$role,msg:""}' >> "$HISTORY_FILE"
        fi
        exit 0
    fi
fi

# ── Pending Steps 기록 (chris-log 실시간 갱신용) ────────────────────────────
PENDING_STEPS_FILE="$STATE_DIR/pending-steps.jsonl"
case "$tool_name" in
    Read|Edit|Grep|Glob|Write|Bash)
        _ps_detail=""
        case "$tool_name" in
            Read)   _ps_detail=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null) ;;
            Edit)   _ps_detail=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null) ;;
            Write)  _ps_detail=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null) ;;
            Grep)   _ps_detail=$(echo "$input" | jq -r '"/" + (.tool_input.pattern // "")[:50] + "/"') ;;
            Glob)   _ps_detail=$(echo "$input" | jq -r '(.tool_input.pattern // "")[:50]') ;;
            Bash)   _ps_detail=$(echo "$input" | jq -r '(.tool_input.command // "")[:80]') ;;
        esac
        jq -nc --arg type "tool" --arg name "$tool_name" --arg detail "$_ps_detail" \
            '{type:$type,name:$name,detail:$detail}' >> "$PENDING_STEPS_FILE"
        ;;
    Agent|Task)
        _ps_atype=$(echo "$input" | jq -r '.tool_input.subagent_type // ""')
        if [ -n "$_ps_atype" ] && ! echo "$_ps_atype" | grep -q "dialogue-generator"; then
            _ps_desc=$(echo "$input" | jq -r '(.tool_input.description // .tool_input.prompt // "")[:80]')
            _ps_short=$(echo "$_ps_atype" | sed 's/^[^:]*://')
            jq -nc --arg type "agent" --arg name "$_ps_short" --arg desc "$_ps_desc" \
                '{type:$type,name:$name,desc:$desc}' >> "$PENDING_STEPS_FILE"
        fi
        ;;
esac

# ── 일반 도구 완료 요약 (C-Team 동적 풀 할당 + 말풍선) ────────────────────
case "$tool_name" in
    Read|Edit|Grep|Glob|Write|Bash)
        c_char=$(get_cteam_char "$tool_name")
        c_role="c-$(echo "$tool_name" | tr 'A-Z' 'a-z')"
        ts=$(date '+%H:%M:%S'); ep=$(date '+%s')

        case "$tool_name" in
            Read)
                file=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                [ -n "$file" ] && \
                jq -nc --arg ts "$ts" --arg ep "$ep" --arg sp "$c_char" --arg role "$c_role" --arg file "$file" \
                    '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:$sp,role:$role,msg:("📖\n" + $file)}' >> "$HISTORY_FILE"
                ;;
            Edit)
                file=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                [ -n "$file" ] && {
                    old_str=$(echo "$input" | jq -r '.tool_input.old_string // ""' | head -c 200)
                    new_str=$(echo "$input" | jq -r '.tool_input.new_string // ""' | head -c 200)
                    detail="- ${old_str}
+ ${new_str}"
                    jq -nc --arg ts "$ts" --arg ep "$ep" --arg sp "$c_char" --arg role "$c_role" --arg file "$file" --arg detail "$detail" \
                        '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:$sp,role:$role,msg:("✏️\n" + $file),detail:$detail}' >> "$HISTORY_FILE"
                }
                ;;
            Grep)
                pattern=$(echo "$input" | jq -r '.tool_input.pattern // ""' | head -c 30)
                [ -n "$pattern" ] && \
                jq -nc --arg ts "$ts" --arg ep "$ep" --arg sp "$c_char" --arg role "$c_role" --arg pat "$pattern" \
                    '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:$sp,role:$role,msg:("🔎\n" + $pat)}' >> "$HISTORY_FILE"
                ;;
            Glob)
                pattern=$(echo "$input" | jq -r '.tool_input.pattern // ""' | head -c 30)
                [ -n "$pattern" ] && \
                jq -nc --arg ts "$ts" --arg ep "$ep" --arg sp "$c_char" --arg role "$c_role" --arg pat "$pattern" \
                    '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:$sp,role:$role,msg:("🔍\n" + $pat)}' >> "$HISTORY_FILE"
                ;;
            Write)
                file=$(echo "$input" | jq -r '.tool_input.file_path // ""' | xargs basename 2>/dev/null)
                [ -n "$file" ] && \
                jq -nc --arg ts "$ts" --arg ep "$ep" --arg sp "$c_char" --arg role "$c_role" --arg file "$file" \
                    '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:$sp,role:$role,msg:("📝\n" + $file)}' >> "$HISTORY_FILE"
                ;;
            Bash)
                cmd=$(echo "$input" | jq -r '.tool_input.command // ""' | head -c 60)
                [ -n "$cmd" ] && {
                    output=$(echo "$input" | jq -r '.tool_response.content[0].text // ""' | head -c 500)
                    summary=$(echo "$output" | grep -v '^$' | tail -1 | head -c 80)
                    [ -z "$summary" ] && summary=$(jq -r '.python_labels.bash_complete // "done"' "$_I18N" 2>/dev/null)
                    jq -nc --arg ts "$ts" --arg ep "$ep" --arg sp "$c_char" --arg role "$c_role" --arg cmd "$cmd" --arg summary "$summary" --arg detail "$output" \
                        '{ts:$ts,epoch:($ep|tonumber),type:"work-done",speaker:$sp,role:$role,msg:("💻\n" + $cmd),detail:$detail}' >> "$HISTORY_FILE"
                }
                ;;
        esac
        ;;
esac

# ── C-Team AI 대화 + 데이터 (최소 30초 간격, 각 도구 담당 캐릭터가 대화) ──
C_BUBBLE_LAST_FILE="$STATE_DIR/c-bubble-last-epoch.txt"
C_BUBBLE_INTERVAL=30

case "$tool_name" in
    Read|Edit|Grep|Glob|Write|Bash)
        # 시간 기반 간격: 마지막 c-bubble 이후 30초 이상이면 트리거
        now_epoch=$(date '+%s')
        last_bubble_epoch=0
        [ -f "$C_BUBBLE_LAST_FILE" ] && last_bubble_epoch=$(cat "$C_BUBBLE_LAST_FILE" 2>/dev/null)
        [ -z "$last_bubble_epoch" ] && last_bubble_epoch=0

        if [ $((now_epoch - last_bubble_epoch)) -ge $C_BUBBLE_INTERVAL ]; then
            c_name=$(get_cteam_char "$tool_name")
            c_role="c-$(echo "$tool_name" | tr 'A-Z' 'a-z')"
            # 캐릭터별 성격 (i18n에서 로드)
            c_desc=$(jq -r --arg n "$c_name" '.c_team[$n] // .c_team._default // "IT startup team member"' "$_I18N" 2>/dev/null)

            # Python으로 실제 데이터 추출 → dialogue-generator AI에 전달할 요약
            # 별도 .py 파일 사용 (bash 작은따옴표 충돌 방지)
            EXTRACT_PY="${CLAUDE_PLUGIN_ROOT:-$PLUGIN_DIR}/hooks/extract-data.py"
            [ ! -f "$EXTRACT_PY" ] && EXTRACT_PY="$PLUGIN_DIR/extract-data.py"
            data_summary=$(echo "$input" | _PY_LABELS="$(cat "$_I18N" 2>/dev/null)" python3 "$EXTRACT_PY" 2>/dev/null)

            if [ -n "$data_summary" ]; then
                # 큐에 C-team 대화 생성 요청 기록 (server.ts가 소비)
                mkdir -p "$(dirname "$DIALOGUE_QUEUE_FILE")"
                _ctpl=$(jq -r '.dialogue_prompt.c_bubble_template // "IT startup. ${speaker}(${desc}) working on: ${data}. Short chat with Chris(boss). Dev humor required, mention specific work, each speaks 1-2 times, 20-50 chars/line. JSON only: {\"lines\":[{\"speaker\":\"boss\",\"msg\":\"..\"},{\"speaker\":\"${speaker}\",\"msg\":\"..\"}]}"' "$_I18N" 2>/dev/null)
                # B3: sed injection 방지
                _cprompt=$(_TPL="$_ctpl" _SPEAKER="$c_name" _DESC="$c_desc" _DATA="$data_summary" python3 -c '
import os
tpl = os.environ.get("_TPL","")
s = os.environ.get("_SPEAKER","")
d = os.environ.get("_DESC","")
data = os.environ.get("_DATA","")
print(tpl.replace("${speaker}", s).replace("${desc}", d).replace("${data}", data))
' 2>/dev/null)
                jq -nc --arg ep "$(date +%s)" --arg speaker "$c_name" --arg role "$c_role" --arg data "$data_summary" --arg desc "$c_desc" --arg dtype "c-bubble" --arg prompt "$_cprompt" \
                    '{epoch:($ep|tonumber),speaker:$speaker,role:$role,type:$dtype,prompt:$prompt}' >> "$DIALOGUE_QUEUE_FILE"
                echo "$now_epoch" > "$C_BUBBLE_LAST_FILE"
            fi
        fi
        ;;
esac

exit 0
