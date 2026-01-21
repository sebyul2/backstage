# Backstage Configure Skill

Configure backstage display settings interactively.

## Instructions

Use AskUserQuestion to configure backstage settings:

1. Ask how many lines to display (3, 5, 10)
2. Ask history timeout in seconds (30, 60, 120)
3. Update config.json with the selected values
4. Copy to ~/.claude/plugins/backstage/config.json

After getting answers, update the config file at `~/.claude/plugins/backstage/config.json`:

```json
{
  "displayLines": <selected_lines>,
  "historyTimeout": <selected_timeout_ms>,
  "debug": false
}
```

Confirm the changes to the user.
