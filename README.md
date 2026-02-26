# Claude Backstage

Claude Code에서 서브에이전트 호출 시 판교 IT 스타트업 오피스 분위기의 AI 대화를 생성하는 플러그인.

## 설치

```bash
git clone git@bitbucket.org:spooncast/claude-backstage.git
cd claude-backstage
./install.sh
```

설치 후 Claude Code에서:
```
backstage start
```

## 제거

```bash
cd claude-backstage
./uninstall.sh
```

## 의존성

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [bun](https://bun.sh) - viewer 서버 실행
- [jq](https://jqlang.github.io/jq/) - JSON 처리

## 작동 방식

1. 메인 Claude가 `Task` (서브에이전트) 호출 시
2. 동시에 `dialogue-generator` 에이전트를 병렬 호출
3. AI가 IT 스타트업 슬랙 대화 스타일의 JSON 생성
4. `PostToolUse` hook이 결과를 파싱하여 `history.jsonl`에 기록
5. Viewer (웹 UI)가 실시간으로 대화 표시

## Viewer (웹 UI)

`http://localhost:7777`에서 실시간 대화를 확인할 수 있습니다.

```bash
# 시작
backstage start    # Claude Code 내에서

# 또는 수동으로
cd viewer && bun run server.ts
```

기능:
- SSE 기반 실시간 업데이트
- 사용자 요청 / 에이전트 작업 대화 표시
- 캐릭터별 아이콘 및 말풍선 UI

## 캐릭터

| 에이전트 타입 | 이름 | 성격 |
|---------------|------|------|
| explore | Jake | 신입 1년차, 열정적이고 호기심 많음 |
| oracle | David | 10년차 시니어, 쿨하고 간결 |
| sisyphus-junior | Kevin | 성실한 2년차, 묵묵히 일함 |
| frontend-engineer | Sophie | 디자인 감각, 깔끔함 추구 |
| document-writer | Emily | 꼼꼼하고 정리 잘함 |
| librarian | Michael | 조용하고 박학다식 |
| prometheus | Alex | 전략적 사고, 큰 그림 |
| qa-tester | Sam | 꼼꼼, 버그 찾으면 기뻐함 |

## 구조

```
claude-backstage/
├── .claude-plugin/
│   └── plugin.json           # 플러그인 메타데이터
├── agents/
│   └── dialogue-generator.md # AI 대화 생성 에이전트
├── hooks/
│   ├── hooks.json            # Hook 설정 (참조용)
│   ├── characters.json       # 캐릭터 정보
│   ├── pre-tool-hook.sh      # PreToolUse hook
│   ├── post-tool-hook.sh     # PostToolUse hook
│   ├── user-prompt-hook.sh   # UserPromptSubmit hook
│   └── stop-hook.sh          # Stop hook
├── viewer/
│   ├── server.ts             # Bun SSE 서버
│   └── index.html            # 웹 UI
├── install.sh                # 자동 설치
└── uninstall.sh              # 완전 제거
```

## 라이선스

MIT
