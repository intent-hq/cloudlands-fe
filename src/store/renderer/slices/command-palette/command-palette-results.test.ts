import { describe, expect, it } from 'vitest';
import {
  computeResults,
  MAX_BLENDED_ROWS,
  MAX_BLENDED_SERVER_ROWS,
  type ComputeResultsInput,
  type PaletteRepoItem,
} from './command-palette-results';
import type { WorkspaceObject } from './command-palette-utils';

const icon = { iconName: 'test' };

const defaultCommands = [
  { id: 'new-workspace', label: 'New Workspace', icon, shortcut: '⌘T' },
  { id: 'settings', label: 'Settings', icon, shortcut: '⌘,' },
  { id: 'new-agent', label: 'New Agent Chat', icon },
  { id: 'new-terminal', label: 'New Terminal', icon },
  { id: 'new-note', label: 'New Note', icon },
  { id: 'new-file', label: 'New File', icon, shortcut: '⌘N' },
];

function makeInput(overrides: Partial<ComputeResultsInput> = {}): ComputeResultsInput {
  return {
    query: '',
    activeFilter: null,
    workspaceId: 'ws-1',
    agents: [],
    notes: [],
    changes: [],
    terminals: [],
    browserUrls: [],
    recentItems: [],
    files: [],
    commands: defaultCommands,
    workspaceItems: [],
    ...overrides,
  };
}

function makeAgent(id: string, label: string): WorkspaceObject {
  return { id, type: 'agent', label, icon, timestamp: Date.now() };
}

