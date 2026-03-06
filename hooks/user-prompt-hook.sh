#!/bin/bash
# UserPromptSubmit Hook - 사용자 메시지를 backstage history에 기록
# client(사용자)가 boss(Chris)에게 요청하는 형태로 표시

# Backstage 비활성 상태면 즉시 종료 (토큰 절약)
[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{"continue": true}' && exit 0

# dialogue-queue에서 claude --print 호출 시 재귀 방지 (환경변수 기반)
[ "$BACKSTAGE_DIALOGUE" = "1" ] && echo '{"continue": true}' && exit 0

PLUGIN_DIR="${BACKSTAGE_DIR:-$HOME/.claude/plugins/backstage}"
CHARACTERS_FILE="$PLUGIN_DIR/characters.json"
HISTORY_FILE="$PLUGIN_DIR/history.jsonl"

# stdin에서 JSON 입력 읽기
input=$(cat)

# 프롬프트 추출
prompt=""
if command -v jq &> /dev/null; then
  # Try multiple extraction paths (Claude Code format 포함)
  prompt=$(echo "$input" | jq -r '
    if (.prompt | type) == "string" and (.prompt | length) > 0 then .prompt
    elif (.prompt.message.content | type) == "string" then .prompt.message.content
    elif (.prompt.message.content | type) == "array" then ([.prompt.message.content[] | select(.type == "text") | .text] | join(" "))
    elif (.message.content | type) == "string" and (.message.content | length) > 0 then .message.content
    elif (.message.content | type) == "array" then ([.message.content[] | select(.type == "text") | .text] | join(" "))
    elif (.content | type) == "array" then ([.content[] | select(.type == "text") | .text] | join(" "))
    elif (.content | type) == "string" then .content
    else ""
    end
  ' 2>/dev/null)

  # Fallback: if jq returned empty, try simple field extraction
  if [ -z "$prompt" ] || [ "$prompt" = "null" ]; then
    prompt=$(echo "$input" | jq -r 'to_entries | map(select(.value | type == "string" and length > 2 and length < 500)) | sort_by(.value | length) | reverse | .[0].value // ""' 2>/dev/null)
  fi
fi

# 프롬프트가 없으면 종료
if [ -z "$prompt" ] || [ "$prompt" = "null" ]; then
  echo '{"continue": true}'
  exit 0
fi

# 프롬프트가 너무 짧으면 스킵 (의미없는 입력)
if [ ${#prompt} -lt 3 ]; then
  echo '{"continue": true}'
  exit 0
fi

# AI 대화 생성 프롬프트 패턴 필터링 (hook 내부 claude 호출의 재귀 방지)
# claude --print으로 dialogue-queue 처리 시 UserPromptSubmit이 트리거되어 프롬프트가 history에 누출됨
if echo "$prompt" | grep -qE "^당신은 판교 IT 스타트업 대화 생성기입니다|^IT 스타트업.*슬랙 대화|IT스타트업 .+가 이 상황을 보고 한마디|IT startup .+ (completed|reacts)|JSON만.*lines.*speaker.*msg|JSON only.*lines.*speaker.*msg|작업 완료.*한마디|완료 보고 한마디|completion report|One-liner"; then
  echo '{"continue": true}'
  exit 0
fi

timestamp=$(date '+%H:%M:%S')
epoch=$(date '+%s')

# 캐릭터 정보
client_name=$(jq -r '.client.name // "You"' "$CHARACTERS_FILE" 2>/dev/null)
[ -z "$client_name" ] || [ "$client_name" = "null" ] && client_name="You"
boss_name=$(jq -r '.boss.name // "Chris"' "$CHARACTERS_FILE" 2>/dev/null)
[ -z "$boss_name" ] || [ "$boss_name" = "null" ] && boss_name="Chris"

# 전체 프롬프트 (HTML 뷰어에서 펼치기로 표시, 최대 2000자)
prompt_preview=$(echo "$prompt" | sed 's/[[:space:]]*$//')
if [ ${#prompt_preview} -gt 2000 ]; then
  prompt_preview="${prompt_preview:0:2000}..."
fi

# 히스토리 디렉토리 확보 (트렁케이션은 뷰어에서 처리)
mkdir -p "$(dirname "$HISTORY_FILE")"

# 사용자 메시지를 history에 기록 (client 역할)
jq -nc --arg ts "$timestamp" --arg ep "$epoch" --arg type "request" \
    --arg speaker "$client_name" --arg role "client" --arg msg "$prompt_preview" \
    '{ts:$ts,epoch:($ep|tonumber),type:$type,speaker:$speaker,role:$role,msg:$msg}' >> "$HISTORY_FILE"

# continue만 반환 (화면 출력 없음 - statusline에서 표시)
echo '{"continue": true}'
exit 0
