# Claude Backstage

IT 스타트업 오피스 분위기를 Claude Code 에이전트 인터랙션에 추가하는 플러그인.

Task 호출 시 에이전트들이 마치 스타트업 사무실 동료처럼 대화합니다.

## Preview

```
━━━ Backstage [14:32:15] ━━━

Chris (tech-lead) → Jake (explore):
  "priority high임 API 엔드포인트 찾아줘"

Jake:
  "잠만 grep 돌리는 중..."

━━━ Backstage [14:32:18] ━━━

Jake (explore):
  "ez. 바로 찾음"
  → src/controller/UserController.kt:42

Chris:
  "LGTM"
```

## Characters

| Agent | Name | Role |
|-------|------|------|
| explore | Jake | grep 마스터. 커피 대신 몬스터 |
| oracle | David | 10년차 시니어. 아키텍처 덕후 |
| sisyphus-junior | Kevin | 열정 주니어. TODO 킬러 |
| frontend-engineer | Sophie | 프론트 장인. 픽셀 단위 강박 |
| prometheus | Alex | PM겸 전략가. 로드맵 마스터 |
| momus | Rachel | 코드 리뷰어. Request changes 장인 |
| ... | ... | 그 외 다수 |

## Installation

### Quick Install

```bash
git clone https://github.com/YOUR_USERNAME/claude-backstage.git
cd claude-backstage
./install.sh
```

### Manual Install

1. 파일 복사:
```bash
mkdir -p ~/.claude/plugins/backstage
cp src/* ~/.claude/plugins/backstage/
chmod +x ~/.claude/plugins/backstage/*.sh
```

2. `~/.claude/settings.json`에 훅 추가:
```json
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
```

3. Claude Code 재시작

## Requirements

- [jq](https://stedolan.github.io/jq/) - JSON 파싱용
- [bun](https://bun.sh/) - statusline용 (optional)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKSTAGE_DIR` | `~/.claude/plugins/backstage` | 플러그인 디렉토리 |
| `BACKSTAGE_DEBUG` | `false` | 디버그 로그 활성화 |

### Custom Characters

`src/characters.json`을 수정하여 캐릭터 대사를 커스텀할 수 있습니다.

## Statusline (Optional)

[claude-hud](https://github.com/anthropics/claude-hud)와 함께 사용하면 statusline에서 최근 대화를 볼 수 있습니다.

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun $HOME/.claude/plugins/backstage/statusline.ts"
  }
}
```

## License

MIT
