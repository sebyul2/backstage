#!/usr/bin/env bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$HOME/.claude/plugins/backstage"

# Parse options
MODE="global"
for arg in "$@"; do
  case "$arg" in
    --global) MODE="global" ;;
    --local)  MODE="local" ;;
    --help)
      echo "Usage: ./install.sh [--global|--local]"
      echo ""
      echo "Options:"
      echo "  --global   Register hooks in ~/.claude/settings.json (default)"
      echo "  --local    Register hooks in .claude/settings.local.json (current project)"
      echo "  --help     Show this message"
      exit 0
      ;;
    *)
      echo -e "${RED}✗ Unknown option: $arg${NC}"
      echo "Run ./install.sh --help for usage."
      exit 1
      ;;
  esac
done

if [ "$MODE" = "global" ]; then
  SETTINGS_FILE="$HOME/.claude/settings.json"
else
  SETTINGS_FILE="$(pwd)/.claude/settings.local.json"
fi

echo -e "${BLUE}Claude Backstage Installer${NC}"
echo "================================"
echo ""

# 1. Check dependencies
echo "Checking dependencies..."

if ! command -v bun &>/dev/null; then
  echo -e "${RED}✗ bun is not installed.${NC}"
  echo "  Install from: https://bun.sh"
  exit 1
fi
echo -e "${GREEN}✓ bun${NC} $(bun --version)"

if ! command -v jq &>/dev/null; then
  echo -e "${RED}✗ jq is not installed.${NC}"
  echo "  Install: brew install jq  (macOS) or apt install jq (Linux)"
  exit 1
fi
echo -e "${GREEN}✓ jq${NC} $(jq --version)"

echo ""

# 2. Copy files to PLUGIN_DIR
echo "Copying plugin files to $PLUGIN_DIR ..."

mkdir -p "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR/agents"
mkdir -p "$PLUGIN_DIR/viewer"

# hooks/*.sh and hooks/characters.json
for f in "$SCRIPT_DIR/hooks/"*.sh; do
  [ -f "$f" ] || continue
  cp "$f" "$PLUGIN_DIR/"
  chmod +x "$PLUGIN_DIR/$(basename "$f")"
  echo -e "  ${GREEN}✓${NC} hooks/$(basename "$f")"
done

if [ -f "$SCRIPT_DIR/hooks/characters.json" ]; then
  cp "$SCRIPT_DIR/hooks/characters.json" "$PLUGIN_DIR/"
  echo -e "  ${GREEN}✓${NC} hooks/characters.json"
fi

# agents/dialogue-generator.md
if [ -f "$SCRIPT_DIR/agents/dialogue-generator.md" ]; then
  cp "$SCRIPT_DIR/agents/dialogue-generator.md" "$PLUGIN_DIR/agents/"
  echo -e "  ${GREEN}✓${NC} agents/dialogue-generator.md"
fi

# CLAUDE.md
if [ -f "$SCRIPT_DIR/CLAUDE.md" ]; then
  cp "$SCRIPT_DIR/CLAUDE.md" "$PLUGIN_DIR/CLAUDE.md"
  echo -e "  ${GREEN}✓${NC} CLAUDE.md"
fi

# viewer/* (recursive, skip node_modules and .omc)
if [ -d "$SCRIPT_DIR/viewer" ]; then
  rsync -a \
    --exclude='node_modules' \
    --exclude='.omc' \
    "$SCRIPT_DIR/viewer/" "$PLUGIN_DIR/viewer/"
  echo -e "  ${GREEN}✓${NC} viewer/ (recursive)"
fi

echo ""

# 3. Register hooks in settings.json
echo "Registering hooks in $SETTINGS_FILE ..."

# Check if backstage hooks are already registered
if [ -f "$SETTINGS_FILE" ] && grep -q "backstage" "$SETTINGS_FILE" 2>/dev/null; then
  echo -e "  ${YELLOW}⚠ Backstage hooks already registered in $SETTINGS_FILE — skipping.${NC}"
