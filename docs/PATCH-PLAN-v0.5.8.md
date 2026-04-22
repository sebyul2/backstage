# Patch Plan — v0.5.8

> 종합 코드/훅 리뷰 결과를 바탕으로 작성. 현재 버전 v0.5.7 → **v0.5.8 (bugfix)**, 이후 v0.5.9 / v0.6.0 후속.

---

## 1. 핵심 버그 (🔥 반드시 v0.5.8에 포함)

### B1. Jake/David 등 서브에이전트 캐릭터가 영구 잔존

**증상**: explore/oracle 등의 서브에이전트 작업이 끝나도 해당 캐릭터가 사무실에서 안 사라짐.

**근본 원인 (4중 실패)**:

1. `hooks/post-tool-hook.sh:225-233` — Task 완료 훅이 `dialogue-generator`가 아닌 일반 에이전트에게는 `done` 이벤트를 **절대 발행하지 않고 `exit 0`**. AI 대사만 담당하고 완료 신호는 서버 fallback에 미룸.
2. `hooks/hooks.json` — **`SubagentStop` 훅이 미등록**. Claude Code가 제공하는 가장 정확한 완료 신호를 버림.
3. `viewer/server.ts:475, 1169-1247` — 서버의 `AGENT_IDLE_TIMEOUT = 30_000` fallback은 `activeAgents` Map에 **transcript 스캔으로 tool_use가 포착된 경우에만** 등록됨. 툴 없이 끝난 에이전트, transcript 파싱 누락, 서버 재시작 직후(5초 skip window) 발생한 완료는 영구 미발동.
4. `viewer/js/character.js:410-413`의 45s WORKING safety는 연속 `handleWork` 수신 시 간접 리셋되어 사실상 동작 안 함. 명시적 TTL 부재.

**추가 증폭 요인**:
- `viewer/js/main.js:397-412`의 `handleWork`가 이미 WORKING 중인 같은 role 캐릭터에 중복 assign → Jake 하나에 여러 Task가 몰림.
- `resolveCharName(entry)` — `role` 필드가 `oh-my-claudecode:executor` 같은 플러그인 네임스페이스면 매핑 테이블 miss 가능성. history.jsonl에 실제로 그런 role 이 다수 찍혀있음.

**수정 방향 (B1a~B1e 묶음)**:

- **B1a**. `post-tool-hook.sh:225`에서 일반 Task 완료 시에도 `{type:"done", speaker, role, msg:""}` 를 `history.jsonl`에 **무조건 append**. AI 대사 생성은 별도 큐, 완료 신호는 즉시.
- **B1b**. `hooks.json`에 `SubagentStop` 매칭 + 새 `hooks/subagent-stop-hook.sh` 추가. `subagent_type`을 `ROLE_TO_NAME`으로 매핑하여 `done` 발행.
- **B1c**. `character.js` — `assignTask()`에 `this.lifetimeDeadline = Date.now() + 120_000` 절대 TTL 추가. `update()`에서 초과 시 강제 `completeTask()`. 서버 timeout(30s)과의 중복 트리거는 `completeTask()`를 idempotent 하게 만들어 해결.
- **B1d**. `main.js handleWork` — 같은 role 캐릭터가 이미 WORKING 이면 `workTimer`만 연장, 재 assign 금지.
- **B1e**. `resolveCharName` — `role` 문자열에 `:` 있으면 마지막 `:` 이후 조각으로 fallback 매칭 (`oh-my-claudecode:executor` → `executor`). 매핑 실패 시 디버그 로그.

### B2. SSE 재연결 5회 실패 시 영구 사망

**위치**: `viewer/js/main.js:665-669`. `reconnectAttempts >= MAX_RECONNECT` 이면 `showSessionEndOverlay()` 호출 후 멈춤. 서버 잠깐 재시작 → 수동 F5 필수.

**수정 (B2)**: 무한 지수 백오프 (최대 60s). `document.visibilityState === 'visible'` 이벤트 리스너로 복귀 시 강제 재시도. overlay 는 session END 이벤트(명시적 종료)에만 표시.

### B3. sed 기반 템플릿 치환 injection 위험

