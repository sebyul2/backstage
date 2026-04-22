# Changelog

All notable changes to Claude Backstage are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.1] — 2026-04-22

### Fixed
- **Plugin hook duplicate execution**: backstage 가 `~/.claude/plugins/backstage/`
  (legacy direct-install) 와 `~/.claude/plugins/marketplaces/backstage/`
  (marketplace) 양쪽에서 동시에 로드되어 **모든 훅이 2번씩 실행**되고 있었음.
  같은 `TaskUpdate` 이벤트가 history.jsonl 에 2번 기록되어 칸반 보드에
  유령 카드가 쌓이고 dashboard 의 task 개수가 부풀려짐.
  - `install.sh` 가 legacy `hooks.json` 을 자동 제거.
  - `install.sh` 가 marketplace 경로에도 최신 훅/viewer 를 rsync 동기화
    (로컬 개발 시 git push 없이 즉시 반영).
- **Pre-hook TaskCreate 중복 기록**: `pre-tool-hook.sh` 가 `TaskCreate` 를
  id 없이 history 에 기록하고 `post-tool-hook.sh` 가 id 포함으로 또 기록하여
  같은 task 가 두 번 등록되던 문제 제거 — post-hook 한쪽으로 일원화.
- **TaskUpdate null 방어**: `post-tool-hook.sh` 가 `taskId`/`status` 가 `null`
  이거나 빈 문자열일 때도 레코드를 작성해 dashboard 가 `id:null` 유령 엔트리
  를 누적하던 문제 제거.
- **Pre-tool-hook STATE_DIR 누락 보충**: v0.5.10 에서 `${CLAUDE_PLUGIN_DATA}`
  를 지원하기로 했으나 실수로 `pre-tool-hook.sh` 만 변경이 누락돼 있었음
  (post/user-prompt/subagent-stop/session-end 는 이미 적용). 모든 훅이 이제
  동일한 `STATE_DIR` 규칙을 따름.
- **Plan 캡처 포맷 버그 (회귀 수정)**: macOS `sed` 가 GNU `\+` 를 리터럴로
  해석해 `^#\+` 패턴이 `#` 을 제거하지 못했음. POSIX `#* *` 패턴으로 교체.
  plan 원문이 이미 heading 으로 시작하면 중복 추가하지 않고, 메타정보는
  HTML 주석(`<!-- backstage: captured at ... -->`) 으로 감싸 마크다운
  렌더에 섞이지 않게 함.
- **Usage bar 100% 고정**: `cacheReadTokens` 가 토큰 fallback 합산에 들어가
  실제 토큰 사용량의 17배로 부풀려져 bar 가 항상 꽉 차 보였음. fallback
  자체를 제거하고 Anthropic API (`fiveHour`/`sevenDay`) 가 null 이면 `--`
  로 표시. 기존 단일 Usage bar 를 **5H + 7D 이원화** 해서 둘 다 한눈에
  확인 가능. 수치 색상은 60%/85% 임계값으로 노랑→빨강 전환.
- **claude-hud 캐시 stale 허용**: 5분 TTL 을 제거하고 숫자만 유효하면
  그대로 표시. null 보다 stale 수치가 UX 상 낫다고 판단.

### Changed
- `handleTaskCreate`/`handleTaskUpdate` 의 id 병합 로직 강화. id 없던 과거
  엔트리에 새로 들어온 id 를 주입하는 식으로 누적 정합성 유지.
- **Completed task 상한** 도입 (20개). 무제한 누적되던 dashboard 를
  최근 완료 N개만 유지.

### Internal
- `.claude-plugin/plugin.json` 버전: `0.6.0` → `0.6.1`.

---

## [0.6.0] — 2026-04-22

### Added
- **F1 · Break-room auto-leave fade**: 휴게실에서 2.5분 이상 아무 이벤트 없이
  idle 한 에이전트는 2초 alpha fade 후 `_offscreen` 처리되어 화면에서
  사라짐. 다음 assign 시 즉시 `alpha=1` 로 복귀. 장시간 세션에서 퇴근 안
  한 캐릭터들이 휴게실에 침전되던 문제 해결.
- **F4 · Speech bubble queue badge**: 캐릭터의 말풍선 대기열이 2개 이상이면
  현재 bubble 우상단에 작은 핑크 카운터 뱃지. `9+` 로 상한 표시. 말풍선
  폭주 구간을 한눈에 파악.
