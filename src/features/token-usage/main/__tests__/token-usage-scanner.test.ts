// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('$shared/logger', () => ({
  Logger: vi.fn(function MockLogger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }),
}));

vi.mock('$shared/main/config', () => ({
  WorkspaceConfig: { paths: { agents: vi.fn() } },
}));

import { scanWorkspaceTokenUsage } from '../token-usage-scanner';
import type { CachedAgentTokens } from '../../token-usage-types';

const AGENTS_DIR = '/ws/.workspace/agents';
const sessionPath = (sid: string) => `/sessions/${sid}.json`;

function agentJson(sessionId: string | null, lastMessageId: string | null): string {
  return JSON.stringify({
    acpSessionId: sessionId ?? undefined,
    messages: lastMessageId ? [{ id: 'msg-0' }, { id: lastMessageId }] : [],
  });
}

function sessionJson(
  input: number,
  output: number,
  cacheRead = 0,
  cacheCreation = 0,
  model: string | null = 'model-x',
): string {
  return JSON.stringify({
    chatHistory: [
      {
        exchange: {
          response_nodes: [
            { type: 0, token_usage: null },
            {
              type: 9,
              billing_metadata: {
                transaction_id: 'txn-1',
                credits_consumed: 0,
                cost_usd: '0.5',
                usage_unit: 2,
                effective_model_name: model,
              },
            },
            {
              type: 10,
              token_usage: {
                input_tokens: input,
                output_tokens: output,
                cache_read_input_tokens: cacheRead,
                cache_creation_input_tokens: cacheCreation,
              },
            },
          ],
        },
      },
    ],
  });
}

function makeDeps(files: Record<string, string>, dirEntries: string[]) {
  const readFile = vi.fn(async (filePath: string) => {
    if (filePath in files) return files[filePath];
    throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: 'ENOENT' });
  });
  return {
    readFile,
    readdir: vi.fn(async () => dirEntries),
    getAgentsDirectory: vi.fn(() => AGENTS_DIR),
    getSessionFilePath: sessionPath,
    now: () => 1000,
  };
}

function cachedEntry(overrides: Partial<CachedAgentTokens> = {}): CachedAgentTokens {
  return {
    agentId: 'agent-a',
    sessionId: 'sid-a',
    lastMessageId: 'msg-a',
    inputTokens: 5,
    outputTokens: 6,
    cacheReadTokens: 7,
    cacheCreationTokens: 8,
    byModel: {
      'model-cached': { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheCreationTokens: 8 },
    },
    computedAt: 500,
    ...overrides,
  };
}