**위치**: `pre-tool-hook.sh:138`, `post-tool-hook.sh:347`. `sed "s/\${task}|$description|g"` 에서 `$description` 이 `/`, `|`, `&`, 개행, 역슬래시를 포함하면 sed 구문 파손 또는 명령 주입. Task 도구 파라미터(사용자 프롬프트 유래) = 신뢰 불가 입력.

**수정 (B3)**: `python3 -c` or `jq --arg` 로 안전한 문자열 치환으로 전환.

### B4. `/refresh` 시 history.jsonl truncate race

**위치**: `viewer/server.ts:2397` 근처. 열려있는 SSE 연결이 offset으로 tail하는 중 파일이 비워지면 이벤트 유실 + offset > size 에러.

**수정 (B4)**: `/refresh` 는 `writeFileSync(tmp)` + `rename` 으로 원자화. 모든 SSE 연결에 `offset=0` resync 이벤트 broadcast.

### B5. `thinkingCache` 등 전역 Map 무제한 증가

**위치**:
- `server.ts:457` `thinkingCache` — 세션 전환시만 clear, 장시간 같은 세션이면 무한 누적 (1M ctx 세션에서 수백 MB 가능).
- `server.ts:419-422` `agentTypeMap`, `agentIdToType`, `subagentOffsets`, `otherTranscriptOffsets` — 조건부 정리만 있고 TTL 없음.

**수정 (B5)**: LRU 캡(200 entries). chapter 등록 후 해당 `msgId` 즉시 삭제. 세션 전환 시 전체 clear.

### B6. C-Team 풀 파일 race condition

**위치**: `post-tool-hook.sh:22-39`. 멀티 세션 동시 훅 → `c-team-pool.json.tmp` 덮어쓰기 경쟁으로 할당 유실.

**수정 (B6)**: `flock "$C_TEAM_POOL_FILE"` 로 임계구역 보호.

---

## 2. 안정성/성능 개선 (v0.5.9)

### I1. 훅 성능
- `pre-tool-hook.sh:101` — `curl /trigger-scan` 에 `--max-time 0.2 --connect-timeout 0.2` 추가. 현재 서버 down 시 TCP timeout 걸릴 수 있음.
- `post-tool-hook.sh:341` — `extract-data.py` per-tool 호출을 Bun 장기실행 프로세스로 위임 또는 `jq` 호출 batch 화. (10배 이상 훅 오버헤드 개선 예상)
- `post-tool-hook.sh:143-149` — `dialogue_type` 을 prompt 정규식으로 추론 말고 dialogue-queue 기록 시 별도 field 로 저장 → complete/work 대사 오분류 방지.

### I2. `history.jsonl` / `chris-log.jsonl` 라이프사이클
- 무제한 append 중. 크기 기준 rotate (10MB 초과 시 `.1` 로 회전, 3 세대 보관).
- `/chris-log` 엔드포인트는 최근 N 챕터만 반환.
- 동시 쓰기는 4KB 초과 라인에서 POSIX atomicity 미보장 — 훅 측에서 한 번에 쓸 JSON 라인 길이 하드 제한 + 분할.

### I3. 캐릭터 lifecycle 단일 소스화
- 서버 `AGENT_IDLE_TIMEOUT` 30s 와 클라이언트 safety 45s 가 충돌. 서버를 SSOT 로, 클라이언트 safety 는 서버 timeout + 버퍼(60s)로 설정.
- `completeTask()` idempotent 재검토 (서버/클라 double fire 흡수).

### I4. 말풍선 겹침
`viewer/js/bubble.js:188-193` — 좌우/상단 clamp 만 있고 **다른 캐릭터 말풍선과의 충돌 무시**. 같은 책상열의 2명 동시 대사 시 240px 폭 말풍선 2개가 겹쳐 읽을 수 없음. 기존 말풍선의 bounding box 와 비교하여 세로 offset 추가.

### I5. `claude -p` dialogue-generator 프로세스 좀비 방지
`server.ts:2646-2657` — 60s timeout 후 SIGTERM → SIGKILL 에스컬레이션, `proc.exited` await 보장. `dialogueQueueProcessing` flag 가 큐 전체를 블록하는 구조 → 요청당 타임아웃 격리.