else
  # Ensure parent directory exists
  mkdir -p "$(dirname "$SETTINGS_FILE")"

  HOOK_PRE="bash $PLUGIN_DIR/pre-tool-hook.sh"
  HOOK_POST="bash $PLUGIN_DIR/post-tool-hook.sh"
  HOOK_PROMPT="bash $PLUGIN_DIR/user-prompt-hook.sh"
  HOOK_STOP="bash $PLUGIN_DIR/stop-hook.sh"

  if [ ! -f "$SETTINGS_FILE" ]; then
    # Create fresh settings.json with hooks
    jq -n \
      --arg pre  "$HOOK_PRE" \
      --arg post "$HOOK_POST" \
      --arg prompt "$HOOK_PROMPT" \
      --arg stop "$HOOK_STOP" \
      '{
        hooks: {
          PreToolUse:       [{ hooks: [{ type: "command", command: $pre   }] }],
          PostToolUse:      [{ hooks: [{ type: "command", command: $post  }] }],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: $prompt}] }],
          Stop:             [{ hooks: [{ type: "command", command: $stop  }] }]
        }
      }' > "$SETTINGS_FILE"
    echo -e "  ${GREEN}✓${NC} Created $SETTINGS_FILE with hooks"
  else
    # Merge with existing settings — append to each hook array
    UPDATED=$(jq \
      --arg pre  "$HOOK_PRE" \
      --arg post "$HOOK_POST" \
      --arg prompt "$HOOK_PROMPT" \
      --arg stop "$HOOK_STOP" \
      '
      .hooks.PreToolUse       = ((.hooks.PreToolUse       // []) + [{ hooks: [{ type: "command", command: $pre    }] }]) |
      .hooks.PostToolUse      = ((.hooks.PostToolUse      // []) + [{ hooks: [{ type: "command", command: $post   }] }]) |
      .hooks.UserPromptSubmit = ((.hooks.UserPromptSubmit // []) + [{ hooks: [{ type: "command", command: $prompt }] }]) |
      .hooks.Stop             = ((.hooks.Stop             // []) + [{ hooks: [{ type: "command", command: $stop   }] }])
      ' "$SETTINGS_FILE")
    echo "$UPDATED" > "$SETTINGS_FILE"
    echo -e "  ${GREEN}✓${NC} Merged hooks into $SETTINGS_FILE"
  fi
fi

echo ""

# 4. Inject backstage protocol into global CLAUDE.md
echo "Injecting backstage protocol into global CLAUDE.md ..."

GLOBAL_CLAUDE_MD="$HOME/.claude/CLAUDE.md"
PROTOCOL_FILE="$SCRIPT_DIR/CLAUDE.md"

if [ ! -f "$PROTOCOL_FILE" ]; then
  echo -e "  ${RED}✗ Protocol file not found: $PROTOCOL_FILE${NC}"
else
  # Ensure global CLAUDE.md exists
  touch "$GLOBAL_CLAUDE_MD"

  # Remove existing backstage section if present
  if grep -q "BACKSTAGE:START" "$GLOBAL_CLAUDE_MD"; then
    echo -e "  ${YELLOW}⚠ Updating existing backstage protocol${NC}"
    sed -i.bak '/<!-- BACKSTAGE:START -->/,/<!-- BACKSTAGE:END -->/d' "$GLOBAL_CLAUDE_MD"
    rm -f "$GLOBAL_CLAUDE_MD.bak"
  fi

  # Append with markers
  {
    echo ""
    echo "<!-- BACKSTAGE:START -->"
    cat "$PROTOCOL_FILE"
    echo ""
    echo "<!-- BACKSTAGE:END -->"
  } >> "$GLOBAL_CLAUDE_MD"

  echo -e "  ${GREEN}✓${NC} Backstage protocol injected into global CLAUDE.md"
fi

echo ""

# 5. Update plugin cache (for /server on)
echo "Updating plugin cache ..."

PLUGIN_VERSION=$(jq -r '.version // "0.0.0"' "$SCRIPT_DIR/.claude-plugin/plugin.json" 2>/dev/null || echo "0.0.0")
CACHE_DIR="$HOME/.claude/plugins/cache/backstage/claude-backstage/$PLUGIN_VERSION"

mkdir -p "$CACHE_DIR"

# Copy viewer to cache
if [ -d "$SCRIPT_DIR/viewer" ]; then
  mkdir -p "$CACHE_DIR/viewer"
  rsync -a \
    --exclude='node_modules' \
    --exclude='.omc' \
    "$SCRIPT_DIR/viewer/" "$CACHE_DIR/viewer/"
  echo -e "  ${GREEN}✓${NC} viewer/ → cache ($PLUGIN_VERSION)"
fi

# Copy hooks to cache
if [ -d "$SCRIPT_DIR/hooks" ]; then
  mkdir -p "$CACHE_DIR/hooks"
  rsync -a "$SCRIPT_DIR/hooks/" "$CACHE_DIR/hooks/"
  echo -e "  ${GREEN}✓${NC} hooks/ → cache ($PLUGIN_VERSION)"
fi

# Copy skills to cache
if [ -d "$SCRIPT_DIR/skills" ]; then
  mkdir -p "$CACHE_DIR/skills"
  rsync -a "$SCRIPT_DIR/skills/" "$CACHE_DIR/skills/"
  echo -e "  ${GREEN}✓${NC} skills/ → cache ($PLUGIN_VERSION)"
fi

# Copy plugin metadata
[ -d "$SCRIPT_DIR/.claude-plugin" ] && cp -r "$SCRIPT_DIR/.claude-plugin" "$CACHE_DIR/"

echo ""

# 6. Create enabled file
touch "$PLUGIN_DIR/enabled"
echo -e "${GREEN}✓${NC} Backstage enabled ($PLUGIN_DIR/enabled)"

echo ""

# 6. Success message
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✓ Claude Backstage installed!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "Next steps:"
echo "  • Restart Claude Code for hooks to take effect."
echo "  • Start the viewer:  cd $PLUGIN_DIR/viewer && bun run server.ts"
echo "  • Open in browser:   http://localhost:7777"
echo ""
echo "To uninstall:  ./uninstall.sh"
