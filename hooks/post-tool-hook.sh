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

# ── C-Team AI 대화 + 데이터 (매 3번째 도구, dialogue-generator로 유머 전달) ──
PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
C_COUNTER_FILE="$PLUGIN_DIR/c-bubble-counter.txt"

case "$tool_name" in
    Read|Edit|Grep|Glob|Write|Bash)
        counter=0
        [ -f "$C_COUNTER_FILE" ] && counter=$(cat "$C_COUNTER_FILE" 2>/dev/null)
        counter=$((counter + 1))
        echo "$counter" > "$C_COUNTER_FILE"

        if [ $((counter % 3)) -eq 0 ]; then
            case "$tool_name" in
                Read) c_name="Mia"; c_role="c-read"; c_desc="밝고 호기심 많음. 데이터 보면 흥분. ㅋㅋ 잘 씀" ;;
                Edit) c_name="Kai"; c_role="c-edit"; c_desc="코드 장인. 깔끔함 집착. 변경에 예민" ;;
                Grep) c_name="Zoe"; c_role="c-grep"; c_desc="검색 달인. 패턴 발견하면 흥분. 분석적" ;;
                Glob) c_name="Liam"; c_role="c-glob"; c_desc="파일 정리광. 구조 파악 전문. 체계적" ;;
                Write) c_name="Aria"; c_role="c-write"; c_desc="창작 좋아함. 새 파일에 설렘. 덮어쓰기엔 긴장" ;;
                Bash) c_name="Noah"; c_role="c-bash"; c_desc="실행 담당. 빌드/테스트에 진심. 결과에 일희일비" ;;
            esac

            # Python으로 실제 데이터 추출 → dialogue-generator AI에 전달할 요약
            data_summary=$(echo "$input" | python3 -c '
import json, sys, os, re

try:
    data = json.load(sys.stdin)
except:
    sys.exit(1)

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
    info.append(f"파일: {fn}")
    info.append(f"{lc}줄")
    if imports: info.append(f"import {imports}개")
    if funcs: info.append(f"함수/클래스 {funcs}개")
    if comments == 0 and lc > 50: info.append("주석 없음")
    if ext: info.append(f"타입: {ext}")

elif tool == "Edit":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    old = ti.get("old_string", "")
    new = ti.get("new_string", "")
    ol = old.count("\n") + (1 if old.strip() else 0)
    nl = new.count("\n") + (1 if new.strip() else 0)
    info.append(f"파일: {fn}")
    info.append(f"-{ol}줄 +{nl}줄")
    d = abs(len(new) - len(old))
    if d < 5: info.append("미세 조정")
    elif d > 500: info.append("대규모 수정")
    for l in new.split("\n"):
        m = re.match(r"\s*(?:function |export (?:function|const|class) |def )(\w+)", l)
        if m:
            info.append(f"함수: {m.group(1)}")
            break

elif tool == "Grep":
    pat = ti.get("pattern", "")[:30]
    lines = [l for l in resp.split("\n") if l.strip()] if resp else []
    mc = len(lines)
    files = set()
    for l in lines:
        if ":" in l: files.add(l.split(":")[0])
    info.append(f"패턴: {pat}")
    info.append(f"{mc}곳 매칭")
    if files: info.append(f"{len(files)}개 파일")

elif tool == "Glob":
    pat = ti.get("pattern", "")[:30]
    lines = [l for l in resp.split("\n") if l.strip()] if resp else []
    fc = len(lines)
    info.append(f"패턴: {pat}")
    info.append(f"{fc}개 파일")

elif tool == "Write":
    fp = ti.get("file_path", "")
    fn = os.path.basename(fp)
    content = ti.get("content", "")
    lc = content.count("\n") + (1 if content.strip() else 0)
    ext = os.path.splitext(fn)[1]
    info.append(f"파일: {fn}")
    info.append(f"{lc}줄")
    if ext: info.append(f"타입: {ext}")

elif tool == "Bash":
    cmd = ti.get("command", "")[:60]
    last_lines = resp.split("\n")[-5:] if resp else []
    info.append(f"명령: {cmd}")
    if "error" in resp[:500].lower(): info.append("에러 발생")
    elif "success" in resp[:500].lower(): info.append("성공")
    elif any("pass" in l.lower() for l in last_lines): info.append("테스트 통과")
    elif any("fail" in l.lower() for l in last_lines): info.append("실패")

print(", ".join(info) if info else "")
' 2>/dev/null)

            if [ -n "$data_summary" ]; then
                # additionalContext로 dialogue-generator AI 호출 요청 (데이터 + 유머)
                jq -nc --arg name "$c_name" --arg role "$c_role" --arg desc "$c_desc" --arg data "$data_summary" '{
                    hookSpecificOutput: {
                        hookEventName: "PostToolUse",
                        additionalContext: ("[C-TEAM] dialogue-generator(sonnet)로 C-team 대사 생성해주세요:\ntype: c-bubble\nagent: " + $name + "\nagent_type: " + $role + "\n[상황] " + $name + "이(가) 도구 결과 데이터를 보고 IT 스타트업 동료답게 한마디.\n[데이터] " + $data + "\n[성격] " + $desc + "\n[필수] 실제 데이터를 자연스럽고 유머러스하게 전달. 15-30자. ㅋㅋ/ㅎㅎ OK.\n[금지] 보고서 말투, 30자 초과, 기술 용어 나열\nJSON만: {\"lines\": [{\"speaker\": \"" + $name + "\", \"msg\": \"...\"}]}")
                    }
                }'
            fi
        fi
        ;;
esac

exit 0
