#!/usr/bin/env bun
/**
 * Statusline Wrapper - claude-hud 표시 + 서브에이전트 도구 사용 감지 → history.jsonl 기록
 * backstage 대화 렌더링은 웹 뷰어(viewer/)로 이전됨
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const HISTORY_FILE = `${homedir()}/.claude/plugins/backstage/history.jsonl`;

// Agent name mapping
const AGENT_NAMES: Record<string, string> = {
  'explore': 'Jake',
  'explore-medium': 'Jake',
  'oracle': 'David',
  'oracle-medium': 'David',
  'oracle-low': 'Danny',
  'sisyphus-junior': 'Kevin',
  'sisyphus-junior-low': 'Ken',
  'sisyphus-junior-high': 'Karl',
  'frontend-engineer': 'Sophie',
  'document-writer': 'Emily',
  'librarian': 'Michael',
  'prometheus': 'Alex',
  'momus': 'Rachel',
  'metis': 'Tom',
  'multimodal-looker': 'Luna',
  'qa-tester': 'Sam',
};

// stdin 읽기
let stdinData = '';
for await (const chunk of Bun.stdin.stream()) {
  stdinData += new TextDecoder().decode(chunk);
}

// claude-hud 실행
async function runClaudeHud(): Promise<string> {
  return new Promise((resolve) => {
    const hudDir = `${homedir()}/.claude/plugins/cache/claude-hud/claude-hud`;

    let latestVersion = '';
    try {
      const dirs = require('fs').readdirSync(hudDir);
      latestVersion = dirs.sort().reverse()[0];
    } catch {
      resolve('');
      return;
    }

    const hudPath = `${hudDir}/${latestVersion}/src/index.ts`;
    if (!existsSync(hudPath)) {
      resolve('');
      return;
    }

    const proc = spawn('bun', [hudPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stdin.write(stdinData);
    proc.stdin.end();

    proc.on('close', () => resolve(output));
    proc.on('error', () => resolve(''));

    setTimeout(() => {
      proc.kill();
      resolve(output);
    }, 2000);
  });
}

// transcript에서 서브에이전트 도구 사용 감지
async function detectAgentToolUse(): Promise<void> {
  try {
    const data = JSON.parse(stdinData);
    const transcriptPath = data.transcript_path;

    if (!transcriptPath || !existsSync(transcriptPath)) return;

    const PLUGIN_DIR = `${homedir()}/.claude/plugins/backstage`;
    const TRANSCRIPT_OFFSET_FILE = `${PLUGIN_DIR}/last-transcript-offset.txt`;
    const RECORDED_TOOLS_FILE = `${PLUGIN_DIR}/recorded-tools.json`;
    const AGENT_MAP_FILE = `${PLUGIN_DIR}/agent-type-map.json`;

    // Read previous offset
    let fromOffset = 0;
    try {
      if (existsSync(TRANSCRIPT_OFFSET_FILE)) {
        fromOffset = parseInt(readFileSync(TRANSCRIPT_OFFSET_FILE, 'utf-8').trim()) || 0;
      }
    } catch {}

    // Read ONLY from offset forward (avoid reading entire multi-MB transcript)
    const { openSync, readSync, closeSync, statSync } = require('fs');
    const stat = statSync(transcriptPath);
    const fileSize = stat.size;

    // Handle truncation
    if (fromOffset > fileSize) fromOffset = 0;

    // Nothing new
    if (fromOffset >= fileSize) return;

    // Read only the new bytes
    const bufSize = fileSize - fromOffset;
    // Safety: cap at 512KB to prevent statusline slowdown
    if (bufSize > 512 * 1024) {
      // Skip to near-end to avoid processing huge backlog
      fromOffset = fileSize - 512 * 1024;
    }
    const buf = Buffer.alloc(fileSize - fromOffset);
    const fd = openSync(transcriptPath, 'r');
    try {
      readSync(fd, buf, 0, buf.length, fromOffset);
    } finally {
      closeSync(fd);
    }

    // Save new offset
    writeFileSync(TRANSCRIPT_OFFSET_FILE, String(fileSize));

    const newContent = buf.toString('utf-8');
    if (!newContent.trim()) return;

    const lines = newContent.trim().split('\n');

    // Load recorded tool IDs (to avoid duplicates)
    let recordedIds: string[] = [];
    try {
      if (existsSync(RECORDED_TOOLS_FILE)) {
        recordedIds = JSON.parse(readFileSync(RECORDED_TOOLS_FILE, 'utf-8'));
      }
    } catch {}
    const recordedSet = new Set(recordedIds);

    // Load persistent agent type map (Task id → agent type)
    let agentTypeMap: Record<string, string> = {};
    try {
      if (existsSync(AGENT_MAP_FILE)) {
        agentTypeMap = JSON.parse(readFileSync(AGENT_MAP_FILE, 'utf-8'));
      }
    } catch {}

    // Update agentTypeMap from new lines only (not full transcript)
    let mapUpdated = false;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.message?.content) {
          for (const c of entry.message.content) {
            if (c.type === 'tool_use' && c.name === 'Task' && c.input?.subagent_type) {
              agentTypeMap[c.id] = c.input.subagent_type;
              mapUpdated = true;
            }
          }
        }
      } catch {}
    }

    // Persist agentTypeMap (keep last 100 entries to prevent unbounded growth)
    if (mapUpdated) {
      const keys = Object.keys(agentTypeMap);
      if (keys.length > 100) {
        const trimmed: Record<string, string> = {};
        for (const k of keys.slice(-100)) trimmed[k] = agentTypeMap[k];
        agentTypeMap = trimmed;
      }
      try { writeFileSync(AGENT_MAP_FILE, JSON.stringify(agentTypeMap)); } catch {}
    }

    // Collect ALL new agent tool uses
    const newTools: Array<{ agentType: string; agentName: string; tool: string; target: string; id: string }> = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === 'progress' && entry.data?.type === 'agent_progress') {
          const msg = entry.data?.message?.message;
          if (!msg?.content) continue;

          for (const block of msg.content) {
            if (block.type !== 'tool_use' || !block.name) continue;

            const toolName = block.name;
            if (!['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'].includes(toolName)) continue;

            const input = block.input || {};
            const target = input.file_path || input.pattern || input.command || '';
            const shortTarget = target.split('/').pop()?.slice(0, 30) || target.slice(0, 30);
            const agentId = entry.data?.agentId || 'unknown';

            // Find agent type from parentToolUseID
            let agentType = 'agent';
            if (entry.parentToolUseID && agentTypeMap[entry.parentToolUseID]) {
              agentType = agentTypeMap[entry.parentToolUseID];
            }

            // Skip dialogue-generator
            if (agentType === 'dialogue-generator') continue;

            const toolId = `${agentId}:${toolName}:${shortTarget}`;
            if (recordedSet.has(toolId)) continue;

            recordedSet.add(toolId);
            const agentName = AGENT_NAMES[agentType] || 'Agent';
            newTools.push({ agentType, agentName, tool: toolName, target: shortTarget, id: toolId });
          }
        }
      } catch {}
    }

    // Record all new tools to history (cap at 10 per poll to avoid flooding)
    if (newTools.length > 0) {
      const { appendFileSync } = require('fs');
      const TOOL_INFO: Record<string, { emoji: string; verb: string }> = {
        'Read': { emoji: '📖', verb: '읽는 중' },
        'Glob': { emoji: '🔍', verb: '찾는 중' },
        'Grep': { emoji: '🔎', verb: '검색 중' },
        'Edit': { emoji: '✏️', verb: '수정 중' },
        'Write': { emoji: '📝', verb: '작성 중' },
        'Bash': { emoji: '💻', verb: '실행 중' }
      };

      // Cap entries per poll — only write latest per agent to avoid flooding
      const latestPerAgent: Map<string, typeof newTools[0]> = new Map();
      for (const tool of newTools) {
        latestPerAgent.set(tool.agentName, tool);
      }

      for (const tool of latestPerAgent.values()) {
        const info = TOOL_INFO[tool.tool] || { emoji: '🔧', verb: '작업 중' };
        const ts = new Date().toTimeString().slice(0, 8);
        const epoch = Math.floor(Date.now() / 1000);
        const msg = `${info.emoji} ${tool.target || tool.tool} ${info.verb}`;

        const entry = JSON.stringify({
          ts, epoch, type: 'work',
          speaker: tool.agentName,
          role: tool.agentType,
          msg
        });

        try { appendFileSync(HISTORY_FILE, entry + '\n'); } catch {}
      }

      // Save recorded IDs (keep last 500 to prevent unbounded growth)
      const idsToSave = [...recordedSet].slice(-500);
      try { writeFileSync(RECORDED_TOOLS_FILE, JSON.stringify(idsToSave)); } catch {}
    }
  } catch {}
}

// 메인
async function main() {
  const [hudOutput] = await Promise.all([
    runClaudeHud(),
    detectAgentToolUse(),
  ]);

  if (hudOutput.trim()) {
    console.log(hudOutput.trimEnd());
  }
}

main().catch(() => {});
