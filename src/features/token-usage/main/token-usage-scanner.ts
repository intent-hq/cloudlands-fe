/**
 * Token Usage Scanner
 *
 * Main-process service that computes per-agent and workspace token totals by
 * joining persisted agent JSONs (`{workspace}/.workspace/agents/agent-*.json`)
 * to auggie session files (`~/.augment/sessions/{acpSessionId}.json`).
 *
 * Memory/perf rules: bounded concurrency (2 workers), one parsed JSON in
 * memory per worker at a time, parsed objects discarded immediately after
 * reduction, and cache hits (matching `lastMessageId`) skip the session-file
 * read entirely. Missing/corrupt files are skipped and logged, never thrown.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '$shared/logger';
import { WorkspaceConfig } from '$shared/main/config';
import type {
  CachedAgentTokens,
  SessionTokenUsage,
  WorkspaceTokenScanResult,
} from '../token-usage-types';
import {
  addTotals,
  createEmptyTotals,
  extractAgentSessionInfo,
  mergeByModel,
  sumSessionTokenUsage,
} from '../utils/token-usage-utils';
import { getSessionFilePath } from './utils/session-paths';

const logger = new Logger('TokenUsageScanner');

/** Keep file-read/parse fan-out bounded so multi-MB session files cannot spike memory. */
const TOKEN_SCAN_CONCURRENCY = 2;

/** Injectable dependencies (overridable in tests). */
export interface TokenUsageScannerDeps {
  readFile: (filePath: string) => Promise<string>;
  readdir: (dirPath: string) => Promise<string[]>;
  getAgentsDirectory: (workspaceId: string) => string;
  getSessionFilePath: (sessionId: string) => string;
  now: () => number;
}

const defaultDeps: TokenUsageScannerDeps = {
  readFile: (filePath) => fs.readFile(filePath, 'utf-8'),
  readdir: (dirPath) => fs.readdir(dirPath),
  getAgentsDirectory: (workspaceId) => WorkspaceConfig.paths.agents(workspaceId),
  getSessionFilePath: (sessionId) => getSessionFilePath(sessionId),
  now: () => Date.now(),
};

function isAgentJsonFile(name: string): boolean {
  return name.startsWith('agent-') && name.endsWith('.json') && !name.includes('.tmp');
}

/**
 * Scan a workspace's agents and aggregate their token usage.
 *
 * Agents whose cached `lastMessageId` matches the persisted one are served
 * from `cache` without reading their session file. Agents without a session
 * id, or with missing/corrupt files, are skipped and listed in
 * `skippedAgentIds`.
 */
export async function scanWorkspaceTokenUsage(
  workspaceId: string,
  cache: Record<string, CachedAgentTokens>,
  depsOverride?: Partial<TokenUsageScannerDeps>,
): Promise<WorkspaceTokenScanResult> {
  const deps: TokenUsageScannerDeps = { ...defaultDeps, ...depsOverride };

  const perAgent: Record<string, CachedAgentTokens> = {};
  const skippedAgentIds: string[] = [];
  let scannedCount = 0;
  let cacheHits = 0;

  let agentIds: string[] = [];
  try {
    const agentsDir = deps.getAgentsDirectory(workspaceId);
    const entries = await deps.readdir(agentsDir);
    agentIds = entries.filter(isAgentJsonFile).map((name) => name.slice(0, -'.json'.length));
  } catch (error) {
    logger.warn('Failed to list agents directory', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      perAgent,
      totals: createEmptyTotals(),
      byModel: {},
      scannedCount,
      cacheHits,
      skippedAgentIds,
    };
  }

  async function processAgent(agentId: string): Promise<void> {
    let sessionId: string | null;
    let lastMessageId: string | null;
    try {
      const agentPath = path.join(deps.getAgentsDirectory(workspaceId), `${agentId}.json`);
      const info = extractAgentSessionInfo(JSON.parse(await deps.readFile(agentPath)));
      sessionId = info.sessionId;
      lastMessageId = info.lastMessageId;
    } catch (error) {
      logger.warn('Skipping agent with unreadable agent file', {
        workspaceId,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      skippedAgentIds.push(agentId);
      return;
    }

    if (!sessionId) {
      skippedAgentIds.push(agentId);
      return;
    }

    const cached = cache[agentId];
    if (cached && lastMessageId !== null && cached.lastMessageId === lastMessageId) {
      cacheHits++;
      perAgent[agentId] = cached;
      return;
    }

    let usage: SessionTokenUsage;
    try {
      usage = sumSessionTokenUsage(JSON.parse(await deps.readFile(deps.getSessionFilePath(sessionId))));
    } catch (error) {
      logger.warn('Skipping agent with unreadable session file', {
        workspaceId,
        agentId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      skippedAgentIds.push(agentId);
      return;
    }

    scannedCount++;
    perAgent[agentId] = {
      agentId,
      sessionId,
      lastMessageId,
      ...usage.totals,
      byModel: usage.byModel,
      computedAt: deps.now(),
    };
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < agentIds.length) {
      await processAgent(agentIds[nextIndex++]);
    }
  }
  const workerCount = Math.min(TOKEN_SCAN_CONCURRENCY, agentIds.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  const totals = createEmptyTotals();
  const byModel: WorkspaceTokenScanResult['byModel'] = {};
  for (const entry of Object.values(perAgent)) {
    addTotals(totals, entry);
    mergeByModel(byModel, entry.byModel);
  }
  return { perAgent, totals, byModel, scannedCount, cacheHits, skippedAgentIds };
}

