// @verify-changed-triggers: e2e/build-smoke-helpers.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import {
  assessAgentTurnIdle,
  waitForAgentCompletion,
  type AgentTurnIdleSample,
} from '../e2e/build-smoke-helpers';

const USER_AT = '2026-10-21T04:55:30.000Z';
const settled = {
  id: 'agent-1',
  hydrated: true,
  status: 'idle',
  activationState: null,
  isStreaming: false,
  isResponding: false,
  isProcessing: false,
  lastAssistantStreaming: false,
  lastUserMessageAt: USER_AT,
};
const idleAt = (timestamp: string, agentId = 'agent-1') => ({
  type: 'agent:idle',
  agentId,
  timestamp,
});

function sample(overrides: Partial<AgentTurnIdleSample> = {}): AgentTurnIdleSample {
  return { available: true, agents: [settled], events: [], ...overrides };
}

/**
 * The run-39545719291 shape: the mock agent already wrote README.md and is
 * between tool calls, so no streaming indicator is visible, but the daemon
 * has not emitted agent:idle for the turn yet.
 */
function fakePage(store: AgentTurnIdleSample): Page {
  const locator = {
    first: () => locator,
    isVisible: vi.fn().mockResolvedValue(false),
  };
  return {
    locator: vi.fn(() => locator),
    evaluate: vi.fn().mockResolvedValue(store),
  } as unknown as Page;
}

describe('assessAgentTurnIdle', () => {
  it('is not done when nothing proves the turn ended', () => {
    expect(assessAgentTurnIdle(sample({ available: false, reason: 'no-store' })).done).toBe(false);
    expect(assessAgentTurnIdle(sample({ agents: [] })).done).toBe(false);
    expect(
      assessAgentTurnIdle(sample({ agents: [{ ...settled, lastUserMessageAt: null }] })).done,
    ).toBe(false);
    expect(assessAgentTurnIdle(sample()).reason).toMatch(/no daemon agent:idle/);
  });

  it('ignores an idle from a previous turn', () => {
    const stale = sample({ events: [idleAt('2026-10-21T04:55:29.999Z')] });
    expect(assessAgentTurnIdle(stale).done).toBe(false);
    const laterUserEvent = sample({
      events: [
        idleAt('2026-10-21T04:55:31.000Z'),
        {
          type: 'agent:message',
          agentId: 'agent-1',
          role: 'user',
          timestamp: '2026-10-21T04:55:32.000Z',
        },
      ],
    });
    expect(assessAgentTurnIdle(laterUserEvent).done).toBe(false);
  });

  it('requires settled renderer state even after the daemon idle', () => {
    const events = [idleAt('2026-10-21T04:55:31.000Z')];
    for (const busy of [
      { isResponding: true },
      { lastAssistantStreaming: true },
      { status: 'active' },
      { activationState: 'activating' },
    ]) {
      expect(assessAgentTurnIdle(sample({ agents: [{ ...settled, ...busy }], events })).done).toBe(
        false,
      );
    }
    const otherBusy = { ...settled, id: 'child', lastUserMessageAt: null, isStreaming: true };
    expect(assessAgentTurnIdle(sample({ agents: [settled, otherBusy], events })).done).toBe(false);
  });

  it('is done once the daemon reports idle for the latest turn', () => {
    expect(assessAgentTurnIdle(sample({ events: [idleAt(USER_AT)] })).done).toBe(true);
    const idleChild = { ...settled, id: 'child', lastUserMessageAt: null };
    expect(
      assessAgentTurnIdle(sample({ agents: [settled, idleChild], events: [idleAt(USER_AT)] })).done,
    ).toBe(true);
  });
});