- **F6 · Debug HUD (Shift+D)**: FPS · SSE 상태 · 캐릭터 상태별 카운트
  (work/break/offscreen) · 활성/대기 bubble · task 수 · 컨텍스트 사용률
  · 재연결 상태를 실시간 표시하는 고정 오버레이. `requestAnimationFrame`
  샘플링 + 250ms tick. 기본 off — 눌러야 나타남.
- **C5 · CwdChanged hook**: Claude Code v2.1.83+ 의 `CwdChanged` 이벤트에
  등록. `active-session-cwd.txt` 갱신 + `project-switches.jsonl` append.
  서버가 transcript 선택할 때 `ps+lsof` 폴링 대신 정식 시그널 사용.
- **Time-of-day lighting cue**: 시스템 시계 기준 아이콘 변화 + monitorBoost
  (0.0 ~ 1.4) 파라미터 제공. 저녁/야간 시 모니터 화면 발광 강도가 증가하는
  식으로 자연스러운 무드 변화 (전면 색 필터가 아닌 간접 표현으로 변경
  — 사용자 피드백 반영).
- **Bubble typewriter effect**: 15자 이상 대사는 초당 ~33자 속도로 타자
  쳐지며 나타나고 커서 블록이 깜빡임. 짧은 대사는 즉시 표시.
- **Plan capture (ExitPlanMode)**: Claude Code v2.1.105+ 가 Plan Mode 출력
  파일 자동 저장을 중단했음. `post-tool-hook.sh` 가 `ExitPlanMode` 를
  감지해 `${STATE_DIR}/plans/{timestamp}-{slug}.md` 로 직접 보관. 서버
  `/plans` · `/plan/:name` 응답이 captured → legacy → archive 순으로 병합.

### Changed
- `character.js` 에 `AGENT_ABSOLUTE_TTL` (120s) 상수 도입 — assign 시점
  기준 절대 TTL. 기존 `workTimer` 45초 safety 는 재진입 시 리셋되어
  의미 없음 → 제거.
- `main.js handleWork` 가 이미 WORKING 중인 캐릭터를 재할당 대신 tool/
  target 만 갱신 (타이머 리셋 방지).

---

## [0.5.10] — 2026-04-22

### Added
- **`${CLAUDE_PLUGIN_DATA}` support (C7)**: state 파일(history, chris-log,
  dialogue-queue, c-team-pool, pending-steps, images 등) 이
  `$CLAUDE_PLUGIN_DATA` 가 설정된 경우 그쪽에 쓰고, 없으면 기존
  `~/.claude/plugins/backstage/` 로 fallback. 향후 Claude Code 가 플러그인
  업데이트 시 runtime 디렉터리를 초기화해도 히스토리가 유실되지 않음.
- **PreCompact thinking snapshot (C3)**: `hooks/pre-compact-hook.sh` 신설.
  PreCompact 이벤트 시 transcript 의 모든 thinking 블록을
  `${STATE_DIR}/thinking-snapshots/{sessionId}-{epoch}.jsonl` 로 dump.
  7일 초과 snapshot 자동 청소. 서버가 기동 시 + 5분 주기로 snapshot 을
  `thinkingCache` 에 주입 → compaction 이후 과거 thinking 이 redact 되어도
  chris-log chapter 에서 복원 가능.

---

## [0.5.9] — 2026-04-22

### Performance
- `pre-tool-hook.sh` 의 `/trigger-scan` curl 에 `--max-time 0.2
  --connect-timeout 0.2` 추가. 서버 down 시 hook 이 무한 블록되던 문제
  (최대 200ms 로 cap).
- `server.ts` `/chris-log` 응답 캐시 추가 (mtime + size 키). 동일 파일에
  대한 반복 요청이 수 ms → sub-ms.
- `stop-hook.sh` 가 debug-hook.log 5MB 초과 시 tail 2000 줄만 유지하도록
  rotate. 장시간 세션 로그 파일이 무한 성장하던 문제 해결.

### Stability
- `/refresh` 엔드포인트가 `writeFileSync(tmp) + rename` 으로 원자적 교체.
  SSE tail 중 partial write 로 이벤트 유실되던 race 제거.
- `history.jsonl` 5분마다 크기 검사해 10MB 초과 시 최신 50% 만 유지
  (newline 경계 기준, partial JSON 회피).
- dialogue-generator spawn 에 `SIGTERM → SIGKILL` 에스컬레이션 (45s +
  5s). 좀비 자식 + 큐 블로킹 방지.
