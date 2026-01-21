#!/usr/bin/env bun
/**
 * Agent Backstage Statusline
 * transcript를 직접 파싱해서 실시간 오피스 대화 표시
 * - 작업 유형 인식
 * - 결과 반영한 자연스러운 대화
 */

import { readFileSync, existsSync, createReadStream } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { generateDialogue, DialogueRequest } from './dialogue-generator';

const PLUGIN_DIR = process.env.BACKSTAGE_DIR || `${homedir()}/.claude/plugins/backstage`;
const CONFIG_FILE = `${PLUGIN_DIR}/config.json`;
const CHARACTERS_FILE = `${PLUGIN_DIR}/characters.json`;

interface StdinData {
  transcript_path?: string;
  cwd?: string;
}

type TaskType = 'search' | 'analyze' | 'modify' | 'create' | 'delete' | 'test' | 'general';

interface AgentEntry {
  id: string;
  type: string;
  description?: string;
  status: 'running' | 'completed';
  result?: string;  // tool_result 요약
  taskType: TaskType;
  timestamp: number;  // 시작 시간 (ms)
}

interface Character {
  name: string;
  personality: string;
  working_lines?: string[];
  success_lines?: string[];
  fail_lines?: string[];
}

interface Characters {
  boss: { role: string; name: string; personality: string };
  agents: Record<string, Character>;
  boss_reactions: { success: string[]; fail: string[]; assign: string[] };
}

// 설정 로드
function loadConfig(): { displayLines: number; enabled: boolean } {
  try {
    if (existsSync(CONFIG_FILE)) {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      return {
        displayLines: config.displayLines || 8,
        enabled: config.enabled !== false
      };
    }
  } catch {}
  return { displayLines: 8, enabled: true };
}

