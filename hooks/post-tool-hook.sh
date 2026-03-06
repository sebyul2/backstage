#!/bin/bash
# PostToolUse Hook - dialogue-generator 결과 처리 + Task 완료 대화 트리거

# Backstage 비활성 상태면 즉시 종료 (토큰 절약)
[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && exit 0

PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
HISTORY_FILE="$PLUGIN_DIR/history.jsonl"
ACTIVE_AGENT_FILE="$PLUGIN_DIR/active-agent.json"
DEBUG_LOG="$PLUGIN_DIR/debug-hook.log"
DIALOGUE_QUEUE_FILE="$PLUGIN_DIR/dialogue-queue.jsonl"
C_TEAM_POOL_FILE="$PLUGIN_DIR/c-team-pool.json"

# i18n loading
_LANG=$(cat "$PLUGIN_DIR/config.json" 2>/dev/null | jq -r '.language // "en"')
_I18N="$PLUGIN_DIR/hooks-i18n/${_LANG}.json"
[ ! -f "$_I18N" ] && _I18N="$PLUGIN_DIR/hooks-i18n/en.json"

# ── C-team 동적 풀 할당 함수 ──────────────────────────────────────
get_cteam_char() {
    local tool="$1"
    [ ! -f "$C_TEAM_POOL_FILE" ] && echo '{}' > "$C_TEAM_POOL_FILE"
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

    # status가 있을 때만 기록 (의미 있는 상태 변경)
    if [ -n "$task_status" ]; then
        ts=$(date '+%H:%M:%S')
        epoch=$(date '+%s')

        mkdir -p "$(dirname "$HISTORY_FILE")"
        jq -nc --arg ts "$ts" --arg ep "$epoch" --arg id "$task_id" --arg st "$task_status" --arg subj "$task_subject" \
            '{ts:$ts,epoch:($ep|tonumber),type:"task-update",speaker:"Board",role:"system",msg:"",data:{id:$id,status:$st,subject:$subj}}' >> "$HISTORY_FILE"
    fi
fi

# ── dialogue-generator Task 결과 처리 ────────────────────────────
if [ "$tool_name" = "Task" ]; then
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

# ── 일반 Task 완료 시: complete 대화 요청 ────────────────────────
if [ "$tool_name" = "Task" ]; then
    agent_type=$(echo "$input" | jq -r '.tool_input.subagent_type // "unknown"')

    if ! echo "$agent_type" | grep -q "dialogue-generator"; then
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

        _task_default=$(jq -r '.task_labels.task_default // "task"' "$_I18N" 2>/dev/null)
        description=$(echo "$input" | jq -r ".tool_input.description // \"$_task_default\"")
        # 실제 결과 요약 추출 (첫 300자)
        result_text=$(echo "$input" | jq -r '.tool_response.content[0].text // ""' | head -c 300)

        # 큐에 대화 생성 요청 기록 (server.ts가 소비)
        mkdir -p "$(dirname "$DIALOGUE_QUEUE_FILE")"
        _tpl=$(jq -r '.dialogue_prompt.complete_template // "IT startup ${speaker}(${role}) completed: ${task}. One-liner. 15-25 chars. JSON only: {\"lines\":[{\"speaker\":\"${speaker}\",\"msg\":\"line\"}]}"' "$_I18N" 2>/dev/null)
        _prompt=$(echo "$_tpl" | sed "s/\${speaker}/$agent_name/g; s/\${role}/$agent_type/g; s/\${task}/$description/g")
        jq -nc --arg ep "$(date +%s)" --arg speaker "$agent_name" --arg role "$agent_type" --arg task "$description" --arg dtype "complete" --arg prompt "$_prompt" \
            '{epoch:($ep|tonumber),speaker:$speaker,role:$role,type:$dtype,prompt:$prompt}' >> "$DIALOGUE_QUEUE_FILE"
        exit 0
    fi
fi

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

# ── C-Team AI 대화 + 데이터 (도구별 3번째마다, 각 도구 담당 캐릭터가 대화) ──
C_COUNTER_DIR="$PLUGIN_DIR/c-counters"
mkdir -p "$C_COUNTER_DIR"

case "$tool_name" in
    Read|Edit|Grep|Glob|Write|Bash)
        # 도구별 개별 카운터 (Read 3번째→Liam, Bash 3번째→Zoe 등 분산)
        C_COUNTER_FILE="$C_COUNTER_DIR/$tool_name.txt"
        counter=0
        [ -f "$C_COUNTER_FILE" ] && counter=$(cat "$C_COUNTER_FILE" 2>/dev/null)
        counter=$((counter + 1))
        echo "$counter" > "$C_COUNTER_FILE"

        if [ $((counter % 3)) -eq 0 ]; then
            c_name=$(get_cteam_char "$tool_name")
            c_role="c-$(echo "$tool_name" | tr 'A-Z' 'a-z')"
            # 캐릭터별 성격 (i18n에서 로드)
            c_desc=$(jq -r --arg n "$c_name" '.c_team[$n] // .c_team._default // "IT startup team member"' "$_I18N" 2>/dev/null)

            # Python으로 실제 데이터 추출 → dialogue-generator AI에 전달할 요약
            # Load python labels from i18n
            data_summary=$(echo "$input" | _PY_LABELS="$(cat "$_I18N" 2>/dev/null)" python3 -c '
import json, sys, os, re

try:
    data = json.load(sys.stdin)
except:
    sys.exit(1)

# Load i18n labels
i18n_raw = os.environ.get("_PY_LABELS", "{}")
try:
    i18n = json.loads(i18n_raw).get("python_labels", {})
except:
    i18n = {}

L = lambda k, d="": i18n.get(k, d)

tool = data.get("tool_name", "")
ti = data.get("tool_input", {})
tr = data.get("tool_response", {})

def get_text(r):
    if isinstance(r, str): return r
    if isinstance(r, dict):
        c = r.get("content", [])
        if isinstance(c, list) and len(c) > 0:
            if isinstance(c[0], dict): return c[0].get("text", "")
            return str(c[0])
        if isinstance(c, str): return c
    return ""

resp = get_text(tr)
info = []

if tool == "Read":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    ext = os.path.splitext(fn)[1]
    lines = resp.split("\n") if resp else []
    lc = len(lines)
    imports = sum(1 for l in lines if "import " in l[:40] or "require(" in l)
    funcs = sum(1 for l in lines if re.match(r".*\b(function |class |def |export (function|class|const) )", l))
    comments = sum(1 for l in lines if l.strip().startswith(("//", "#", "/*", "*")))
    info.append(f"{L('file','File')}: {fn}")
    info.append(f"{lc}{L('lines','lines')}")
    if imports: info.append(f"{L('imports','imports')} {imports}{L('imports_suffix','')}")
    if funcs: info.append(f"{L('funcs','funcs/classes')} {funcs}{L('funcs_suffix','')}")
    if comments == 0 and lc > 50: info.append(L("no_comments","no comments"))
    if ext: info.append(f"{L('type','type')}: {ext}")

elif tool == "Edit":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    old = ti.get("old_string", "")
    new = ti.get("new_string", "")
    ol = old.count("\n") + (1 if old.strip() else 0)
    nl = new.count("\n") + (1 if new.strip() else 0)
    info.append(f"{L('file','File')}: {fn}")
    info.append(f"-{ol}{L('minus_lines','lines')} +{nl}{L('plus_lines','lines')}")
    d = abs(len(new) - len(old))
    if d < 5: info.append(L("fine_tuning","fine tuning"))
    elif d > 500: info.append(L("large_edit","large edit"))
    for l in new.split("\n"):
        m = re.match(r"\s*(?:function |export (?:function|const|class) |def )(\w+)", l)
        if m:
            info.append(f"{L('function','func')}: {m.group(1)}")
            break

elif tool == "Grep":
    pat = ti.get("pattern", "")[:30]
    lines = [l for l in resp.split("\n") if l.strip()] if resp else []
    mc = len(lines)
    files = set()
    for l in lines:
        if ":" in l: files.add(l.split(":")[0])
    info.append(f"{L('pattern','pattern')}: {pat}")
    info.append(f"{mc}{L('matches','matches')}")
    if files: info.append(f"{len(files)}{L('files_suffix','files')}")

elif tool == "Glob":
    pat = ti.get("pattern", "")[:30]
    lines = [l for l in resp.split("\n") if l.strip()] if resp else []
    fc = len(lines)
    info.append(f"{L('pattern','pattern')}: {pat}")
    info.append(f"{fc}{L('files_suffix','files')}")

elif tool == "Write":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    content = ti.get("content", "")
    lc = content.count("\n") + (1 if content.strip() else 0)
    ext = os.path.splitext(fn)[1]
    info.append(f"{L('file','File')}: {fn}")
    info.append(f"{lc}{L('lines','lines')}")
    if ext: info.append(f"{L('type','type')}: {ext}")

elif tool == "Bash":
    cmd = ti.get("command", "")[:60]
    last_lines = resp.split("\n")[-5:] if resp else []
    info.append(f"{L('command','cmd')}: {cmd}")
    if "error" in resp[:500].lower(): info.append(L("error_occurred","error occurred"))
    elif "success" in resp[:500].lower(): info.append(L("success","success"))
    elif any("pass" in l.lower() for l in last_lines): info.append(L("test_passed","tests passed"))
    elif any("fail" in l.lower() for l in last_lines): info.append(L("failed","failed"))

print(", ".join(info) if info else "")
' 2>/dev/null)

            if [ -n "$data_summary" ]; then
                # 큐에 C-team 대화 생성 요청 기록 (server.ts가 소비)
                mkdir -p "$(dirname "$DIALOGUE_QUEUE_FILE")"
                _ctpl=$(jq -r '.dialogue_prompt.c_bubble_template // "IT startup ${speaker}(${desc}) reacts: ${data}. 15-30 chars. JSON only: {\"lines\":[{\"speaker\":\"${speaker}\",\"msg\":\"line\"}]}"' "$_I18N" 2>/dev/null)
                _cprompt=$(echo "$_ctpl" | sed "s/\${speaker}/$c_name/g; s/\${desc}/$c_desc/g; s|\${data}|$data_summary|g")
                jq -nc --arg ep "$(date +%s)" --arg speaker "$c_name" --arg role "$c_role" --arg data "$data_summary" --arg desc "$c_desc" --arg dtype "c-bubble" --arg prompt "$_cprompt" \
                    '{epoch:($ep|tonumber),speaker:$speaker,role:$role,type:$dtype,prompt:$prompt}' >> "$DIALOGUE_QUEUE_FILE"
            fi
        fi
        ;;
esac

exit 0
