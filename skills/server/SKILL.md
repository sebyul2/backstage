# /server — Backstage Viewer Server Control

Start/stop the backstage pixel art office viewer server.

## Usage

```
/server           → Show current status + toggle menu
/server on        → Enable backstage + start viewer server
/server off       → Disable backstage + stop viewer server
```

## Implementation

When this skill is invoked, execute the **single Bash command** below. Do NOT run multiple commands or add extra checks.

### 1. Parse Arguments

Check if the user passed `on`, `off`, or nothing.

### 2. If no argument — show status and ask

Run this single command:
```bash
[ -f ~/.claude/plugins/backstage/enabled ] && echo "Backstage: ON" || echo "Backstage: OFF"
```

Then use AskUserQuestion to ask: "Backstage를 켜시겠습니까? / 끄시겠습니까?" with options.

### 3. Turn ON

Run this **single Bash command** (copy exactly, do not modify):
```bash
mkdir -p ~/.claude/plugins/backstage && touch ~/.claude/plugins/backstage/enabled && lsof -ti:7777 | xargs kill 2>/dev/null; sleep 0.3; VIEWER_DIR="$(ls -d ~/.claude/plugins/cache/backstage/backstage/*/viewer 2>/dev/null | sort -V | tail -1)"; [ -z "$VIEWER_DIR" ] && VIEWER_DIR=~/.claude/plugins/backstage/viewer; cd "$VIEWER_DIR" && nohup perl -e 'use POSIX "setsid"; setsid(); exec @ARGV' bun server.ts > /tmp/backstage-viewer.log 2>&1 & echo $! > ~/.claude/plugins/backstage/viewer.pid; sleep 1; lsof -ti:7777 > /dev/null 2>&1 && echo "OK: http://localhost:7777" || echo "FAIL: check /tmp/backstage-viewer.log"
```

Report the output. Do not add extra commands.

### 4. Turn OFF

Run this **single Bash command** (copy exactly, do not modify):
```bash
rm -f ~/.claude/plugins/backstage/enabled; lsof -ti:7777 | xargs kill 2>/dev/null; rm -f ~/.claude/plugins/backstage/viewer.pid; echo "Backstage OFF"
```

Report the output. Do not add extra commands.

## Notes

- When OFF, all hooks immediately exit (no token cost)
- dialogue-generator is not called when OFF
- The enabled file at `~/.claude/plugins/backstage/enabled` controls all hook behavior
- ON always kills existing server first, then starts fresh (no stale process issues)
- Uses `nohup` + `perl POSIX::setsid()` + `&` for triple process isolation:
  - `nohup`: ignores SIGHUP (terminal close)
  - `perl setsid()`: creates new session (immune to process group SIGTERM)
  - `&`: backgrounds from shell
- Viewer directory auto-detected: finds latest version in plugin cache via `sort -V`
- Liveness check uses `lsof -ti:7777` (port check), not `curl` (avoids false positives)
