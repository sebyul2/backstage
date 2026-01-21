#!/usr/bin/env bun
/**
 * AI Dialogue Generator using Claude Haiku
 * IT 스타트업 오피스 스타일의 대화를 동적으로 생성
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const PLUGIN_DIR = process.env.BACKSTAGE_DIR || `${homedir()}/.claude/plugins/backstage`;
const CHARACTERS_FILE = `${PLUGIN_DIR}/characters.json`;
const CONFIG_FILE = `${PLUGIN_DIR}/config.json`;

interface Character {
  name: string;
  personality: string;
}

interface Characters {
  boss: { role: string; name: string; personality: string };
  agents: Record<string, Character>;
}

interface DialogueRequest {
  type: 'assign' | 'working' | 'complete' | 'fail';
  agentType: string;
  description?: string;
  result?: string;
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

// 설정 로드
function loadConfig(): { aiEnabled: boolean } {
  try {
    if (existsSync(CONFIG_FILE)) {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      return { aiEnabled: config.aiEnabled !== false };
    }
  } catch {}
  return { aiEnabled: true };
}

// Haiku로 대화 생성
async function generateDialogue(request: DialogueRequest): Promise<{ boss: string; agent: string } | null> {
  const characters = loadCharacters();
  const config = loadConfig();

  if (!characters || !config.aiEnabled) {
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  const agentChar = characters.agents[request.agentType];
  const agentName = agentChar?.name || request.agentType;
  const agentPersonality = agentChar?.personality || '팀원';
  const bossName = characters.boss.name;
  const bossPersonality = characters.boss.personality;

  let prompt = '';

  switch (request.type) {
    case 'assign':
      prompt = `IT 스타트업 오피스 대화를 생성해줘.

상황: ${bossName}(${bossPersonality})이 ${agentName}(${agentPersonality})에게 작업을 할당함
작업 내용: ${request.description || '작업'}

규칙:
- 한국어 사용, 반말/비격식체
- 슬랙/카톡 스타일 (ㅋㅋ, ㅇㅋ, ㄱㄱ 등 자연스럽게)
- 각 대사 15자 이내로 짧게
- 실제 개발자들이 하는 대화처럼 자연스럽게

JSON 형식으로만 응답:
{"boss": "${bossName}의 대사", "agent": "${agentName}의 대사"}`;
      break;

    case 'working':
      prompt = `IT 스타트업 오피스 대화를 생성해줘.

상황: ${agentName}(${agentPersonality})이 작업 중
작업 내용: ${request.description || '작업'}

규칙:
- 한국어 사용, 반말/비격식체
- 작업 중인 상태를 표현
- 15자 이내로 짧게

JSON 형식으로만 응답:
{"agent": "${agentName}의 대사"}`;
      break;

    case 'complete':
      prompt = `IT 스타트업 오피스 대화를 생성해줘.

상황: ${agentName}(${agentPersonality})이 작업 완료하고 ${bossName}에게 보고
작업 내용: ${request.description || '작업'}
결과 요약: ${request.result || '완료'}

규칙:
- 한국어 사용, 반말/비격식체
- 슬랙/카톡 스타일로 자연스럽게
- 각 대사 15자 이내로 짧게
- 결과를 간단히 언급

JSON 형식으로만 응답:
{"agent": "${agentName}의 완료 보고", "boss": "${bossName}의 반응"}`;
      break;

    case 'fail':
      prompt = `IT 스타트업 오피스 대화를 생성해줘.

상황: ${agentName}(${agentPersonality})이 작업 실패/어려움을 ${bossName}에게 보고
작업 내용: ${request.description || '작업'}

규칙:
- 한국어 사용, 반말/비격식체
- 실패했지만 너무 심각하지 않게
- 각 대사 15자 이내로 짧게

JSON 형식으로만 응답:
{"agent": "${agentName}의 보고", "boss": "${bossName}의 반응"}`;
      break;
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // JSON 파싱
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // AI 실패 시 null 반환 (폴백으로 기본 대사 사용)
  }

  return null;
}

// CLI 인터페이스
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: dialogue-generator.ts <type> <agentType> [description] [result]');
    process.exit(1);
  }

  const [type, agentType, description, result] = args;

  const dialogue = await generateDialogue({
    type: type as DialogueRequest['type'],
    agentType,
    description,
    result,
  });

  if (dialogue) {
    console.log(JSON.stringify(dialogue));
  } else {
    // 폴백: 빈 JSON 반환
    console.log('{}');
  }
}

// 모듈로도 사용 가능
export { generateDialogue, DialogueRequest };

main().catch(() => process.exit(1));