- `character.js AGENT_ABSOLUTE_TTL` 단일화. 기존 45s workTimer safety
  (재진입 리셋됨) 제거. 서버 `SubagentStop` → server idle → client TTL
  3단 방어 문서화.
- `bubble.js` 렌더 bottom-up 정렬 후 겹침 감지 시 18px 씩 위로 리프트
  (최대 6회). 같은 책상열의 2명이 말풍선 동시 출력해도 겹치지 않음.
- `stop-hook.sh` 가 `pending-steps.jsonl` 을 턴 종료 시 truncate — 다음
  턴 노이즈 방지.

---

## [0.5.8] — 2026-04-22

### Fixed — Subagent character retention (4층 실패 동시 해결)
**증상**: Jake / David / Kevin 등 서브에이전트 작업이 끝나도 캐릭터가
화면에 영구 잔존.

**근본 원인**:
1. `post-tool-hook.sh` 가 `dialogue-generator` 가 아닌 일반 에이전트
   완료 시 `done` 이벤트를 발행하지 않음 → 클라이언트가 완료 신호를
   못 받음.
2. `hooks.json` 에 `SubagentStop` 훅 미등록 → Claude Code 가 제공하는
   가장 정확한 완료 시그널을 놓침.
3. 서버 30초 idle timeout fallback 은 transcript `tool_use` 스캔에
   의존. 도구 없이 끝난 에이전트, 스캔 누락, 재시작 직후 5초
   write-skip 창에 속한 완료는 영구 미발동.
4. `character.js` 에 절대 TTL 이 없어 `workTimer` 45s safety 가 매
   `handleWork` 재진입마다 리셋됨. `handleWork` 가 이미 WORKING 중인
   캐릭터에 또 Task 를 얹으면서 state timer 꼬임.

**해결**:
- `post-tool-hook.sh` 가 모든 non-dialogue-generator Task 완료 시 빈
  `msg` 의 `done` 이벤트 발행 (AI 대사 여부와 무관).
- `hooks/subagent-stop-hook.sh` 신설 + `SubagentStop` 등록. Claude Code
  가 보내는 subagent 종료 시그널을 1차 소스로 사용.
- `hooks/session-end-hook.sh` 신설 + `SessionEnd` 등록. 세션 종료 시
  pending-steps · 오래된 dialogue-queue 정리 + 잔존 에이전트 일괄
  break-room 복귀.
- `character.js.assignTask` 가 `lifetimeDeadline = ts + 120000` 설정,
  `completeTask` idempotent. 서버/클라 timeout 이 둘 다 발화해도 충돌
  없음.
- `main.js handleWork` 가 이미 WORKING 중인 캐릭터에 대해 tool/target
  필드만 갱신 (타이머 리셋 방지).

### Changed — Plugin namespace support
- `resolveCharName` · `resolveAgentSpeaker` 에 `lookupRoleName` 헬퍼
  추가. `plugin:subagent_type` 형태의 prefix 를 strip 후 `ROLE_TO_NAME`
  조회. `server.ts` · `post-tool-hook.sh` 의 하드코딩된
  `/^oh-my-claudecode:/` 패턴이 `/^[^:]+:/` 범용으로 변경.
  `vigloo:executor`, `dexus:*` 등 임의 플러그인 네임스페이스에서 온
  subagent 가 올바른 캐릭터에 매핑됨.

### Security
- `sed` 기반 템플릿 치환의 injection 경로 제거. `pre-tool-hook.sh:138`,
  `post-tool-hook.sh:347` 의 `sed 's/\${var}/$value/g'` 구문이 `value`
  에 `/ | & \n \` 가 포함되면 깨지거나 임의 명령 주입 가능. `python3`
  literal `str.replace` 로 교체.

### Stability
- **SSE infinite backoff**: 5회 실패 제한 제거. 지수 백오프 (60s cap)
  + `visibilitychange` 리스너로 탭 복귀 시 즉시 재연결. 명시적
  `session-end` 이벤트에만 overlay 표시.
- **Map LRU caps**: `thinkingCache` 에 200-entry LRU (`thinkingCacheSet`
  helper). 1M 컨텍스트 세션에서 수백 MB 누수되던 문제 해결.
- **C-team pool flock**: `get_cteam_char` 가 `flock` 으로 read→write
  임계구역 보호. 멀티 세션 동시 훅 실행 시 경합으로 할당이 유실되던
  문제 해결.

---

## Earlier

v0.5.7 이전 변경사항은 `git log --oneline` 을 참고.