### I6. `stop-hook.sh` 실질적 작업 추가
현재 `{"continue": true}` 만 출력. 세션 종료 시 `active-agent.json`, `pending-steps.jsonl` truncate. `dialogue-queue.jsonl` 의 오래된 pending 제거.

---

## 3. omc (oh-my-claudecode) 의존성 제거 — v0.5.8 포함

**현재 상태**:
- `viewer/server.ts:692, 1645` — `String(input.subagent_type).replace(/^oh-my-claudecode:/, '')`
- `hooks/post-tool-hook.sh:255` — `sed 's/^oh-my-claudecode://'`
- `install.sh:111,115,219` — rsync `--exclude='.omc'` (파일 필터일 뿐, 의존성 아님 → 유지)

**문제**: omc 플러그인의 `subagent_type` 네임스페이스(`oh-my-claudecode:executor` 등)만 특별 취급. 다른 플러그인(`dexus:*`, `vigloo:*` 등)은 그대로 남아 `ROLE_TO_NAME` 매핑 실패 → resolveCharName 실패의 또 다른 원인.

**수정 (O1)**: 하드코딩된 prefix 를 범용 네임스페이스 stripping 으로 교체.
```ts
// before
const agentType = String(input.subagent_type).replace(/^oh-my-claudecode:/, '');
// after — 모든 plugin:name 형태 지원
const agentType = String(input.subagent_type).replace(/^[^:]+:/, '');
```
Shell 동일:
```sh
# before
_ps_short=$(echo "$_ps_atype" | sed 's/^oh-my-claudecode://')
# after
_ps_short=$(echo "$_ps_atype" | sed 's/^[^:]*://')
```
이 변경은 B1e (`resolveCharName` namespace-aware fallback) 과 맞물려 **모든 플러그인 서브에이전트가 올바른 캐릭터에 매핑**되게 함.

---

## 4. Claude Code 신규 훅/기능 활용 (v0.5.8 ~ v0.6.0)

> 참조: https://code.claude.com/docs/en/changelog — v2.1.76 이후 추가된 hook 이벤트/output schema 로 **현재 backstage 가 fallback 에 의존하는 여러 지점을 정식 신호로 교체 가능**.

### C1. `SubagentStop` → 즉시 적용 (v0.5.8)
이미 B1b 에 포함. 기존 30s idle fallback 완전 대체.

### C2. `TaskCreated` hook 추가 (v2.1.84) → v0.5.8
현재 `PreToolUse` 에서 `tool_name === "Task"` 를 감지해 agent assign 을 발행. 하지만 Task 가 여러 도구를 호출하는 중에도 계속 PreToolUse 가 걸려서 중복 처리 방어 코드가 복잡함.
- **변경**: `TaskCreated` hook 을 등록해 **생성 시점에만 1회** assign 이벤트 발행. PreToolUse 의 Task 분기는 제거.
- 효과: 중복 assign 버그 원천 차단, 훅 로직 단순화.

### C3. `PreCompact` hook → thinking snapshot (v2.1.105) → v0.5.9
현재 `thinkingCache` + `showThinkingSummaries: true` 로 redact 방어 중. 하지만 compaction 후 transcript 의 과거 thinking 은 여전히 유실 가능.
- **변경**: `PreCompact` hook 에서 현재 transcript 를 파싱해 `thinking-snapshots/{sessionId}-{ts}.jsonl` 로 저장. 서버가 snapshot 을 우선 읽고 현재 transcript 로 덮어씀.
- 효과: 장시간 세션에서 chris-log 챕터의 thinking 완전 보존. `thinkingCache` Map 도 snapshot 이후 안전하게 비울 수 있음 (B5 와 시너지).

### C4. `SessionEnd` / `StopFailure` hook → v0.5.8
- `SessionEnd` (v2.1.101: subagent `--resume` 도 포함)
- `StopFailure` (v2.1.78: API 에러로 turn 종료)
- **변경**: `hooks/session-end-hook.sh` 추가. 세션 종료 시 `active-agent.json`, `pending-steps.jsonl`, 오래된 `dialogue-queue.jsonl` 항목 truncate. `StopFailure` 는 뷰어에 명시적 "session ended (error)" 오버레이 표시.
- 효과: 현재 stop-hook.sh 실질 no-op 문제(I6) 근본 해결.

