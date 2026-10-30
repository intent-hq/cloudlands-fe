import { describe, expect, it } from 'vitest';
import type { AgentSession, AgentStatus } from '$shared/types';
import {
  createHomePreviewDefault,
  homePreviewEligibleAgents,
  resolveHomePreviewAgent,
} from './home-preview-agent';

const agent = (id: string, overrides: Partial<AgentSession> = {}): AgentSession => ({
  id,
  backendSessionId: null,
  workspaceId: 'ws-1',
  name: id,
  status: 'active' as AgentStatus,
  messages: [],
  createdAt: '2026-03-19T00:00:00.000Z',
  updatedAt: '2026-03-19T00:00:00.000Z',
  ...overrides,
});

const at = (hour: number) => `2026-03-19T${String(hour).padStart(2, '0')}:00:00.000Z`;

describe('homePreviewEligibleAgents', () => {
  it('drops retired, pending-delete and deleted agents', () => {
    const kept = agent('kept');
    const agents = [
      kept,
      agent('retired', { retiredAt: at(1) }),
      agent('pending', { pendingDeleteAt: at(1) }),
      agent('deleted', { status: 'deleted' as AgentStatus }),
    ];

    expect(homePreviewEligibleAgents(agents)).toEqual([kept]);
  });
});

describe('createHomePreviewDefault', () => {
  it('shows the latest top-level agent rather than the initial agent', () => {
    const resolve = createHomePreviewDefault();
    const initial = agent('initial', { isInitialAgent: true, lastActivity: at(1) });
    const recent = agent('recent', { lastActivity: at(3) });

    expect(resolve([initial, recent], true)?.id).toBe('recent');
  });

  it('keeps the agent chosen once loaded when another agent becomes more active', () => {
    const resolve = createHomePreviewDefault();
    const a = agent('a', { lastActivity: at(3) });
    const b = agent('b', { lastActivity: at(1) });
    expect(resolve([a, b], true)?.id).toBe('a');

    const busierB = agent('b', { lastActivity: at(9) });
    expect(resolve([a, busierB], true)?.id).toBe('a');
  });

  it('follows the latest agent until the list has loaded', () => {
    const resolve = createHomePreviewDefault();
    const cachedA = agent('a', { lastActivity: at(3) });
    const cachedB = agent('b', { lastActivity: at(1) });
    expect(resolve([cachedA, cachedB], false)?.id).toBe('a');

    const loadedB = agent('b', { lastActivity: at(5) });
    expect(resolve([cachedA, loadedB], true)?.id).toBe('b');
    expect(resolve([agent('a', { lastActivity: at(8) }), loadedB], true)?.id).toBe('b');
  });

  it('resolves again when the locked agent is no longer eligible', () => {
    const resolve = createHomePreviewDefault();
    const a = agent('a', { lastActivity: at(3) });
    const b = agent('b', { lastActivity: at(1) });
    expect(resolve([a, b], true)?.id).toBe('a');

    expect(resolve([b], true)?.id).toBe('b');
    expect(resolve([agent('a', { lastActivity: at(9) }), b], true)?.id).toBe('b');
  });

  it('gives each preview its own lock', () => {
    const first = createHomePreviewDefault();
    const a = agent('a', { lastActivity: at(3) });
    const b = agent('b', { lastActivity: at(1) });
    expect(first([a, b], true)?.id).toBe('a');

    const busierB = agent('b', { lastActivity: at(9) });
    expect(createHomePreviewDefault()([a, busierB], true)?.id).toBe('b');
  });

  it('returns null when there are no agents', () => {
    expect(createHomePreviewDefault()([], true)).toBeNull();
  });
});

describe('resolveHomePreviewAgent', () => {
  const a = agent('a');
  const b = agent('b');

  it('prefers an eligible pick over the default', () => {
    expect(resolveHomePreviewAgent([a, b], 'b', a)).toBe(b);
  });

  it('uses the default without a pick, or when the pick is no longer eligible', () => {
    expect(resolveHomePreviewAgent([a, b], null, a)).toBe(a);
    expect(resolveHomePreviewAgent([a], 'b', a)).toBe(a);
  });
});
