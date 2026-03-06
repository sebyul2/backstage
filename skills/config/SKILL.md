---
name: config
description: Configure Backstage settings (language, AI dialogue)
---

# Backstage Configuration

Read the current config from `~/.claude/plugins/backstage/config.json`. If it doesn't exist, use defaults: `{"language": "en", "ai_dialogue": true}`.

Use AskUserQuestion to present the settings to the user:

## Question 1: Language
- Header: "Language"
- Question: "Which language should Backstage use?"
- Options:
  - "English" (description: "All UI text and dialogues in English")
  - "한국어" (description: "모든 UI 텍스트와 대화를 한국어로 표시")

## Question 2: AI Dialogue
- Header: "AI Dialogue"
- Question: "Enable AI-generated character dialogue?"
- Options:
  - "Enabled" (description: "Characters chat using AI-generated dialogue (uses API tokens)")
  - "Disabled" (description: "Characters show pre-written idle chat only (no extra API cost)")

After getting answers, write the config to `~/.claude/plugins/backstage/config.json`.

Display a summary of the saved configuration.
