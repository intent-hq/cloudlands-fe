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

  it('is done once the daemon reports idle or failed for the latest turn', () => {
    expect(assessAgentTurnIdle(sample({ events: [idleAt(USER_AT)] })).done).toBe(true);
    const failed = sample({
      events: [{ type: 'agent:failed', agentId: 'agent-1', timestamp: '2026-10-21T04:55:31Z' }],
    });
    expect(assessAgentTurnIdle(failed).done).toBe(true);
    const idleChild = { ...settled, id: 'child', lastUserMessageAt: null };
    expect(
      assessAgentTurnIdle(sample({ agents: [settled, idleChild], events: [idleAt(USER_AT)] })).done,
    ).toBe(true);
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
