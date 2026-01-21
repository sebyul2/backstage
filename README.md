# Claude Backstage

IT 스타트업 오피스 분위기를 Claude Code 에이전트 인터랙션에 추가하는 플러그인입니다.

Task 호출 시 에이전트들이 마치 스타트업 사무실 동료처럼 실시간으로 대화하며 작업을 수행합니다.

## 프로젝트 소개

Claude Backstage는 Claude Code의 Task 도구를 호출할 때마다 AI가 생성하는 동적 대화를 통해 개발 워크플로우에 생기를 더합니다. 각 에이전트가 고유한 성격과 역할을 가지고 실시간으로 소통하는 모습을 보며 단조로운 작업 로그 대신 재미있는 팀 협업 경험을 제공합니다.

## 주요 기능

- **동적 대화 생성**: Task 호출 시마다 AI가 IT 스타트업 스타일의 자연스러운 대화를 생성합니다
- **에이전트 성격화**: 각 에이전트(explore, oracle, sisyphus-junior 등)가 고유한 성격과 대사를 가집니다
- **실시간 상태 피드백**: 작업 중, 완료, 실패 상황에 따라 상황에 맞는 대사가 나옵니다
- **테크리드 반응**: 작업 완료 후 테크리드 Chris의 피드백으로 마무리됩니다

## 미리보기

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

## 에이전트 캐릭터

| Agent | 이름 | 역할 | 성격 |
|-------|------|------|------|
| explore | Jake | 빠른 검색 | grep 마스터. 커피 대신 몬스터 |
| oracle | David | 아키텍처 분석 | 10년차 시니어. 깊이 있는 기술 통찰 |
| sisyphus-junior | Kevin | 개발 실행 | 열정 주니어. TODO 킬러 |
| frontend-engineer | Sophie | 프론트엔드 | 프론트 장인. 픽셀 단위 강박 |
| prometheus | Alex | 전략/계획 | PM겸 전략가. 로드맵 마스터 |
| momus | Rachel | 코드 리뷰 | 코드 리뷰어. Request changes 장인 |
| document-writer | Emily | 문서 작성 | README 아티스트. 주석 정리 전문 |
| librarian | Michael | 레퍼런스 | Stack Overflow 전문가 |
| multimodal-looker | Luna | 시각 분석 | 스크린샷/목업 분석가 |
| metis | Tom | 리스크 분석 | edge case 찾기 귀신 |
| qa-tester | Sam | QA 테스트 | 버그 스나이퍼 |

## 설치 방법

### 빠른 설치 (권장)

```bash
git clone https://github.com/YOUR_USERNAME/claude-backstage.git
cd claude-backstage
bash install.sh
```

### 수동 설치

1. **플러그인 디렉토리 생성 및 파일 복사:**

```bash
mkdir -p ~/.claude/plugins/backstage
cp -r src/* ~/.claude/plugins/backstage/
chmod +x ~/.claude/plugins/backstage/*.sh
```

2. **`~/.claude/settings.json` 설정:**

`~/.claude/settings.json` 파일을 열어 `hooks` 섹션에 다음을 추가합니다:

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

3. **Claude Code 재시작:**

설정 적용을 위해 Claude Code를 재시작합니다.

## 설정 방법

### 환경 변수

Claude Backstage를 실행하기 위해 다음 환경 변수를 설정해야 합니다:

```bash
# Anthropic API 키 (필수)
export ANTHROPIC_API_KEY="your-api-key-here"

# 선택 사항
export BACKSTAGE_DIR="$HOME/.claude/plugins/backstage"  # 플러그인 디렉토리 (기본값)
export BACKSTAGE_DEBUG="false"  # 디버그 로그 활성화
```

`ANTHROPIC_API_KEY`는 Anthropic 콘솔에서 발급받을 수 있습니다.

### Config.json 옵션

`~/.claude/plugins/backstage/config.json` 파일을 수정하여 플러그인의 동작을 커스터마이징할 수 있습니다:

