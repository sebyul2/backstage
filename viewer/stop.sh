#!/bin/bash
# Backstage Viewer - Stop Script

PID_FILE="$HOME/.claude/plugins/backstage/viewer.pid"

if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null
        echo "Backstage viewer stopped (PID: $pid)"
    else
        echo "Viewer process not running (stale PID: $pid)"
    fi
    rm -f "$PID_FILE"
else
    echo "No viewer PID file found"
fi