describe('computeResults', () => {
  it('returns new actions row when workspace is set and no query', () => {
    const results = computeResults(makeInput());
    const newActionsRow = results.find((r: any) => r._newActionsRow);
    expect(newActionsRow).toBeDefined();
  });

  it('does not return new actions row when no workspaceId', () => {
    const results = computeResults(makeInput({ workspaceId: undefined }));
    // Should still have new workspace button
    const newWs = results.find((r: any) => r._newWorkspace);
    expect(newWs).toBeDefined();
  });

  it('shows agents group with label', () => {
    const agents = [makeAgent('a1', 'Agent 1'), makeAgent('a2', 'Agent 2')];
    const results = computeResults(makeInput({ agents }));
    const agentLabel = results.find((r: any) => r._groupLabel === 'Agents');
    expect(agentLabel).toBeDefined();
  });

  it('limits items per group to 3 when not searching', () => {
    const agents = Array.from({ length: 5 }, (_, i) => makeAgent(`a${i}`, `Agent ${i}`));
    const results = computeResults(makeInput({ agents }));
    const agentItems = results.filter((r: any) => r.type === 'agent');
    expect(agentItems.length).toBe(3);
    const showMore = results.find((r: any) => r._showMore && r._itemType === 'agent');
    expect(showMore).toBeDefined();
    expect(showMore._count).toBe(2);
  });

  it('shows all items when activeFilter matches type', () => {
    const agents = Array.from({ length: 5 }, (_, i) => makeAgent(`a${i}`, `Agent ${i}`));
    const results = computeResults(makeInput({ agents, activeFilter: 'agent' }));
    const agentItems = results.filter((r: any) => r.type === 'agent');
    expect(agentItems.length).toBe(5);
  });

  it('filters by fuzzy search when query is provided', () => {
    const agents = [makeAgent('a1', 'Build Server'), makeAgent('a2', 'Test Runner')];
    const results = computeResults(makeInput({ agents, query: 'build' }));
    const items = results.filter((r: any) => r.type === 'agent');
    expect(items.length).toBe(1);
    expect(items[0].label).toBe('Build Server');
  });

  it('includes workspace items in search results', () => {
    const workspaceItems = [
      { id: 'ws-2', label: 'Other Space', icon, description: 'repo', _workspace: true as const },
    ];
    const results = computeResults(makeInput({ workspaceItems, query: 'other' }));
    const wsItem = results.find((r: any) => r._workspace);
    expect(wsItem).toBeDefined();
  });

  it('blends rows without group headers while searching; every row has a category and key', () => {
    const agents = [makeAgent('a1', 'Match Agent')];
    const notes: WorkspaceObject[] = [{ id: 'n1', type: 'note', label: 'Match Note', icon }];
    const files = [{ id: 'f1', path: 'src/match.ts', label: 'match.ts', icon }];
    const workspaceItems = [{ id: 'ws-2', label: 'Match Space', icon, _workspace: true as const }];
    const results = computeResults(
      makeInput({ agents, notes, files, workspaceItems, query: 'match' }),
    );
    expect(results.some((r: any) => r._groupLabel)).toBe(false);
    expect(results.map((r: any) => [r._category, r._key])).toEqual(
      expect.arrayContaining([
        ['agent', 'agent:a1'],
        ['note', 'note:ws-1:n1'],
        ['file', 'file:src/match.ts'],
        ['workspace', 'workspace:ws-2'],
      ]),
    );
    expect(results.map((r: any) => r._idx)).toEqual(results.map((_, i) => i));
  });

  it('labels a matching command row with the command category', () => {
    const results = computeResults(makeInput({ query: 'settings' }));
    expect(results[0]).toMatchObject({ id: 'settings', _category: 'command' });
  });

  it('caps the blended list at about 15 rows', () => {
    const agents = Array.from({ length: 20 }, (_, i) => makeAgent(`a${i}`, `Agent ${i}`));
    const results = computeResults(makeInput({ agents, query: 'agent' }));
    expect(results.length).toBe(MAX_BLENDED_ROWS);
  });

  it('shows only the filtered class, uncapped, when activeFilter is set with a query', () => {
    const agents = Array.from({ length: 8 }, (_, i) => makeAgent(`a${i}`, `Agent ${i}`));
    const notes: WorkspaceObject[] = [{ id: 'n1', type: 'note', label: 'Agent Note', icon }];
    const results = computeResults(
      makeInput({ agents, notes, query: 'agent', activeFilter: 'agent' }),
    );
    expect(results.filter((r: any) => r.type === 'agent').length).toBe(8);
    expect(results.filter((r: any) => r.type === 'note').length).toBe(0);
    expect(results.some((r: any) => r._groupLabel)).toBe(false);
  });

  it('matches workspace titles order-independently', () => {
    const workspaceItems = [
      { id: 'ws-2', label: 'Build Server Space', icon, _workspace: true as const },
      { id: 'ws-3', label: 'Unrelated', icon, _workspace: true as const },
    ];
    const results = computeResults(makeInput({ workspaceItems, query: 'server build' }));
    const wsItems = results.filter((r: any) => r._workspace);
    expect(wsItems.length).toBe(1);
    expect(wsItems[0].id).toBe('ws-2');
  });

  it('breaks workspace score ties by last-activity timestamp', () => {
    const workspaceItems = [
      { id: 'ws-old', label: 'Alpha', icon, _workspace: true as const, _activityTime: 100 },
      { id: 'ws-new', label: 'Alpha', icon, _workspace: true as const, _activityTime: 200 },
    ];
    const results = computeResults(makeInput({ workspaceItems, query: 'alpha' }));
    const wsItems = results.filter((r: any) => r._workspace);
    expect(wsItems.map((r: any) => r.id)).toEqual(['ws-new', 'ws-old']);
  });

  it('orders files by match tier while searching', () => {
    const files = [
      { id: 'f1', type: 'file', label: 'zzz-report.ts', icon },
      { id: 'f2', type: 'file', label: 'report.ts', icon },
      { id: 'f3', type: 'file', label: 'a-report.ts', icon },
    ];
    const results = computeResults(makeInput({ files, query: 'report' }));
    const fileItems = results.filter((r: any) => r.type === 'file');
    expect(fileItems.map((r: any) => r.id)).toEqual(['f2', 'f3', 'f1']);
  });

  it('drops stale file entries that no longer match the query', () => {
    // Files load asynchronously, so the incoming list can belong to a previous
    // query; non-matching entries must be dropped without reordering the rest.
    const files = [
      { id: 'f1', type: 'file', label: 'zzz.ts', icon, description: 'src/zzz.ts' },
      { id: 'f2', type: 'file', label: 'report.ts', icon, description: 'src/report.ts' },
      { id: 'f3', type: 'file', label: 'a-report.ts', icon, description: 'src/a-report.ts' },
    ];
    const results = computeResults(makeInput({ files, query: 'report' }));
    const fileItems = results.filter((r: any) => r.type === 'file');
    expect(fileItems.map((r: any) => r.id)).toEqual(['f2', 'f3']);
  });

  it('shows recent items group when present and no filter', () => {
    const recentItems = [makeAgent('a1', 'Recent Agent')];
    const results = computeResults(makeInput({ recentItems }));
    const recentLabel = results.find((r: any) => r._groupLabel === 'Recent');
    expect(recentLabel).toBeDefined();
  });

  it('hides recent items when activeFilter is set', () => {
    const recentItems = [makeAgent('a1', 'Recent Agent')];
    const results = computeResults(makeInput({ recentItems, activeFilter: 'agent' }));
    const recentLabel = results.find((r: any) => r._groupLabel === 'Recent');
    expect(recentLabel).toBeUndefined();
  });

  it('shows border above Other Spaces section', () => {
    const workspaceItems = [
      { id: 'ws-2', label: 'Other', icon, description: 'repo', _workspace: true as const },
    ];
    const results = computeResults(makeInput({ workspaceItems }));
    const border = results.find((r: any) => r._borderAbove);
    expect(border).toBeDefined();
  });

  it('assigns unique _idx to every result item', () => {
    const agents = [makeAgent('a1', 'Agent 1'), makeAgent('a2', 'Agent 2')];
    const results = computeResults(makeInput({ agents }));
    const indices = results.map((r: any) => r._idx);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('keeps transcript matches the client letter matcher would reject', () => {
    const messages = [
      { id: 'ag-1:msg-1', type: 'message', label: 'Agent 1', description: 'hello world', icon },
    ];
    const results = computeResults(makeInput({ query: 'greetings', messages }));
    expect(results.map((r: any) => r._key)).toEqual(['message:ag-1:msg-1']);
  });

  it('lists transcript matches as message rows when searching', () => {
    const messages = [
      { id: 'ag-1:msg-1', type: 'message', label: 'Agent 1', description: 'hello world', icon },
    ];
    const results = computeResults(makeInput({ query: 'hello', messages }));
    expect(results.find((r: any) => r._groupLabel)).toBeUndefined();
    expect(results.find((r: any) => r.type === 'message')._category).toBe('message');
    const messageItems = results.filter((r: any) => r.type === 'message');
    expect(messageItems.length).toBe(1);
    expect(messageItems[0].description).toBe('hello world');
  });

  it('shows only transcript matches when message filter is active', () => {
    const agents = [makeAgent('a1', 'Hello Agent')];
    const messages = [
      { id: 'ag-1:msg-1', type: 'message', label: 'Agent 1', description: 'hello world', icon },
    ];
    const results = computeResults(
      makeInput({ query: 'hello', agents, messages, activeFilter: 'message' }),
    );
    expect(results.filter((r: any) => r.type === 'agent').length).toBe(0);
    expect(results.filter((r: any) => r.type === 'message').length).toBe(1);
  });

  it('omits transcript group when there are no matches', () => {
    const results = computeResults(makeInput({ query: 'hello', messages: [] }));
    const groupLabel = results.find((r: any) => r._groupLabel === 'Chat messages');
    expect(groupLabel).toBeUndefined();
  });
});

describe('indexed note result merge', () => {
  const note = (workspaceId: string, noteId: string, label = 'Unrelated title') => ({
    id: JSON.stringify([workspaceId, noteId]),
    workspaceId,
    noteId,
    type: 'note' as const,
    label,
    description: 'body only needle',
    icon,
  });
  const rows = (input: Partial<ComputeResultsInput>) =>
    computeResults(makeInput(input)).filter((r) => r.type === 'note');

  it.each([null, 'note'] as const)(
    'retains body-only results and server order with filter %s',
    (activeFilter) => {
      const indexedNotes = [note('other', 'b'), note('ws-1', 'a')];
      expect(rows({ query: 'needle', activeFilter, indexedNotes }).map((r) => r.id)).toEqual(
        indexedNotes.map((r) => r.id),
      );
    },
  );

  it('deduplicates by workspace and note: a matched local note shows the first remote hit, server-only hits follow', () => {
    const remote = note('ws-1', 'spec');
    const indexedNotes = [remote, { ...remote, description: 'duplicate' }, note('other', 'spec')];
    const notes = [
      note('ws-1', 'spec', 'needle'),
      { ...note('ws-1', 'title', 'Needle'), description: '' },
      { ...note('ws-1', 'tag', 'Plan'), description: 'needle' },
      { ...note('ws-1', 'fuzzy', 'New expedition entry diary log example'), description: '' },
      { ...note('ws-1', 'miss', 'XYZ'), description: '' },
    ];
    const result = rows({ query: 'needle', activeFilter: 'note', indexedNotes, notes });
    expect(result.map((r) => r.noteId)).toEqual(['spec', 'title', 'tag', 'fuzzy', 'spec']);
    expect(result[0].description).toBe(remote.description);
    expect(result[4].workspaceId).toBe('other');
  });

  it('caps server-only notes at 3 blended rows plus a See all row; the notes filter shows all 10', () => {
    const indexedNotes = Array.from({ length: 10 }, (_, i) => note('other', String(i)));
    const results = computeResults(makeInput({ query: 'needle', indexedNotes }));
    expect(results.filter((r) => r.type === 'note')).toHaveLength(MAX_BLENDED_SERVER_ROWS);
    expect(results.at(-1)).toMatchObject({ _seeAll: true, _filter: 'note' });
    expect(results.at(-1)._count).toBeUndefined();
    expect(rows({ query: 'needle', activeFilter: 'note', indexedNotes })).toHaveLength(10);
  });

  it('shows See all when a server hit merged into a local note row is cut by the row cap', () => {
    // Twenty local title matches, newest first; the server also returns the oldest one.
    const notes = Array.from({ length: 20 }, (_, i) => ({
      ...note('ws-1', `local-${i}`, `needle ${i}`),
      timestamp: 1000 - i,
    }));
    const indexedNotes = [note('ws-1', 'local-19')];
    const results = computeResults(makeInput({ query: 'needle', notes, indexedNotes }));
    expect(results.some((r) => r.noteId === 'local-19')).toBe(false);
    expect(results.at(-1)).toMatchObject({ _seeAll: true, _filter: 'note' });
  });

  it('shows no See all row when a merged server hit is listed', () => {
    const notes = [note('ws-1', 'spec', 'needle')];
    const indexedNotes = [note('ws-1', 'spec')];
    const results = computeResults(makeInput({ query: 'needle', notes, indexedNotes }));
    expect(results.some((r) => r._seeAll)).toBe(false);
  });

  it('shows no See all row when every server note fits', () => {
    const indexedNotes = Array.from({ length: 3 }, (_, i) => note('other', String(i)));
    const results = computeResults(makeInput({ query: 'needle', indexedNotes }));
    expect(results.some((r) => r._seeAll)).toBe(false);
  });

  it('browses local notes for an empty query, ignoring stale remote results', () => {
    const notes = Array.from({ length: 6 }, (_, i) => note('ws-1', String(i)));
    const indexedNotes = [note('other', 'remote')];
    expect(rows({ notes, indexedNotes })).toHaveLength(3);
    expect(rows({ notes, indexedNotes, activeFilter: 'note' }).map((r) => r.id)).toEqual(
      notes.map((r) => r.id),
    );
  });
});

describe('blended ranking', () => {
  const NOW = 1_000_000_000_000;
  const DAY = 86_400_000;
  const repo = (id: string, label: string, overrides: Partial<PaletteRepoItem> = {}) => ({
    id,
    label,
    kind: 'repo' as const,
    icon,
    ...overrides,
  });
  const keys = (input: Partial<ComputeResultsInput>) =>
    computeResults(makeInput({ now: NOW, ...input })).map((r: any) => r._key);

  it('lists New Workspace below matching repo rows', () => {
    const repos = [repo('r1', 'me/new-workspace-kit', { lastUsedAt: NOW - DAY })];
    expect(keys({ query: 'new work', repos })).toEqual(['repo:r1', 'command:new-workspace']);
  });

  it('labels plain folders as folders, keyed like repos', () => {
    const results = computeResults(
      makeInput({ query: 'notes', repos: [repo('f1', 'notes', { kind: 'folder' })] }),
    );
    expect(results[0]).toMatchObject({ _category: 'folder', _key: 'repo:f1' });
  });

  it('lists every repo, most recent first, for + alone', () => {
    const repos = [
      repo('old', 'a/old', { lastUsedAt: NOW - 9 * DAY }),
      repo('new', 'a/new', { lastUsedAt: NOW - DAY }),
      repo('never', 'a/never'),
    ];
    expect(keys({ query: '', activeFilter: 'repo', repos })).toEqual([
      'repo:new',
      'repo:old',
      'repo:never',
    ]);
  });

  it('keeps row 1 on the instant result when a better file arrives later', () => {
    const agents = [makeAgent('a1', 'Report review')];
    const files = [{ id: 'report', path: 'report', label: 'report', icon }];
    expect(keys({ query: 'report', agents, files })).toEqual(['agent:a1', 'file:report']);
  });

  it('puts server notes and messages below every matching instant row', () => {
    const agents = [makeAgent('a1', 'xyz loose match')];
    const indexedNotes = [
      { id: 'n', noteId: 'n', workspaceId: 'w', type: 'note' as const, label: 'xyz', icon },
    ];
    const messages = [{ id: 'm', type: 'message', label: 'xyz', icon }];
    expect(keys({ query: 'xyz', agents, indexedNotes, messages })).toEqual([
      'agent:a1',
      'note:w:n',
      'message:m',
    ]);
  });

  it('applies a pick only while it is under 30 days old', () => {
    const agents = [makeAgent('a1', 'Build docs'), makeAgent('a2', 'Build server')];
    agents[0].timestamp = NOW;
    agents[1].timestamp = NOW - DAY;
    const pick = (age: number) => [{ query: 'Build ', itemKey: 'agent:a2', timestamp: NOW - age }];
    expect(keys({ query: 'build', agents, pickMemory: pick(29 * DAY) })[0]).toBe('agent:a2');
    expect(keys({ query: 'build', agents, pickMemory: pick(31 * DAY) })[0]).toBe('agent:a1');
  });

  it('boosts an item picked for a related query only within its match tier', () => {
    const agents = [makeAgent('a1', 'Build docs'), makeAgent('a2', 'Rebuild cache')];
    const pickMemory = [{ query: 'bu', itemKey: 'agent:a2', timestamp: NOW }];
    expect(keys({ query: 'build', agents, pickMemory })).toEqual(['agent:a1', 'agent:a2']);
  });

  it('caps chat messages at 3 blended rows plus a See all row', () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      type: 'message',
      label: 'x',
      icon,
    }));
    expect(keys({ query: 'q', messages })).toEqual([
      'message:m0',
      'message:m1',
      'message:m2',
      'see-all:message',
    ]);
  });
});
