#!/bin/bash
# PreCompact Hook - compaction 직전 transcript 의 thinking 블록을 snapshot 으로 저장.
# Claude Code 가 compaction 후 과거 assistant 메시지의 thinking 블록을 redact 하면
# backstage 뷰어의 Chris 챕터에서 thinking 이 빈 줄로 표시됨.
# PreCompact 시점에 snapshot 을 남겨두면 서버가 복원 가능.

[ ! -f "$HOME/.claude/plugins/backstage/enabled" ] && echo '{"continue":true}' && exit 0
exec 2>/dev/null

PLUGIN_DIR="$HOME/.claude/plugins/backstage"
STATE_DIR="${CLAUDE_PLUGIN_DATA:-$PLUGIN_DIR}"
SNAPSHOT_DIR="$STATE_DIR/thinking-snapshots"
DEBUG_LOG="$STATE_DIR/debug-hook.log"

mkdir -p "$SNAPSHOT_DIR"

input=$(cat)

# transcript 경로 추출 — 여러 후보 키 fallback
# (Claude Code 버전별로 네이밍이 다를 수 있음 — 최소한의 공격적 파싱)
TX_PATH=$(echo "$input" | jq -r '
  .transcript_path
  // .transcriptPath
  // .session.transcript_path
  // .session.transcriptPath
  // ""' 2>/dev/null)

# 없으면 최신 transcript 추정 (active-session-cwd 기준)
if [ -z "$TX_PATH" ] || [ ! -f "$TX_PATH" ]; then
    CWD_FILE="$STATE_DIR/active-session-cwd.txt"
    if [ -f "$CWD_FILE" ]; then
        cwd=$(cat "$CWD_FILE" 2>/dev/null)
        # cwd → slug (Claude Code 방식: / → -, $HOME 앞 제거)
        slug=$(echo "$cwd" | sed 's|/|-|g' | sed 's/^-//')
        tx_dir="$HOME/.claude/projects/-$slug"
        [ -d "$tx_dir" ] || tx_dir="$HOME/.claude/projects/$slug"
        if [ -d "$tx_dir" ]; then
            TX_PATH=$(ls -t "$tx_dir"/*.jsonl 2>/dev/null | head -1)
        fi
    fi
fi

ts=$(date '+%s')
session_id=$(basename "$TX_PATH" .jsonl 2>/dev/null)
[ -z "$session_id" ] && session_id="unknown"

echo "[$(date '+%H:%M:%S')] pre-compact session=$session_id tx=$TX_PATH" >> "$DEBUG_LOG"

# transcript 에서 thinking 블록만 추출 → snapshot
# 각 라인: {msgId, thinking} 한 줄짜리 JSON
if [ -n "$TX_PATH" ] && [ -f "$TX_PATH" ]; then
    SNAPSHOT="$SNAPSHOT_DIR/${session_id}-${ts}.jsonl"
    # message.id + thinking 블록 전체 내용 수집
    python3 - "$TX_PATH" "$SNAPSHOT" <<'PY' 2>/dev/null
import json, sys
src, dst = sys.argv[1], sys.argv[2]
count = 0
with open(src, 'r', encoding='utf-8') as f_in, open(dst, 'w', encoding='utf-8') as f_out:
    for line in f_in:
        try:
            obj = json.loads(line)
        except Exception:
            continue
        msg = obj.get('message') or {}
        msg_id = msg.get('id')
        content = msg.get('content') or []
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get('type') == 'thinking' and block.get('thinking'):
                f_out.write(json.dumps({'msgId': msg_id, 'thinking': block['thinking']}, ensure_ascii=False) + '\n')
                count += 1
                break  # 한 message 당 한 thinking 블록만 (동일 msgId)
print(f"[pre-compact] snapshot {count} thinking blocks", file=sys.stderr)
PY
    echo "[$(date '+%H:%M:%S')] snapshot saved: $SNAPSHOT" >> "$DEBUG_LOG"
fi

# 오래된 snapshot 청소 (7일 초과)
find "$SNAPSHOT_DIR" -name '*.jsonl' -mtime +7 -delete 2>/dev/null

echo '{"continue":true}'
exit 0