```json
{
  "displayLines": 8,           // 대화 화면에 표시할 최대 라인 수
  "historyTimeout": 300000,    // 이전 대화 기록 보존 시간 (밀리초)
  "enabled": true,             // 플러그인 활성화 여부
  "aiEnabled": true            // AI 기반 동적 대화 생성 활성화
}
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `displayLines` | 8 | 한 번에 표시되는 대화 라인 수. 값이 작을수록 간단한 표시 |
| `historyTimeout` | 300000 | 대화 기록을 보관하는 시간(밀리초). 300000 = 5분 |
| `enabled` | true | 플러그인의 전체 활성화 여부 |
| `aiEnabled` | true | AI 기반 대화 생성 활성화. false로 설정하면 사전 정의된 대사만 사용 |

## 캐릭터 커스터마이징

`~/.claude/plugins/backstage/characters.json` 파일을 편집하여 에이전트의 성격과 대사를 완전히 커스터마이징할 수 있습니다.

### 기본 구조

```json
{
  "boss": {
    "role": "tech-lead",
    "name": "Chris",
    "personality": "스타트업 테크리드. 스탠드업 장인"
  },
  "agents": {
    "agent-id": {
      "name": "이름",
      "personality": "성격 설명",
      "success_lines": ["완료 대사 1", "완료 대사 2"],
      "working_lines": ["작업 중 대사 1", "작업 중 대사 2"],
      "fail_lines": ["실패 대사 1", "실패 대사 2"],
      "idle_lines": ["대기 중 대사 1", "대기 중 대사 2"]
    }
  },
  "boss_reactions": {
    "success": ["LGTM", "ship it!"],
    "fail": ["rollback 각?", "hotfix 필요"],
    "assign": ["이거 좀 봐줘", "priority high임"]
  }
}
```

### 커스터마이징 예시

#### 1. 기존 에이전트 대사 변경

```json
{
  "agents": {
    "explore": {
      "name": "Jake",
      "personality": "빠른 손. grep 마스터",
      "success_lines": [
        "완벽하게 찾음!",
        "여기에 있어요"
      ],
      "working_lines": [
        "검색 중입니다...",
        "코드베이스 스캔 중"
      ],
      "fail_lines": [
        "못 찾겠는데요?",
        "정말 있는 거 맞아요?"
      ]
    }
  }
}
```

#### 2. 새 에이전트 추가

```json
{
  "agents": {
    "my-custom-agent": {
      "name": "Jordan",
      "personality": "우리 팀의 멋진 개발자",
      "success_lines": [
        "성공했어요!",
        "준비됐습니다!"
      ],
      "working_lines": [
        "작업 중...",
        "진행 중입니다"
      ],
      "fail_lines": [
        "음... 문제가 있네요",
        "다시 시도해볼게요"
      ]
    }
  }
}
```

#### 3. 테크리드 반응 커스터마이징

```json
{
  "boss_reactions": {
    "success": [
      "완벽해!",
      "좋아, 배포하자",
      "이 정도면 충분해"
    ],
    "fail": [
      "뭐 이럴 수가",
      "긴급 대응 필요",
      "릴리스 연기"
    ],
    "assign": [
      "한 번 봐줄래?",
      "급하니까 빨리",
      "이번 주 안으로 부탁"
    ]
  }
}
```

### 대사 작성 팁

- **자연스러운 표현**: 실제 개발팀이 쓰는 표현을 사용하세요
- **짧고 명확함**: 한 줄에 한 생각으로 유지하세요
- **성격 일관성**: 각 에이전트의 성격에 맞는 톤과 스타일 유지
- **이모지 활용**: 선택 사항이지만 대화를 더 생생하게 만듭니다

### 주요 캐릭터별 스타일 가이드

| 캐릭터 | 스타일 | 예시 |
|--------|--------|------|
| Jake (explore) | 캐주얼, 빠름 | "ez. 바로 찾음", "여기요~ PR 링크 드림" |
| David (oracle) | 심각, 전문적 | "분석 완료. 여기가 root cause임" |
| Kevin (sisyphus-junior) | 열정적, 긍정적 | "deploy 완료!", "맡겨주세요!" |
| Sophie (frontend-engineer) | 디테일, 세심함 | "UI 완성! 반응형까지", "픽셀 완벽하게" |
| Alex (prometheus) | 전략적, 체계적 | "플랜 완성! 칸반보드에 올림" |

## 필수 요구사항

- **jq**: JSON 파싱을 위한 커맨드라인 도구
  ```bash
  # macOS
  brew install jq

  # Linux (Ubuntu/Debian)
  sudo apt-get install jq
  ```

- **curl**: API 호출용 (대부분 시스템에 이미 설치)

## 선택 사항

- **bun**: Statusline 표시용 (선택 사항)
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

## Statusline 설정 (선택)

[claude-hud](https://github.com/anthropics/claude-hud)와 함께 사용하여 상태 표시줄에서 최근 대화를 볼 수 있습니다.

`~/.claude/settings.json`의 `statusLine` 섹션에 다음을 추가하세요:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun $HOME/.claude/plugins/backstage/statusline.ts"
  }
}
```

## 문제 해결

### 대화가 나타나지 않음

1. `ANTHROPIC_API_KEY` 환경 변수가 설정되어 있는지 확인하세요
2. `~/.claude/settings.json`에 hooks가 올바르게 설정되었는지 확인하세요
3. Claude Code를 완전히 재시작해보세요
4. 플러그인 디렉토리가 `~/.claude/plugins/backstage/`에 있는지 확인하세요

### API 오류

- API 키가 유효한지 확인하세요
- Anthropic 콘솔에서 API 사용량을 확인하세요
- 네트워크 연결을 확인하세요

### 대화가 어색함

`characters.json`에서 `aiEnabled` 옵션을 `false`로 설정하면 AI 생성 대화 대신 사전 정의된 대사만 사용합니다:

```json
{
  "enabled": true,
  "aiEnabled": false
}
```

## 라이선스

MIT

## 저자

Claude Backstage Team