### C5. `CwdChanged` hook → 프로젝트 뱃지 정확도 (v2.1.83) → v0.5.9
현재 멀티세션 프로젝트 뱃지는 `ps + lsof` 로 추정. `CwdChanged` 로 정확한 프로젝트 전환 시점을 받아 `project-switches.jsonl` 에 기록 → 뷰어가 SSE 로 실시간 반영.
- 효과: B5 의 `otherTranscriptOffsets` 누수 동시 해소 (cwd 이벤트로 TTL 갱신).

### C6. Hook `if` conditional 필드 → 훅 오버헤드 제거 (v2.1.85) → v0.5.8
현재 `pre-tool-hook.sh` 는 모든 Read/Grep 호출에 대해 실행되지만 실제로는 **10초 간격 gate 로 대부분 early-exit**. 이 gate 를 hook `if` 로 옮기면 프로세스 spawn 자체를 스킵.
- **변경 (hooks.json)**:
```json
{
  "matcher": "Read|Glob|Grep",
  "if": "Bash(*)",
  "hooks": [...]
}
```
그리고 Edit/Write/Bash 는 별도 항목으로 분리해 항상 실행.
- 효과: 세션당 수백~수천 번의 bash 프로세스 fork 제거. 특히 대량 Read 사용 시 체감 성능 개선.

### C7. `${CLAUDE_PLUGIN_DATA}` 변수 사용 (v2.1.78) → v0.5.9
현재 runtime 데이터를 `~/.claude/plugins/backstage/` 에 직접 저장 — **플러그인 업데이트 시 이 경로의 일부가 초기화될 수 있음**. `${CLAUDE_PLUGIN_DATA}` 는 업데이트 후에도 상태 유지되는 전용 데이터 디렉터리.
- **변경**: `history.jsonl`, `chris-log.jsonl`, `thinking-snapshots/`, `c-team-pool.json` 등 **상태성 데이터**만 `${CLAUDE_PLUGIN_DATA}` 로 이전. `viewer/`, `agents/` 등 배포 리소스는 현행 유지.
- 효과: 업데이트 시 히스토리/챕터 유실 방지.

### C8. `PreToolUse` output 에 `updatedInput` + `permissionDecision` (v2.1.89) → v0.6.0
backstage 는 기본적으로 read-only 관찰자지만, 향후 "민감한 파일 열람 시 캐릭터가 멈칫" 같은 연출에 활용 가능. 우선순위 낮음.

### C9. `UserPromptSubmit` 의 `sessionTitle` (v2.1.84) → v0.6.0
사용자 첫 프롬프트로 session title 자동 설정 — 뷰어 HUD 에 현재 세션 주제 표시. 개발자 UX 개선.

### C10. Background subagent partial progress (v2.1.101) → v0.6.0 (F4 대체)
이전 플랜 F4 ("말풍선 큐 시각화") 를 확장: background subagent 가 보내는 partial progress 를 **캐릭터 머리 위 진행률 바**로 시각화. 현재는 완료/미완료 이진 상태만 표시 중.

---

## 5. 신규 기능 (v0.6.0)

### F1. 캐릭터 자동 퇴장 (IDLE_BREAK 오래 지속 시)
휴게실에서 N 분 이상 idle 이면 fade out + 퇴근 애니메이션. `character.js` 에 `idleBreakAccumulated` 타이머 추가.

### F2. 라이트/다크 테마 토글
`/config` 엔드포인트는 있지만 UI 런타임 토글 없음. PICO-8 팔레트 daytime/nighttime 2종을 css variable 로 분리하고 HUD 버튼 추가.

### F3. 프로젝트 뱃지 클릭 → 필터
현재 멀티세션 뱃지는 표시만 됨. 클릭 시 해당 프로젝트 이벤트만 표시하는 필터 모드.

### F4. 말풍선 큐 시각화
`BubbleManager.queues` 사이즈를 캐릭터 머리 위 작은 숫자로. 백로그 몰림 시각화.

