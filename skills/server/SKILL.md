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
mkdir -p ~/.claude/plugins/backstage && touch ~/.claude/plugins/backstage/enabled && lsof -ti:7777 | xargs kill 2>/dev/null; sleep 0.3; VIEWER_DIR="$(ls -d ~/.claude/plugins/cache/backstage/claude-backstage/*/viewer 2>/dev/null | sort -V | tail -1)"; [ -z "$VIEWER_DIR" ] && VIEWER_DIR=~/.claude/plugins/backstage/viewer; cd "$VIEWER_DIR" && nohup perl -e 'use POSIX "setsid"; setsid(); exec @ARGV' bun server.ts > /tmp/backstage-viewer.log 2>&1 & echo $! > ~/.claude/plugins/backstage/viewer.pid; sleep 1; lsof -ti:7777 > /dev/null 2>&1 && echo "OK: http://localhost:7777" || echo "FAIL: check /tmp/backstage-viewer.log"
```

Then run this **second Bash command** to inject protocol into CLAUDE.md:
```bash
PLUGIN_ROOT="$(ls -d ~/.claude/plugins/cache/backstage/claude-backstage/*/ 2>/dev/null | sort -V | tail -1)"; PROTO="$PLUGIN_ROOT/BACKSTAGE-PROTOCOL.md"; CLAUDE_MD="$PLUGIN_ROOT/CLAUDE.md"; if [ -f "$PROTO" ] && [ -f "$CLAUDE_MD" ]; then perl -i -pe "BEGIN { \$done=0 } if (/<!-- BACKSTAGE:START -->/ && !\$done) { \$done=1; print; open(F,'$PROTO'); while(<F>){print}; close(F); next }" "$CLAUDE_MD" && echo "Protocol injected into CLAUDE.md"; else echo "SKIP: protocol or CLAUDE.md not found"; fi
```

Report the output. Do not add extra commands.

### 4. Turn OFF

Run this **single Bash command** (copy exactly, do not modify):
```bash
rm -f ~/.claude/plugins/backstage/enabled; lsof -ti:7777 | xargs kill 2>/dev/null; rm -f ~/.claude/plugins/backstage/viewer.pid; echo "Backstage OFF"
```

Then run this **second Bash command** to strip protocol from CLAUDE.md:
```bash
PLUGIN_ROOT="$(ls -d ~/.claude/plugins/cache/backstage/claude-backstage/*/ 2>/dev/null | sort -V | tail -1)"; CLAUDE_MD="$PLUGIN_ROOT/CLAUDE.md"; [ -f "$CLAUDE_MD" ] && perl -0777 -i -pe 's/(<!-- BACKSTAGE:START -->\n).*?(<!-- BACKSTAGE:END -->)/$1$2/s' "$CLAUDE_MD" && echo "Protocol stripped from CLAUDE.md" || echo "SKIP: CLAUDE.md not found"
```

Report the output. Do not add extra commands.

## Notes

- When OFF, all hooks immediately exit (no token cost)
- dialogue-generator is not called when OFF
- The enabled file at `~/.claude/plugins/backstage/enabled` controls all hook behavior
- **CLAUDE.md dynamic injection**: ON injects `BACKSTAGE-PROTOCOL.md` between markers; OFF strips it. This saves ~300 lines of context tokens when backstage is off.
- ON always kills existing server first, then starts fresh (no stale process issues)
- Uses `nohup` + `perl POSIX::setsid()` + `&` for triple process isolation:
  - `nohup`: ignores SIGHUP (terminal close)
  - `perl setsid()`: creates new session (immune to process group SIGTERM)
  - `&`: backgrounds from shell
- Viewer directory auto-detected: finds latest version in plugin cache via `sort -V`
- Liveness check uses `lsof -ti:7777` (port check), not `curl` (avoids false positives)