// 캐릭터 로드
function loadCharacters(): Characters | null {
  try {
    if (existsSync(CHARACTERS_FILE)) {
      return JSON.parse(readFileSync(CHARACTERS_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

const config = loadConfig();
const characters = loadCharacters();

// 색상 코드
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';

// claude-hud 실행
function runClaudeHud(stdin: string): string {
  const hudPath = `${homedir()}/.claude/plugins/cache/claude-hud/claude-hud`;

  try {
    const latestVersion = execSync(`ls -td ${hudPath}/*/ 2>/dev/null | head -1`, { encoding: 'utf-8' }).trim();

    if (!latestVersion) {
      return '';
    }

    const result = execSync(
      `echo '${stdin.replace(/'/g, "\\'")}' | bun "${latestVersion}src/index.ts"`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    return result;
  } catch {
    return '';
  }
}

// 작업 유형 추론
function inferTaskType(description: string, agentType: string): TaskType {
  const desc = description.toLowerCase();

  // 키워드 기반 분류
  if (/찾|검색|조회|확인|읽|어디|뭐가|있는지|알려|목록|리스트/.test(desc)) return 'search';
  if (/분석|왜|원인|디버그|문제|에러|버그|이유/.test(desc)) return 'analyze';
  if (/수정|변경|업데이트|고치|fix|edit|change/.test(desc)) return 'modify';
  if (/생성|만들|추가|작성|new|create|add/.test(desc)) return 'create';
  if (/삭제|제거|remove|delete/.test(desc)) return 'delete';
  if (/테스트|test|검증|확인/.test(desc)) return 'test';

  // agent 유형 기반 기본값
  if (['explore', 'explore-medium', 'librarian', 'librarian-low'].includes(agentType)) return 'search';
  if (['oracle', 'oracle-medium', 'oracle-low', 'metis'].includes(agentType)) return 'analyze';
  if (['sisyphus-junior', 'sisyphus-junior-low', 'sisyphus-junior-high'].includes(agentType)) return 'modify';
  if (['frontend-engineer', 'frontend-engineer-low', 'frontend-engineer-high'].includes(agentType)) return 'create';
  if (['qa-tester'].includes(agentType)) return 'test';
  if (['momus'].includes(agentType)) return 'analyze';
  if (['document-writer'].includes(agentType)) return 'create';

  return 'general';
}

// 결과 요약 추출 (tool_result에서 핵심만)
function summarizeResult(result: string): string {
  if (!result) return '';

  // 마크다운 테이블/리스트에서 핵심 추출
  const lines = result.split('\n').filter(l => l.trim());

  // 첫 번째 의미있는 내용 찾기
  for (const line of lines.slice(0, 10)) {
    // 헤더나 구분선 스킵
    if (/^[#\-=|]/.test(line.trim()) && !/^\d+\./.test(line.trim())) continue;
    // agentId 라인 스킵
    if (line.includes('agentId:')) continue;

    const cleaned = line.replace(/[*`#]/g, '').trim();
    if (cleaned.length > 10 && cleaned.length < 100) {
      return cleaned.length > 50 ? cleaned.slice(0, 50) + '...' : cleaned;
    }
  }

  return '';
}

// transcript 파싱
async function parseTranscript(transcriptPath: string): Promise<AgentEntry[]> {
  const agents: Map<string, AgentEntry> = new Map();

  if (!transcriptPath || !existsSync(transcriptPath)) {
    return [];
  }

  try {
    const fileStream = createReadStream(transcriptPath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);
        const content = entry.message?.content;
        if (!content || !Array.isArray(content)) continue;

        // timestamp 추출
        const entryTimestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

        for (const block of content) {
          // Task 도구 호출 감지
          if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
            const input = block.input as Record<string, unknown>;
            const agentType = (input?.subagent_type as string) ?? 'unknown';
            const description = (input?.description as string) ?? '';

            agents.set(block.id, {
              id: block.id,
              type: agentType,
              description,
              status: 'running',
              taskType: inferTaskType(description, agentType),
              timestamp: entryTimestamp,
            });
          }

          // Task 완료 감지 + 결과 저장
          if (block.type === 'tool_result' && block.tool_use_id) {
            const agent = agents.get(block.tool_use_id);
            if (agent) {
              agent.status = 'completed';
              // content에서 텍스트 추출
              if (Array.isArray(block.content)) {
                const textContent = block.content.find((c: any) => c.type === 'text');
                if (textContent?.text) {
                  agent.result = summarizeResult(textContent.text);
                }
              } else if (typeof block.content === 'string') {
                agent.result = summarizeResult(block.content);
              }
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    return [];
  }

  return Array.from(agents.values()).slice(-10);
}

// 시드 기반 선택
function pick<T>(arr: T[], seed: string): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return arr[Math.abs(hash) % arr.length];
}

// 작업 유형별 할당 멘트 (유머러스하게)
const assignByTaskType: Record<TaskType, string[]> = {
  search: ['야 이거 어딨어', '찾아봐 급함 ㅋㅋ', '어디갔지 이거', '헬프 못찾겠어'],
  analyze: ['이거 왜이래 봐봐', '뭔가 이상한데?', '분석 좀 ㄱㄱ', '원인이 뭐야 대체'],
  modify: ['이거 좀 손봐줘', '고쳐야되는데 ㅠ', '수정 ㄱ', '변경점 있어'],
  create: ['새로 만들어야해', '하나 뚝딱해줘', '추가 ㄱㄱ', '이거 없어서 만들어야됨'],
  delete: ['이거 날려줘', '정리 좀 ㅋㅋ', '삭제 ㄱ', '치워줘 이거'],
  test: ['테스트 ㄱㄱ', '돌려봐 한번', '검증 좀', '확인해봐 제발'],
  general: ['이거 좀', '부탁 ㅋㅋ', '도와줘', '처리 ㄱ'],
};

// 작업 유형별 완료 반응 (유머러스하게)
const bossReactionByTaskType: Record<TaskType, string[]> = {
  search: ['오 ㅋㅋ 찾았네', '거기 있었구나 ㅋ', 'ㄳㄳ', 'ㅇㅋ 고마워'],
  analyze: ['아~ 그래서', '오호 이해됐어', 'ㅇㅋㅇㅋ', '그렇구나 ㅋㅋ'],
  modify: ['PR ㄱㄱ', '리뷰 달아놓을게', 'ㅇㅋ 머지하자 ㅋ', 'ㄱㅅㄱㅅ'],
  create: ['오 괜찮은데? ㅋㅋ', '굳굳', 'ㅇㅋ 좋아', 'ㄴㅇㅅ'],
  delete: ['깔끔 ㅋㅋ', '정리 완 ㄱㅅ', 'ㅇㅋㅇㅋ', 'ㅊㅊ'],
  test: ['통과? ㅋㅋ', '결과 어때', 'ㅇㅋ 굳', '커버리지는? ㅋ'],
  general: ['ㅇㅋ', 'ㄱㅅㄱㅅ', '굳 ㅋㅋ', 'ㅊㅊ'],
};

// 에이전트 대화 포맷팅 (전체 대화 흐름)
async function formatAgentLines(agent: AgentEntry, chars: Characters): Promise<string[]> {
  const bossName = chars.boss.name;
  const agentChar = chars.agents[agent.type];
  const lines: string[] = [];

  const agentName = agentChar?.name || agent.type;
  const role = agent.type;
  const bossRole = chars.boss.role;

  // description 축약
  const shortDesc = agent.description
    ? (agent.description.length > 30 ? agent.description.slice(0, 30) + '...' : agent.description)
    : '';

  if (agent.status === 'running') {
    // AI 대화 생성 시도
    const aiDialogue = await generateDialogue({
      type: 'assign',
      agentType: agent.type,
      description: agent.description,
    });

    if (aiDialogue?.boss && aiDialogue?.agent) {
      // AI 생성 성공 - assign + working
      lines.push(`${CYAN}${bossName} (${bossRole})${RESET} → ${YELLOW}${agentName} (${role})${RESET}: "${aiDialogue.boss}" ${DIM}(${shortDesc})${RESET}`);
      lines.push(`  ${DIM}└${RESET} ${GREEN}${agentName}${RESET}: ${aiDialogue.agent}`);
    } else {
      // AI 실패 - 기존 폴백 대사
      const assignOptions = assignByTaskType[agent.taskType] || assignByTaskType.general;
      const assignLine = pick(assignOptions, agent.id + 'assign');
      lines.push(`${CYAN}${bossName} (${bossRole})${RESET} → ${YELLOW}${agentName} (${role})${RESET}: "${assignLine}" ${DIM}(${shortDesc})${RESET}`);

      const workingLine = agentChar?.working_lines
        ? pick(agentChar.working_lines, agent.id + 'work')
        : '작업 중...';
      lines.push(`  ${DIM}└${RESET} ${GREEN}${agentName}${RESET}: ${workingLine}`);
    }
  } else {
    // AI 대화 생성 시도 (완료 상태)
    const aiDialogue = await generateDialogue({
      type: 'complete',
      agentType: agent.type,
      description: agent.description,
      result: agent.result,
    });

    if (aiDialogue?.boss && aiDialogue?.agent) {
      // AI 생성 성공 - assign (폴백) + complete + boss reaction
      const assignOptions = assignByTaskType[agent.taskType] || assignByTaskType.general;
      const assignLine = pick(assignOptions, agent.id + 'assign');
      lines.push(`${CYAN}${bossName} (${bossRole})${RESET} → ${YELLOW}${agentName} (${role})${RESET}: "${assignLine}" ${DIM}(${shortDesc})${RESET}`);

      lines.push(`  ${DIM}└${RESET} ${GREEN}${agentName} (${role})${RESET}: ${aiDialogue.agent}`);
      lines.push(`  ${DIM}└${RESET} ${CYAN}${bossName} (${bossRole})${RESET}: ${aiDialogue.boss}`);
    } else {
      // AI 실패 - 기존 폴백 대사
      const assignOptions = assignByTaskType[agent.taskType] || assignByTaskType.general;
      const assignLine = pick(assignOptions, agent.id + 'assign');
      lines.push(`${CYAN}${bossName} (${bossRole})${RESET} → ${YELLOW}${agentName} (${role})${RESET}: "${assignLine}" ${DIM}(${shortDesc})${RESET}`);

      let completeLine: string;
      if (agent.result) {
        completeLine = `"${agent.result}"`;
      } else {
        completeLine = agentChar?.success_lines
          ? pick(agentChar.success_lines, agent.id + 'success')
          : '완료!';
      }
      lines.push(`  ${DIM}└${RESET} ${GREEN}${agentName} (${role})${RESET}: ${completeLine}`);

      const reactionOptions = bossReactionByTaskType[agent.taskType] || bossReactionByTaskType.general;
      const reaction = pick(reactionOptions, agent.id + 'reaction');
      lines.push(`  ${DIM}└${RESET} ${CYAN}${bossName} (${bossRole})${RESET}: ${reaction}`);
    }
  }

  return lines;
}

// 메인
async function main() {
  // stdin 읽기
  let stdinRaw = '';
  for await (const chunk of Bun.stdin.stream()) {
    stdinRaw += new TextDecoder().decode(chunk);
  }

  let stdinData: StdinData = {};
  try {
    stdinData = JSON.parse(stdinRaw);
  } catch {}

  // claude-hud 실행
  const hudOutput = runClaudeHud(stdinRaw);
  if (hudOutput) {
    process.stdout.write(hudOutput);
  }

  // Backstage 비활성화 시 표시 안 함
  if (!config.enabled || !characters) {
    return;
  }

  // transcript 파싱
  const agents = await parseTranscript(stdinData.transcript_path || '');

  // 헤더
  console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
  console.log(`${MAGENTA}${BOLD}Backstage${RESET}`);

  // 최근 5분 이내의 agent만 필터링
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const recentAgents = agents
    .filter(a => a.timestamp > fiveMinutesAgo)
    .sort((a, b) => a.timestamp - b.timestamp);  // 시간순 정렬

  if (recentAgents.length === 0) {
    console.log(`${DIM}(조용한 오피스...)${RESET}`);
    return;
  }

  // running 에이전트 + 최근 완료된 에이전트 (최대 2개)
  const runningAgents = recentAgents.filter(a => a.status === 'running');
  const completedAgents = recentAgents.filter(a => a.status === 'completed').slice(-2);

  // 모든 대화 라인 수집
  const allLines: string[] = [];
  for (const agent of [...completedAgents, ...runningAgents]) {
    const lines = await formatAgentLines(agent, characters);
    allLines.push(...lines);
  }

  // displayLines 만큼만 표시 (최근 것 우선)
  const linesToShow = allLines.slice(-config.displayLines);
  for (const line of linesToShow) {
    console.log(line);
  }
}

main().catch(console.error);
