#!/bin/bash
# CwdChanged Hook - Claude Code v2.1.83+ 가 cwd 전환 시 발행.
# 정확한 프로젝트 전환 시그널을 받아 state 에 기록하고,
# 기존 ps+lsof 기반 추정 로직의 지연/부정확성을 보완.

[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{"continue":true}' && exit 0
exec 2>/dev/null

PLUGIN_DIR="$HOME/.claude/plugins/backstage"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$PLUGIN_DIR}"
mkdir -p "$STATE_DIR"
SWITCHES_FILE="$STATE_DIR/project-switches.jsonl"
CWD_FILE="$STATE_DIR/active-session-cwd.txt"
DEBUG_LOG="$STATE_DIR/debug-hook.log"

input=$(cat)
new_cwd=$(echo "$input" | jq -r '.cwd // .new_cwd // .cwdChanged.new // ""' 2>/dev/null)
old_cwd=$(echo "$input" | jq -r '.old_cwd // .previous_cwd // .cwdChanged.old // ""' 2>/dev/null)

# 입력이 비어있으면 현재 pwd 로 fallback
[ -z "$new_cwd" ] && new_cwd=$(pwd)

ts=$(date '+%s')
mkdir -p "$(dirname "$SWITCHES_FILE")"

# 활성 cwd 파일 갱신 (서버 transcript 선택에 반영됨)
echo "$new_cwd" > "$CWD_FILE"

# 전환 이벤트 기록 (뷰어에서 타임라인으로 쓰거나 뱃지 표시에 참고 가능)
jq -nc --arg ts "$ts" --arg old "$old_cwd" --arg new "$new_cwd" \
    '{epoch:($ts|tonumber),old:$old,new:$new}' >> "$SWITCHES_FILE"

echo "[$(date '+%H:%M:%S')] cwd-changed: $old_cwd -> $new_cwd" >> "$DEBUG_LOG"

echo '{"continue":true}'
exit 0