describe('assessAgentTurnIdle failures and unloaded sessions', () => {
  it('reports agent:failed for the latest turn as a failure, never as done', () => {
    const verdict = assessAgentTurnIdle(
      sample({
        agents: [{ ...settled, status: 'failed' }],
        events: [
          idleAt('2026-10-21T04:55:31.000Z'),
          {
            type: 'agent:failed',
            agentId: 'agent-1',
            error: 'provider exploded',
            timestamp: '2026-10-21T04:55:32.000Z',
          },
        ],
      }),
    );
    expect(verdict.done).toBe(false);
    expect(verdict.failure).toEqual({ agentId: 'agent-1', error: 'provider exploded' });
  });

  it('ignores an agent:failed from a previous turn', () => {
    const verdict = assessAgentTurnIdle(
      sample({
        events: [
          {
            type: 'agent:failed',
            agentId: 'agent-1',
            error: 'old',
            timestamp: '2026-10-21T04:55:00Z',
          },
          idleAt('2026-10-21T04:55:31.000Z'),
        ],
      }),
    );
    expect(verdict).toMatchObject({ done: true });
    expect(verdict.failure).toBeUndefined();
  });

  it('is not done while any listed agent has no loaded session', () => {
    const unloaded = { ...settled, id: 'child', hydrated: false, lastUserMessageAt: null };
    const verdict = assessAgentTurnIdle(
      sample({ agents: [settled, unloaded], events: [idleAt(USER_AT)] }),
    );
    expect(verdict).toMatchObject({ done: false, reason: 'child: session not loaded' });
  });
});

/** Runs the real in-page sampler against a stubbed renderer store. */
function storePage(state: unknown): Page {
  const locator = { first: () => locator, isVisible: vi.fn().mockResolvedValue(false) };
  return {
    locator: vi.fn(() => locator),
    evaluate: vi.fn(async (fn: (arg: unknown) => unknown, arg: unknown) => {
      vi.stubGlobal('window', { intent: { reduxContext: { store: { getState: () => state } } } });
      try {
        return await fn(arg);
      } finally {
        vi.unstubAllGlobals();
      }
    }),
  } as unknown as Page;
}

function storeState(sessions: Record<string, unknown>, agentIds: string[], events: unknown[]) {
  return {
    workspaceAgents: { byWorkspaceId: { 'ws-1': { agentIds } } },
    agentSessions: { byAgentId: sessions },
    workspaceEvents: { byWorkspaceId: { 'ws-1': { events } } },
  };
}

const rootSession = {
  status: 'idle',
  messages: [
    { role: 'user', timestamp: USER_AT },
    { role: 'assistant', streamingComplete: true },
  ],
};
const rootIdle = {
  type: 'agent:idle',
  timestamp: '2026-10-21T04:55:40.000Z',
  data: { agentId: 'root' },
};

describe('waitForAgentCompletion (CI path, real sampler)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('waits while a listed agent has no loaded session', async () => {
    vi.stubEnv('CI', 'true');
    const page = storePage(storeState({ root: rootSession }, ['root', 'child'], [rootIdle]));
    await expect(waitForAgentCompletion(page, 'ws-1', 1_200)).rejects.toThrow(
      'child: session not loaded',
    );
  });

  it('rejects with the agent id and error when the latest turn failed', async () => {
    vi.stubEnv('CI', 'true');
    const failed = {
      type: 'agent:failed',
      timestamp: '2026-10-21T04:55:40.000Z',
      data: { agentId: 'root', error: 'session/prompt failed: boom' },
    };
    const page = storePage(
      storeState({ root: { ...rootSession, status: 'failed' } }, ['root'], [failed]),
    );
    await expect(waitForAgentCompletion(page, 'ws-1', 5_000)).rejects.toThrow(
      'Agent root failed its latest turn: session/prompt failed: boom',
    );
  });

  it('resolves when every listed agent is loaded and the daemon reported idle', async () => {
    vi.stubEnv('CI', 'true');
    const page = storePage(storeState({ root: rootSession }, ['root'], [rootIdle]));
    await expect(waitForAgentCompletion(page, 'ws-1', 5_000)).resolves.toBeUndefined();
  });
});

describe('waitForAgentCompletion (CI path)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not return while the daemon still has the turn active, even with no streaming indicator', async () => {
    vi.stubEnv('CI', 'true');
    const page = fakePage(sample({ agents: [{ ...settled, status: 'active' }] }));
    await expect(waitForAgentCompletion(page, 'ws-1', 1_200)).rejects.toThrow(
      /Timed out waiting for daemon agent idle/,
    );
  });

  it('returns once the daemon reported idle for the latest turn', async () => {
    vi.stubEnv('CI', 'true');
    const page = fakePage(sample({ events: [idleAt('2026-10-21T04:55:40.670Z')] }));
    await expect(waitForAgentCompletion(page, 'ws-1', 5_000)).resolves.toBeUndefined();
  });
});