describe('scanWorkspaceTokenUsage', () => {
  it('scans agents, sums tokens and per-model breakdown in one pass, and aggregates workspace totals', async () => {
    const deps = makeDeps(
      {
        [`${AGENTS_DIR}/agent-a.json`]: agentJson('sid-a', 'msg-a'),
        [`${AGENTS_DIR}/agent-b.json`]: agentJson('sid-b', 'msg-b'),
        [sessionPath('sid-a')]: sessionJson(1, 2, 3, 4, 'model-x'),
        [sessionPath('sid-b')]: sessionJson(10, 20, 30, 40, 'model-y'),
      },
      ['agent-a.json', 'agent-b.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', {}, deps);
    expect(result.scannedCount).toBe(2);
    expect(result.cacheHits).toBe(0);
    expect(result.skippedAgentIds).toEqual([]);
    expect(result.perAgent['agent-a']).toEqual({
      agentId: 'agent-a',
      sessionId: 'sid-a',
      lastMessageId: 'msg-a',
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      byModel: {
        'model-x': { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      },
      computedAt: 1000,
    });
    expect(result.totals).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
    });
    expect(result.byModel).toEqual({
      'model-x': { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      'model-y': {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
      },
    });
    // Single pass: each session file is read exactly once.
    expect(
      deps.readFile.mock.calls.filter(([p]) => p === sessionPath('sid-a')).length,
    ).toBe(1);
    expect(
      deps.readFile.mock.calls.filter(([p]) => p === sessionPath('sid-b')).length,
    ).toBe(1);
  });

  it('merges per-model totals across agents using the same model', async () => {
    const deps = makeDeps(
      {
        [`${AGENTS_DIR}/agent-a.json`]: agentJson('sid-a', 'msg-a'),
        [`${AGENTS_DIR}/agent-b.json`]: agentJson('sid-b', 'msg-b'),
        [sessionPath('sid-a')]: sessionJson(1, 2, 3, 4, 'model-shared'),
        [sessionPath('sid-b')]: sessionJson(10, 20, 30, 40, 'model-shared'),
      },
      ['agent-a.json', 'agent-b.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', {}, deps);
    expect(result.byModel).toEqual({
      'model-shared': {
        inputTokens: 11,
        outputTokens: 22,
        cacheReadTokens: 33,
        cacheCreationTokens: 44,
      },
    });
    // Workspace byModel sums equal workspace totals.
    expect(result.byModel['model-shared']).toEqual(result.totals);
  });

  it('includes cached entries (with their byModel) in the workspace per-model merge', async () => {
    const cached = cachedEntry();
    const deps = makeDeps(
      {
        [`${AGENTS_DIR}/agent-a.json`]: agentJson('sid-a', 'msg-a'),
        [`${AGENTS_DIR}/agent-b.json`]: agentJson('sid-b', 'msg-b'),
        [sessionPath('sid-b')]: sessionJson(10, 20, 0, 0, 'model-y'),
      },
      ['agent-a.json', 'agent-b.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', { 'agent-a': cached }, deps);
    expect(result.cacheHits).toBe(1);
    expect(result.byModel).toEqual({
      'model-cached': {
        inputTokens: 5,
        outputTokens: 6,
        cacheReadTokens: 7,
        cacheCreationTokens: 8,
      },
      'model-y': { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 },
    });
  });

  it('ignores non-agent and tmp/backup/checksum directory entries', async () => {
    const deps = makeDeps(
      {
        [`${AGENTS_DIR}/agent-a.json`]: agentJson('sid-a', 'msg-a'),
        [sessionPath('sid-a')]: sessionJson(1, 1),
      },
      [
        'agent-a.json',
        'agent-a.json.checksum',
        'agent-a.json.backups',
        'agent-b.json.tmp',
        'notes.txt',
      ],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', {}, deps);
    expect(Object.keys(result.perAgent)).toEqual(['agent-a']);
    expect(result.scannedCount).toBe(1);
  });

  it('serves cache hits without reading the session file', async () => {
    const cached = cachedEntry();
    const deps = makeDeps(
      {
        [`${AGENTS_DIR}/agent-a.json`]: agentJson('sid-a', 'msg-a'),
        [sessionPath('sid-a')]: sessionJson(100, 100),
      },
      ['agent-a.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', { 'agent-a': cached }, deps);
    expect(result.cacheHits).toBe(1);
    expect(result.scannedCount).toBe(0);
    expect(result.perAgent['agent-a']).toBe(cached);
    expect(deps.readFile).toHaveBeenCalledTimes(1);
    expect(deps.readFile).toHaveBeenCalledWith(`${AGENTS_DIR}/agent-a.json`);
    expect(deps.readFile).not.toHaveBeenCalledWith(sessionPath('sid-a'));
  });

  it('recomputes when lastMessageId changed', async () => {
    const cached = cachedEntry({ lastMessageId: 'msg-old' });
    const deps = makeDeps(
      {
        [`${AGENTS_DIR}/agent-a.json`]: agentJson('sid-a', 'msg-new'),
        [sessionPath('sid-a')]: sessionJson(100, 200),
      },
      ['agent-a.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', { 'agent-a': cached }, deps);
    expect(result.cacheHits).toBe(0);
    expect(result.scannedCount).toBe(1);
    expect(deps.readFile).toHaveBeenCalledWith(sessionPath('sid-a'));
    expect(result.perAgent['agent-a']).toMatchObject({
      lastMessageId: 'msg-new',
      inputTokens: 100,
      outputTokens: 200,
      computedAt: 1000,
    });
  });

  it('skips agents without a session id', async () => {
    const deps = makeDeps(
      { [`${AGENTS_DIR}/agent-a.json`]: agentJson(null, 'msg-a') },
      ['agent-a.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', {}, deps);
    expect(result.skippedAgentIds).toEqual(['agent-a']);
    expect(result.perAgent).toEqual({});
    expect(result.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(result.byModel).toEqual({});
  });

  it('skips agents whose session file is missing, without throwing', async () => {
    const deps = makeDeps(
      { [`${AGENTS_DIR}/agent-a.json`]: agentJson('sid-missing', 'msg-a') },
      ['agent-a.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', {}, deps);
    expect(result.skippedAgentIds).toEqual(['agent-a']);
    expect(result.scannedCount).toBe(0);
  });

  it('skips corrupt agent and session JSON, without throwing', async () => {
    const deps = makeDeps(
      {
        [`${AGENTS_DIR}/agent-a.json`]: '{not json',
        [`${AGENTS_DIR}/agent-b.json`]: agentJson('sid-b', 'msg-b'),
        [sessionPath('sid-b')]: '<<corrupt>>',
        [`${AGENTS_DIR}/agent-c.json`]: agentJson('sid-c', 'msg-c'),
        [sessionPath('sid-c')]: sessionJson(1, 2),
      },
      ['agent-a.json', 'agent-b.json', 'agent-c.json'],
    );
    const result = await scanWorkspaceTokenUsage('ws-1', {}, deps);
    expect(result.skippedAgentIds.sort()).toEqual(['agent-a', 'agent-b']);
    expect(Object.keys(result.perAgent)).toEqual(['agent-c']);
    expect(result.scannedCount).toBe(1);
  });

  it('returns an empty result when the agents directory cannot be listed', async () => {
    const deps = makeDeps({}, []);
    deps.readdir.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const result = await scanWorkspaceTokenUsage('ws-1', {}, deps);
    expect(result).toEqual({
      perAgent: {},
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {},
      scannedCount: 0,
      cacheHits: 0,
      skippedAgentIds: [],
    });
  });
});

