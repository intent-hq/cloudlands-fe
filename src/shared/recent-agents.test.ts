import { describe, expect, it } from 'vitest';
import {
  pageKeyToForward,
  parseRecentAgents,
  RECENT_AGENTS_LIMIT,
  recordRecentAgentVisit,
  removeRecentAgentWorkspace,
  visibleRecentAgents,
  type PageInput,
  type RecentAgentEntry,
} from './recent-agents';

function entry(overrides: Partial<RecentAgentEntry> = {}): RecentAgentEntry {
  return {
    connectionId: 'local',
    workspaceId: 'ws-1',
    workspaceTitle: 'Workspace one',
    agentId: 'agent-1',
    agentName: 'Agent one',
    visitedAt: 1,
    ...overrides,
  };
}

describe('recordRecentAgentVisit', () => {
  it('moves a revisited agent to the front without duplicating it', () => {
    const a = entry({ agentId: 'a', visitedAt: 3 });
    const b = entry({ agentId: 'b', visitedAt: 2 });
    const c = entry({ agentId: 'c', visitedAt: 1 });

    const next = recordRecentAgentVisit([a, b, c], entry({ agentId: 'c', visitedAt: 4 }));

    expect(next.map((item) => [item.agentId, item.visitedAt])).toEqual([
      ['c', 4],
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('keeps one entry per connection and agent, so the same agent id on two machines stays apart', () => {
    const local = entry({ agentId: 'shared', connectionId: 'local' });
    const next = recordRecentAgentVisit(
      [local],
      entry({ agentId: 'shared', connectionId: 'remote' }),
    );

    expect(next.map((item) => item.connectionId)).toEqual(['remote', 'local']);
  });

  it('keeps the earlier workspace title when the visit does not know it yet', () => {
    const earlier = entry({ workspaceTitle: 'Known title' });
    const next = recordRecentAgentVisit([earlier], entry({ workspaceTitle: null, visitedAt: 2 }));

    expect(next[0]).toMatchObject({ workspaceTitle: 'Known title', visitedAt: 2 });
  });

  it('drops the oldest entries past the limit', () => {
    const full = Array.from({ length: RECENT_AGENTS_LIMIT }, (_, index) =>
      entry({ agentId: `agent-${index}` }),
    );
    const next = recordRecentAgentVisit(full, entry({ agentId: 'newest' }));

    expect(next).toHaveLength(RECENT_AGENTS_LIMIT);
    expect(next[0]?.agentId).toBe('newest');
    expect(next.some((item) => item.agentId === `agent-${RECENT_AGENTS_LIMIT - 1}`)).toBe(false);
  });
});

describe('removeRecentAgentWorkspace', () => {
  it('drops only the reporting connection’s entries for that workspace', () => {
    const entries = [
      entry({ agentId: 'a', workspaceId: 'gone' }),
      entry({ agentId: 'b', workspaceId: 'kept' }),
      entry({ agentId: 'c', workspaceId: 'gone', connectionId: 'remote' }),
    ];

    expect(
      removeRecentAgentWorkspace(entries, 'local', 'gone').map((item) => item.agentId),
    ).toEqual(['b', 'c']);
  });
});

describe('visibleRecentAgents', () => {
  it('hides entries of connections that are no longer saved', () => {
    const entries = [entry({ agentId: 'a' }), entry({ agentId: 'b', connectionId: 'forgotten' })];

    expect(visibleRecentAgents(entries, new Set(['local'])).map((item) => item.agentId)).toEqual([
      'a',
    ]);
  });
});

describe('parseRecentAgents', () => {
  it('keeps whole entries in order and skips malformed or repeated ones', () => {
    const stored = [
      entry({ agentId: 'a' }),
      { ...entry({ agentId: 'b' }), visitedAt: 'yesterday' },
      entry({ agentId: 'a', visitedAt: 9 }),
      'not an entry',
      entry({ agentId: 'c', workspaceTitle: null }),
    ];

    expect(parseRecentAgents(stored).map((item) => [item.agentId, item.visitedAt])).toEqual([
      ['a', 1],
      ['c', 1],
    ]);
  });

  it('reads anything but an array as an empty list', () => {
    expect(parseRecentAgents(undefined)).toEqual([]);
    expect(parseRecentAgents({ agentId: 'a' })).toEqual([]);
  });

  it('caps a stored list at the limit', () => {
    const stored = Array.from({ length: RECENT_AGENTS_LIMIT + 5 }, (_, index) =>
      entry({ agentId: `agent-${index}` }),
    );

    expect(parseRecentAgents(stored)).toHaveLength(RECENT_AGENTS_LIMIT);
  });
});

describe('pageKeyToForward', () => {
  const input = (overrides: Partial<PageInput> = {}): PageInput => ({
    type: 'keyDown',
    key: 'Tab',
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...overrides,
  });

  it('forwards the configured chord, keeping Shift for the direction', () => {
    expect(pageKeyToForward(input({ alt: true }), false, 'alt+tab', true)).toMatchObject({
      type: 'keydown',
      key: 'Tab',
      altKey: true,
    });
    expect(
      pageKeyToForward(input({ meta: true, shift: true }), false, 'super+tab', false),
    ).toMatchObject({ type: 'keydown', metaKey: true, shiftKey: true });
    expect(
      pageKeyToForward(input({ key: 'F6', control: true }), false, 'ctrl+f6', false),
    ).toMatchObject({ type: 'keydown', key: 'F6' });
  });

  it('leaves every other key, and every key when there is no binding, with the page', () => {
    expect(pageKeyToForward(input(), false, 'alt+tab', true)).toBeNull();
    expect(pageKeyToForward(input({ control: true }), false, 'alt+tab', true)).toBeNull();
    expect(pageKeyToForward(input({ alt: true }), false, 'ctrl+f6', false)).toBeNull();
    expect(pageKeyToForward(input({ alt: true }), false, '', false)).toBeNull();
  });

  it('forwards a modifier release only while a forwarded chord is open', () => {
    const release = input({ type: 'keyUp', key: 'Alt' });
    expect(pageKeyToForward(release, true, 'alt+tab', true)).toMatchObject({
      type: 'keyup',
      altKey: false,
    });
    expect(pageKeyToForward(release, false, 'alt+tab', true)).toBeNull();
    expect(
      pageKeyToForward(input({ type: 'keyUp', key: 'Tab' }), true, 'alt+tab', true),
    ).toBeNull();
  });
});
