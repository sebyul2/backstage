# Claude Backstage - Architecture

> 이 프로젝트 코드 수정 전 반드시 1회 읽을 것.

## 한줄 요약

Claude Code의 서브에이전트 활동을 Gather Town 스타일 픽셀아트 사무실에서 실시간으로 보여주는 플러그인.

---

## 전체 데이터 흐름

```
[사용자 입력]
    |
    v
[UserPromptSubmit hook] ──> history.jsonl (type: request)
    |
    v
[메인 Claude가 도구 사용]
    |
    v
[PreToolUse hook] ──> history.jsonl (type: work, Chris 작업 기록)
    |                  + active-agent.json (Task인 경우)
    v
[도구 실행 완료]
    |
    v
[PostToolUse hook] ──> history.jsonl (type: work-done, C-Team 결과 기록)
                   ──> dialogue-queue.jsonl (3회마다 AI 대화 요청)
                   ──> history.jsonl (dialogue-generator 결과 파싱)
    |
    v
[server.ts] ──SSE──> [Viewer (index.html + JS)]
    |
    +──> transcript 파싱 → chris-log.jsonl (Chris 사고/응답 챕터)
    +──> dialogue-queue 소비 → claude --print → 대화 생성
    +──> /events (SSE), /chris-log, /tasks 등 API 엔드포인트
```

---

## 핵심 파일 역할

### Hooks (hooks/)

| 파일 | 트리거 | 역할 |
|------|--------|------|
| `pre-tool-hook.sh` | PreToolUse | Chris 도구 사용 기록 (Read/Grep은 10초 간격, Write/Edit/Bash는 항상). Task이면 active-agent.json 생성 |
| `post-tool-hook.sh` | PostToolUse | (1) dialogue-generator 결과 JSON 파싱→history (2) 일반 Task 완료→dialogue-queue에 complete 요청 (3) C-Team 작업 결과 기록 (4) 도구 3회마다 C-Team AI 대화 요청 |
| `user-prompt-hook.sh` | UserPromptSubmit | 사용자 메시지를 history에 request로 기록. 재귀 방지(BACKSTAGE_DIALOGUE env, 프롬프트 패턴 필터) |
| `stop-hook.sh` | Stop | 현재 빈 hook (서버는 10분 idle 시 auto-shutdown) |

### Server (viewer/server.ts)

Bun 서버, 포트 7777. 약 1500줄.

**핵심 기능:**
- **SSE `/events`**: history.jsonl을 tail -f 방식으로 실시간 스트리밍
- **Transcript 스캔**: Claude Code transcript(jsonl)를 주기적으로 읽어서:
  - `chris-log.jsonl` 생성 (Chris의 thinking/response/도구사용/에이전트를 챕터로 정리)
  - 같은 사용자 메시지 주제면 기존 챕터에 병합
  - thinking 캐시: transcript에서 redact되기 전 캡처 시도 (thinkingCache Map + fs.watch)
- **Task 목록**: transcript에서 TaskCreate/TaskUpdate 파싱 → `/tasks` API
- **Dialogue Queue 소비**: `dialogue-queue.jsonl`에서 대화 요청을 읽어 `claude --print`로 AI 대화 생성 → history.jsonl에 기록
- **정적 파일 서빙**: viewer/ 디렉토리 (HTML/JS/CSS)
- **버전 주입**: plugin.json 버전을 index.html 서빙 시 동적 치환

**주요 엔드포인트:**
| 경로 | 역할 |
|------|------|
| `/events` | SSE 스트림 (history.jsonl 실시간) |
| `/chris-log` | Chris 작업 노트 JSON 배열 |
| `/tasks` | 현재 Task 목록 |
| `/characters` | 캐릭터 정보 |
| `/refresh` | history 초기화 (chris-log는 보존) |
| `/version` | 플러그인 버전 |

### Viewer (viewer/)

Gather Town 스타일 2D 픽셀아트 사무실.

| 파일 | 역할 |
|------|------|
| `index.html` | 진입점. Canvas + 패널 레이아웃 |
| `js/main.js` | SSE 연결, 이벤트 디스패치, 키보드/플레이어 제어 |
| `js/engine.js` | 게임 루프 (30fps, update/render 분리, HiDPI) |
| `js/renderer.js` | Canvas 2D 그래픽 (사무실+휴게실, PICO-8 팔레트) |
| `js/character.js` | 캐릭터 상태머신 (idle/walk/work/break), 애니메이션, 이동 |
| `js/map.js` | 맵 데이터 (48px 타일, 30x15 그리드, 충돌맵, 가구) |
| `js/bubble.js` | 말풍선 시스템 (큐, 생명주기, 타입별 색상) |
| `js/sprite-generator.js` | 48x48 캐릭터 스프라이트 자동 생성 (PICO-8 팔레트) |
| `js/pathfinding.js` | A* 경로찾기 (타일 그리드 기반) |
| `js/physics.js` | Matter.js 래퍼 (2D 물리, 정적 장애물) |
| `js/particles.js` | 이모지 파티클 시스템 |
| `css/game.css` | 스타일시트 |

