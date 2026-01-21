#!/bin/bash
# Claude Backstage Installer
# IT 스타트업 오피스 분위기를 Claude Code에 추가

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$HOME/.claude/plugins/backstage"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "Installing Claude Backstage..."
echo ""

# 플러그인 디렉토리 생성 및 복사
mkdir -p "$PLUGIN_DIR"
cp "$SCRIPT_DIR/src/"* "$PLUGIN_DIR/"
chmod +x "$PLUGIN_DIR"/*.sh

echo "Files installed to: $PLUGIN_DIR"

# jq 체크
if ! command -v jq &> /dev/null; then
    echo ""
    echo "Warning: jq is required but not installed."
    echo "  brew install jq  # macOS"
    echo "  apt install jq   # Ubuntu/Debian"
    echo ""
fi

# settings.json 설정 안내
echo ""
echo "Add to your ~/.claude/settings.json:"
echo ""
cat << 'EOF'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "bash $HOME/.claude/plugins/backstage/pre-tool-hook.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "bash $HOME/.claude/plugins/backstage/post-tool-hook.sh"
          }
        ]
      }
    ]
  }
}
EOF

echo ""
echo "Optional: Add statusline (requires claude-hud)"
echo ""
cat << 'EOF'
{
  "statusLine": {
    "type": "command",
    "command": "bun $HOME/.claude/plugins/backstage/statusline.ts"
  }
}
EOF

echo ""
echo "Installation complete!"
echo "Restart Claude Code to activate."