### F5. 세션 전환 완전 리셋 옵션
`/refresh` 확장: 캐릭터 책상 배치, 누적 토큰 바, pending steps 까지 초기화하는 "full reset" 모드.

### F6. 디버그 HUD 토글 (개발자용)
`D` 키 → 활성 에이전트 map, thinkingCache 크기, SSE 연결 상태, 큐 깊이 실시간 표시. 버그 재현 시 스크린샷으로 상태 공유 용이.

---

## 6. 실행 순서 (v0.5.8 릴리즈 체크리스트)

### v0.5.8 — 버그픽스 + omc 의존성 제거 + Claude Code 신규 훅 1차 적용

1. **O1**: omc prefix 하드코딩 → 범용 namespace stripping (3 파일, 5분 작업)
2. **B1a-e**: Jake 잔존 버그 근본 수정 (hook + server + client)
   - [ ] `post-tool-hook.sh` done 이벤트 무조건 발행
   - [ ] `hooks.json` `SubagentStop` 추가 + 스크립트 (C1)
   - [ ] `character.js` 명시적 120s TTL + idempotent completeTask
   - [ ] `main.js handleWork` 중복 assign 방지
   - [ ] `main.js resolveCharName` namespace-aware fallback (O1과 페어)
3. **C2**: `TaskCreated` hook 등록 → PreToolUse Task 분기 제거
4. **C4**: `SessionEnd` / `StopFailure` hook 등록 + `session-end-hook.sh`
5. **C6**: `hooks.json` 에 `if` conditional 적용 (Read/Glob/Grep 오버헤드 제거)
6. **B2**: SSE 무한 백오프 + visibility 재연결
7. **B3**: sed injection 제거 (jq/python 치환)
8. **B4**: `/refresh` 원자적 truncate + SSE resync
9. **B5**: 전역 Map LRU 캡
10. **B6**: C-Team pool flock
11. **테스트**:
    - 여러 subagent 병렬 실행 → 120s 내 전원 퇴근
    - 다른 플러그인(`vigloo:*`) subagent 도 올바른 캐릭터로 매핑
    - 서버 kill/restart → 뷰어 자동 재연결
    - `/refresh` 중 이벤트 유실 없음
    - 30분+ 세션에서 thinkingCache 사이즈 상한
    - `SubagentStop` 훅이 실제 발행되는지 확인
12. **버전업**: `.claude-plugin/plugin.json` 0.5.7 → 0.5.8
13. **배포**: `./install.sh` + 서버 재시작

### v0.5.9 — 안정성 + 신규 훅 2차
- I1~I6 전부
- C3 (`PreCompact` thinking snapshot)
- C5 (`CwdChanged` 프로젝트 뱃지)
- C7 (`${CLAUDE_PLUGIN_DATA}` 이전)

### v0.6.0 — 신규 기능
- F1 ~ F6
- C8, C9
- C10 (background subagent partial progress — F4 흡수)

---

## 7. 파일 참조 요약

| 버그/개선 | 주요 파일 |
|----------|----------|
| B1 (Jake 잔존) | `hooks/post-tool-hook.sh:225-233`, `hooks/hooks.json`, `viewer/js/character.js:267-413`, `viewer/js/main.js:300-412` |
| B2 (SSE 사망) | `viewer/js/main.js:640-680` |
| B3 (sed injection) | `hooks/pre-tool-hook.sh:138`, `hooks/post-tool-hook.sh:347` |
| B4 (refresh race) | `viewer/server.ts:2397`, `viewer/server.ts:1938-1947` |
| B5 (Map 누수) | `viewer/server.ts:419-457`, `viewer/server.ts:1904-1908` |
| B6 (pool race) | `hooks/post-tool-hook.sh:22-39` |

---

## 8. 롤백 가드

- 각 버그픽스는 독립 커밋으로 분리 (bisect 용이).
- B1 은 hook 스크립트 + server + client 세 곳 변경이지만, 각 레이어가 idempotent 하게 동작하도록 구현 (한 쪽만 롤백해도 캐릭터는 퇴장).
- 배포 전 현재 `history.jsonl` 백업 권장 (신규 필드 파싱 실패 대비).
