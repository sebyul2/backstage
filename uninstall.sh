#!/bin/bash
# Claude Backstage Uninstaller
# 플러그인 완전 제거

set -e

PLUGIN_DIR="$HOME/.claude/plugins/backstage"
GLOBAL_CLAUDE_MD="$HOME/.claude/CLAUDE.md"

echo "=== Claude Backstage Uninstaller ==="

# 1. Viewer 서버 종료
PID_FILE="$PLUGIN_DIR/viewer.pid"
if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        echo "Stopping viewer server (PID: $pid)"
        kill "$pid" 2>/dev/null
    fi
    rm -f "$PID_FILE"
fi

# 2. 플러그인 디렉토리 삭제
if [ -d "$PLUGIN_DIR" ]; then
    echo "Removing plugin directory: $PLUGIN_DIR"
    rm -rf "$PLUGIN_DIR"
else
    echo "Plugin directory not found (already removed?)"
fi

# 2. 글로벌 CLAUDE.md에서 backstage 섹션 제거
if [ -f "$GLOBAL_CLAUDE_MD" ]; then
    if grep -q "BACKSTAGE:START" "$GLOBAL_CLAUDE_MD"; then
        echo "Removing backstage section from global CLAUDE.md"
        sed -i.bak '/<!-- BACKSTAGE:START -->/,/<!-- BACKSTAGE:END -->/d' "$GLOBAL_CLAUDE_MD"
        rm -f "$GLOBAL_CLAUDE_MD.bak"
        echo "Removed backstage section"
    else
        echo "No backstage section found in global CLAUDE.md"
    fi
fi

# 3. settings.json에서 backstage 관련 hooks 자동 제거
for SETTINGS in "$HOME/.claude/settings.json" ".claude/settings.local.json"; do
  if [ -f "$SETTINGS" ] && grep -q "backstage" "$SETTINGS"; then
    echo "Removing backstage hooks from $SETTINGS"
    jq '
      if .hooks then
        .hooks |= with_entries(
          .value |= map(select(
            (.hooks // []) | all(.command | tostring | contains("backstage") | not)
          ))
        )
      else . end
    ' "$SETTINGS" > "${SETTINGS}.tmp" && mv "${SETTINGS}.tmp" "$SETTINGS"
    echo "Done"
  fi
done

echo ""
echo "=== Uninstall Complete ==="