### 캐릭터 시스템

**메인 캐릭터 (에이전트 매핑):**
| 에이전트 타입 | 캐릭터 | 성격 |
|---------------|--------|------|
| (메인 Claude) | Chris | 팀장. thinking/talk/agent-status 표시 |
| explore | Jake | 신입, 밝음 |
| oracle/architect | David | 10년차 시니어, 쿨 |
| sisyphus-junior/executor | Kevin | 묵묵, 투덜 |
| frontend-engineer/designer | Sophie | 깔끔, UI 까탈 |
| document-writer | Emily | 꼼꼼, 친절 |
| librarian | Michael | 조용, 박학다식 |
| prometheus/planner | Alex | 전략적 |
| qa-tester | Sam | 꼼꼼, 장난기 |
| code-reviewer | Ethan | 날카로운 리뷰 |
| critic | Rachel | 팩폭 |

**C-Team (도구별 동적 할당, 8명):**
Mia, Kai, Zoe, Liam, Aria, Noah, Luna, Owen
- 도구(Read/Edit/Grep 등)별로 처음 할당된 캐릭터가 고정
- `c-team-pool.json`으로 매핑 관리

### 대화 생성 (dialogue-generator)

- 에이전트: `agents/dialogue-generator.md` (Haiku 모델)
- 트리거: 메인 Claude가 Task 호출 시 병렬로 dialogue-generator Task 호출
- 타입: assign(작업 지시), complete(완료 보고), update(Chris 독백)
- 출력: `{"lines": [{"speaker": "boss"|"agent", "msg": "..."}]}`
- C-Team 대화: post-hook이 dialogue-queue에 요청 → server.ts가 `claude --print`로 생성

---

## 파일 시스템 (런타임)

```
~/.claude/plugins/backstage/
  enabled                    # 플러그인 활성화 플래그
  history.jsonl              # 모든 이벤트 스트림 (SSE 소스)
  chris-log.jsonl            # Chris 작업 노트 (transcript 기반)
  dialogue-queue.jsonl       # 대화 생성 요청 큐
  active-agent.json          # 현재 활동 중인 에이전트 정보
  c-team-pool.json           # C-Team 도구-캐릭터 매핑
  c-counters/                # 도구별 호출 카운터 (C-Team 대화 빈도 제어)
  last-chris-epoch.txt       # Chris 도구 기록 타이밍 제어
  characters.json            # 캐릭터 설정
  debug-hook.log             # Hook 디버그 로그
  viewer/                    # 서버+뷰어 파일 (install.sh로 복사)
  agents/                    # dialogue-generator.md
```

---

## 배포 프로세스

```bash
# 1. 소스 수정
vim viewer/server.ts  # 또는 hooks/*.sh

# 2. 버전 올리기 (.claude-plugin/plugin.json)
# 패치 버전 +1 (예: 2.8.2 → 2.8.3)

# 3. 설치 (소스 → 캐시 + 플러그인 디렉토리 복사)
./install.sh

# 4. 서버 재시작
lsof -ti:7777 | xargs kill 2>/dev/null
cd ~/.claude/plugins/cache/backstage/claude-backstage/{version}/viewer && bun run server.ts &
```

캐시 경로: `~/.claude/plugins/cache/backstage/claude-backstage/{version}/`
서버는 캐시에서 실행됨. 소스만 수정하면 반영 안 됨!

---

## history.jsonl 이벤트 타입

| type | speaker | 설명 |
|------|---------|------|
| request | You/client | 사용자 입력 |
| work | Chris | Chris 도구 사용 중 |
| work-done | C-Team | 도구 완료 결과 |
| assign | Chris+에이전트 | 작업 지시 대화 |
| done | 에이전트+Chris | 완료 보고 대화 |
| task-create | Board | Task 생성 |
| task-update | Board | Task 상태 변경 |
| think | Chris | Chris thinking (bash echo로 직접 기록) |
| c-bubble | C-Team | C-Team AI 대화 |

---

## 알려진 이슈

- **Thinking redact**: Claude Code가 활성 세션의 이전 thinking을 빈 문자열로 redact. 방어 코드(thinkingCache)로 캡처 시도 중
- **Request 이벤트 중복**: hook이 2번 트리거되어 같은 사용자 메시지가 2번 기록
- **chris-log 현재 세션 미반영**: 새 세션 시작 시 transcript 경로가 바뀌면 스캔 실패 가능
