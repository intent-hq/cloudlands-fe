import { describe, expect, it } from 'vitest';
import type { AgentId, AgentSession, AgentStatus } from '$shared/types';
import { resolveLatestActiveTopLevelAgent } from './latest-active-agent';

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

const message = (id: string, timestamp: string) =>
  ({
    id,
    role: 'assistant',
    content: '',
    timestamp,
  }) as unknown as AgentSession['messages'][number];

describe('resolveLatestActiveTopLevelAgent', () => {
  it('returns null for an empty list', () => {
    expect(resolveLatestActiveTopLevelAgent([])).toBeNull();
  });

  it('picks the top-level agent with the newest activity, not the initial agent', () => {
    const initial = agent('initial', { isInitialAgent: true, lastActivity: at(1) });
    const recent = agent('recent', { createdAt: at(2), lastActivity: at(5) });
    const older = agent('older', { createdAt: at(3), lastActivity: at(4) });

    expect(resolveLatestActiveTopLevelAgent([initial, recent, older])?.id).toBe('recent');
  });

  it.each([
    ['isBackground', { isBackground: true }],
    ['metadata.isBackground', { metadata: { isBackground: true } as AgentSession['metadata'] }],
    ['parentAgentId', { parentAgentId: 'parent' as AgentId }],
    [
      'metadata.createdByAgentId',
      { metadata: { createdByAgentId: 'parent' } as AgentSession['metadata'] },
    ],
  ])('skips a newer agent that is not top-level (%s)', (_name, overrides) => {
    const topLevel = agent('top', { lastActivity: at(1) });
    const nested = agent('nested', { lastActivity: at(9), ...overrides });

    expect(resolveLatestActiveTopLevelAgent([nested, topLevel])?.id).toBe('top');
  });

  it.each([
    ['retired', { retiredAt: at(10) }],
    ['pending deletion', { pendingDeleteAt: at(10) }],
    ['deleted', { status: 'deleted' as AgentStatus }],
  ])('skips a newer %s agent', (_name, overrides) => {
    const live = agent('live', { lastActivity: at(1) });
    const gone = agent('gone', { lastActivity: at(9), ...overrides });

    expect(resolveLatestActiveTopLevelAgent([gone, live])?.id).toBe('live');
  });

  it('counts a newer message even when lastActivity is older', () => {
    const stale = agent('stale', { lastActivity: at(3) });
    const chatting = agent('chatting', {
      lastActivity: at(1),
      messages: [message('m1', at(6))],
    });

    expect(resolveLatestActiveTopLevelAgent([stale, chatting])?.id).toBe('chatting');
  });

  it('falls back to updatedAt, then createdAt, when lastActivity is missing', () => {
    const updated = agent('updated', { updatedAt: at(4) });
    const created = agent('created', { createdAt: at(5), updatedAt: undefined as never });

    expect(resolveLatestActiveTopLevelAgent([updated, created])?.id).toBe('created');
  });

  it('treats an unparseable activity time as the oldest', () => {
    const broken = agent('broken', {
      lastActivity: 'not-a-date',
      updatedAt: 'nope',
      createdAt: 'never',
    });
    const valid = agent('valid', { lastActivity: at(1) });

    expect(resolveLatestActiveTopLevelAgent([broken, valid])?.id).toBe('valid');
  });

  // The fork marker parentSessionId references a session, not a parent agent, so a
  // forked agent is top-level (agent-scope.ts).
  it('treats a forked agent as top-level', () => {
    const original = agent('original', { lastActivity: at(1) });
    const fork = agent('fork', { parentSessionId: 'original' as AgentId, lastActivity: at(4) });

    expect(resolveLatestActiveTopLevelAgent([original, fork])?.id).toBe('fork');
  });

  it('breaks activity ties by the newer creation time, then by id', () => {
    const olderCreated = agent('b-older', { createdAt: at(1), lastActivity: at(5) });
    const newerCreated = agent('a-newer', { createdAt: at(2), lastActivity: at(5) });
    expect(resolveLatestActiveTopLevelAgent([olderCreated, newerCreated])?.id).toBe('a-newer');
    expect(resolveLatestActiveTopLevelAgent([newerCreated, olderCreated])?.id).toBe('a-newer');

    const first = agent('agent-a', { lastActivity: at(5) });
    const second = agent('agent-b', { lastActivity: at(5) });
    expect(resolveLatestActiveTopLevelAgent([second, first])?.id).toBe(
      resolveLatestActiveTopLevelAgent([first, second])?.id,
    );
  });

  it('falls back to the most recently active agent when none is top-level', () => {
    const background = agent('background', { isBackground: true, lastActivity: at(2) });
    const delegated = agent('delegated', {
      parentAgentId: 'parent' as AgentId,
      lastActivity: at(4),
    });
    const retired = agent('retired', { isBackground: true, lastActivity: at(9), retiredAt: at(9) });

    expect(resolveLatestActiveTopLevelAgent([background, delegated, retired])?.id).toBe(
      'delegated',
    );
  });
});
