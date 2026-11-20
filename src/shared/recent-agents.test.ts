import { describe, expect, it } from 'vitest';
import {
  pageKeyToForward,
  parseRecentAgents,
  RECENT_AGENTS_LIMIT,
  recentEntryKey,
  recordRecentVisit,
  removeRecentAgentWorkspace,
  removeRecentEntry,
  visibleRecentAgents,
  type PageInput,
  type RecentEntry,
} from './recent-agents';

type RecentAgentEntry = Extract<RecentEntry, { kind: 'agent' }>;
type RecentTabEntry = Exclude<RecentEntry, RecentAgentEntry>;

function entry(overrides: Partial<RecentAgentEntry> = {}): RecentAgentEntry {
  return {
    kind: 'agent',
    connectionId: 'local',
    workspaceId: 'ws-1',
    workspaceTitle: 'Workspace one',
    agentId: 'agent-1',
    agentName: 'Agent one',
    visitedAt: 1,
    ...overrides,
  };
}

function tab(overrides: Partial<RecentTabEntry> = {}): RecentTabEntry {
  return {
    kind: 'browser',
    connectionId: 'local',
    workspaceId: 'ws-1',
    workspaceTitle: 'Workspace one',
    tabId: 'tab-1',
    title: 'Page',
    url: 'http://localhost:3000/',
    visitedAt: 1,
    ...overrides,
  };
}

const ids = (entries: readonly RecentEntry[]) =>
  entries.map((item) => (item.kind === 'agent' ? item.agentId : `${item.kind}:${item.tabId}`));
const id = (item: RecentEntry) => ids([item])[0];

describe('recordRecentVisit', () => {
  it('moves a revisited agent to the front without duplicating it', () => {
    const a = entry({ agentId: 'a', visitedAt: 3 });
    const b = entry({ agentId: 'b', visitedAt: 2 });
    const c = entry({ agentId: 'c', visitedAt: 1 });

    const next = recordRecentVisit([a, b, c], entry({ agentId: 'c', visitedAt: 4 }));

    expect(next.map((item) => [id(item), item.visitedAt])).toEqual([
      ['c', 4],
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('keeps one entry per connection and agent, so the same agent id on two machines stays apart', () => {
    const local = entry({ agentId: 'shared', connectionId: 'local' });
    const next = recordRecentVisit([local], entry({ agentId: 'shared', connectionId: 'remote' }));

    expect(next.map((item) => item.connectionId)).toEqual(['remote', 'local']);
  });

  it('keeps the earlier workspace title when the visit does not know it yet', () => {
    const earlier = entry({ workspaceTitle: 'Known title' });
    const next = recordRecentVisit([earlier], entry({ workspaceTitle: null, visitedAt: 2 }));

    expect(next[0]).toMatchObject({ workspaceTitle: 'Known title', visitedAt: 2 });
  });

  it('drops the oldest entries past the limit', () => {
    const full = Array.from({ length: RECENT_AGENTS_LIMIT }, (_, index) =>
      entry({ agentId: `agent-${index}` }),
    );
    const next = recordRecentVisit(full, entry({ agentId: 'newest' }));

    expect(next).toHaveLength(RECENT_AGENTS_LIMIT);
    expect(next[0] && id(next[0])).toBe('newest');
    expect(next.some((item) => id(item) === `agent-${RECENT_AGENTS_LIMIT - 1}`)).toBe(false);
  });
});

describe('recordRecentVisit with tabs', () => {
  it('keeps agents, browser tabs and terminals in one most-recent-first order', () => {
    let list = recordRecentVisit([], entry({ agentId: 'a', visitedAt: 1 }));
    list = recordRecentVisit(list, tab({ tabId: 'web', visitedAt: 2 }));
    list = recordRecentVisit(list, tab({ kind: 'terminal', tabId: 'shell', visitedAt: 3 }));
    list = recordRecentVisit(list, tab({ tabId: 'web', title: 'Renamed', visitedAt: 4 }));

    expect(ids(list)).toEqual(['browser:web', 'terminal:shell', 'a']);
    expect(list[0]).toMatchObject({ title: 'Renamed', visitedAt: 4 });
  });

  it('keeps a browser and a terminal with the same tab id, and the same tab id in two workspaces, apart', () => {
    let list = recordRecentVisit([], tab({ tabId: 'same' }));
    list = recordRecentVisit(list, tab({ kind: 'terminal', tabId: 'same' }));
    list = recordRecentVisit(list, tab({ tabId: 'same', workspaceId: 'ws-2' }));

    expect(new Set(list.map(recentEntryKey)).size).toBe(3);
  });

  it('does not let a tab id collide with an agent id', () => {
    const list = recordRecentVisit([entry({ agentId: 'x' })], tab({ tabId: 'x' }));

    expect(list).toHaveLength(2);
  });
});

describe('removeRecentEntry', () => {
  it('drops only the entry with that key', () => {
    const gone = tab({ kind: 'terminal', tabId: 'gone' });
    const list = [entry(), gone, tab()];

    expect(ids(removeRecentEntry(list, recentEntryKey(gone)))).toEqual([
      'agent-1',
      'browser:tab-1',
    ]);
  });
});

describe('removeRecentAgentWorkspace', () => {
  it('drops only the reporting connection’s entries for that workspace', () => {
    const entries = [
      entry({ agentId: 'a', workspaceId: 'gone' }),
      entry({ agentId: 'b', workspaceId: 'kept' }),
      entry({ agentId: 'c', workspaceId: 'gone', connectionId: 'remote' }),
    ];

    expect(removeRecentAgentWorkspace(entries, 'local', 'gone').map(id)).toEqual(['b', 'c']);
  });
});

describe('visibleRecentAgents', () => {
  it('hides entries of connections that are no longer saved', () => {
    const entries = [entry({ agentId: 'a' }), entry({ agentId: 'b', connectionId: 'forgotten' })];

    expect(visibleRecentAgents(entries, new Set(['local'])).map(id)).toEqual(['a']);
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

    expect(parseRecentAgents(stored).map((item) => [id(item), item.visitedAt])).toEqual([
      ['a', 1],
      ['c', 1],
    ]);
  });

  it('reads entries stored before tabs were listed as agents', () => {
    const { kind: _kind, ...legacy } = entry({ agentId: 'old' });

    expect(parseRecentAgents([legacy])).toEqual([entry({ agentId: 'old' })]);
  });

  it('keeps whole tab entries and skips tab entries missing their tab id, title or a known kind', () => {
    const stored = [
      tab({ tabId: 'web' }),
      tab({ kind: 'terminal', tabId: 'shell', url: undefined }),
      { ...tab({ tabId: 'no-title' }), title: 7 },
      { ...tab(), tabId: '' },
      { ...tab({ tabId: 'odd' }), kind: 'notebook' },
      { ...tab({ tabId: 'bad-url' }), url: 42 },
    ];

    expect(ids(parseRecentAgents(stored))).toEqual(['browser:web', 'terminal:shell']);
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
