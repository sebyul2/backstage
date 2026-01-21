#!/usr/bin/env bun
/**
 * Agent Backstage Statusline
 * claude-hud 출력 + 오피스 대화 표시
 */

import { readFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';

const PLUGIN_DIR = process.env.BACKSTAGE_DIR || `${homedir()}/.claude/plugins/backstage`;
const HISTORY_FILE = `${PLUGIN_DIR}/history.log`;

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

// 최근 오피스 대화 읽기
function getRecentLines(count: number = 4): string[] {
  if (!existsSync(HISTORY_FILE)) {
    return [];
  }

  try {
    const stat = statSync(HISTORY_FILE);
    const now = Date.now();
    const fileAge = now - stat.mtimeMs;

    // 30초 이상 지난 로그는 표시 안 함
    if (fileAge > 30000) {
      return [];
    }

    const content = readFileSync(HISTORY_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);

    // 최근 N개만
    return lines.slice(-count);
  } catch {
    return [];
  }
}

// 라인 포맷팅
function formatLine(line: string): string {
  // [HH:MM:SS] Name → Target: "message" 형식 파싱
  const match = line.match(/\[([^\]]+)\]\s*(.+)/);
  if (!match) return line;

  const [, time, content] = match;

  // Chris → Agent 형식
  if (content.includes('→')) {
    const [from, rest] = content.split('→').map(s => s.trim());
    return `${DIM}${time}${RESET} ${CYAN}${from}${RESET} → ${YELLOW}${rest}${RESET}`;
  }

  // Agent: "response" 형식
  const colonIdx = content.indexOf(':');
  if (colonIdx > 0) {
    const name = content.substring(0, colonIdx).trim();
    const message = content.substring(colonIdx + 1).trim();
    return `${DIM}${time}${RESET} ${GREEN}${name}${RESET}: ${message}`;
  }

  return `${DIM}${time}${RESET} ${content}`;
}

// 메인
async function main() {
  // stdin 읽기
  let stdin = '';
  for await (const chunk of Bun.stdin.stream()) {
    stdin += new TextDecoder().decode(chunk);
  }

  // claude-hud 실행
  const hudOutput = runClaudeHud(stdin);
  if (hudOutput) {
    process.stdout.write(hudOutput);
  }

  // 오피스 대화 표시
  const recentLines = getRecentLines(3);
  if (recentLines.length > 0) {
    console.log(`${DIM}${'─'.repeat(40)}${RESET}`);
    console.log(`${MAGENTA}${BOLD}Backstage${RESET}`);
    for (const line of recentLines) {
      console.log(formatLine(line));
    }
  }
}

main().catch(console.error);
