# /server — Backstage Viewer Server Control

Start/stop the backstage pixel art office viewer server.

## Usage

```
/server           → Show current status + toggle menu
/server on        → Enable backstage + start viewer server
/server off       → Disable backstage + stop viewer server
```

## Implementation

When this skill is invoked, follow these steps:

### 1. Parse Arguments

Check if the user passed `on`, `off`, or nothing.

### 2. If no argument — show status and ask

Check current status:
```bash
PLUGIN_DIR="$HOME/.claude/plugins/backstage"
if [ -f "$PLUGIN_DIR/enabled" ]; then
  echo "Backstage is currently: ON"
else
  echo "Backstage is currently: OFF"
fi
```

Then use AskUserQuestion to ask: "Backstage를 켜시겠습니까? / 끄시겠습니까?" with options.

### 3. Turn ON

```bash
PLUGIN_DIR="$HOME/.claude/plugins/backstage"
mkdir -p "$PLUGIN_DIR"
touch "$PLUGIN_DIR/enabled"

# Start viewer server if not already running
if ! curl -s http://localhost:7777/ > /dev/null 2>&1; then
  VIEWER_DIR="${CLAUDE_PLUGIN_ROOT}/viewer"
  if [ ! -d "$VIEWER_DIR" ]; then
    VIEWER_DIR="$PLUGIN_DIR/viewer"
  fi
  cd "$VIEWER_DIR" && nohup perl -e 'use POSIX "setsid"; setsid(); exec @ARGV' bun server.ts > /tmp/backstage-viewer.log 2>&1 &
  echo $! > "$PLUGIN_DIR/viewer.pid"
fi
```

Report: "Backstage ON. Viewer: http://localhost:7777"

### 4. Turn OFF

```bash
PLUGIN_DIR="$HOME/.claude/plugins/backstage"
rm -f "$PLUGIN_DIR/enabled"

# Stop viewer server
PID=$(cat "$PLUGIN_DIR/viewer.pid" 2>/dev/null)
if [ -n "$PID" ]; then
  kill "$PID" 2>/dev/null
fi
rm -f "$PLUGIN_DIR/viewer.pid"

# Also kill by port
lsof -ti:7777 | xargs kill 2>/dev/null
```

Report: "Backstage OFF. Viewer stopped."

## Notes

- When OFF, all hooks immediately exit (no token cost)
- dialogue-generator is not called when OFF
- The enabled file at `~/.claude/plugins/backstage/enabled` controls all hook behavior
