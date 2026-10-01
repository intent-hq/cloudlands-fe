import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { WorkspaceStatus } from '$shared/types';
import {
  adaptNoteSearchResponse,
  createNoteQuery,
  type IndexedNoteMatch,
  type IndexedNoteSearchResponse,
  type NoteQueryController,
  type NoteQueryUpdate,
} from './palette-note-search';

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));

const request = vi.mocked(backendRequest);
const match = (overrides: Partial<IndexedNoteMatch> = {}): IndexedNoteMatch => ({
  noteId: 'spec',
  workspaceId: 'workspace-a',
  title: 'Search plan',
  preview: 'A body-only match for wombat.',
  score: 1.25,
  updatedAt: '2026-10-01T01:00:00Z',
  isArchived: false,
  workspaceArchived: false,
  ...overrides,
});
const indexed = (matches: IndexedNoteMatch[] = [match()]): IndexedNoteSearchResponse => ({
  requestId: 'daemon-generated-request',
  indexed: true,
  matches,
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('indexed note response adapter', () => {
  it('maps wire metadata and plain-text snippets with accessible workspace labels', () => {
    const update = adaptNoteSearchResponse(
      indexed([
        match({
          preview: '<script>alert("note")</script> **wombat** & text',
          workspaceArchived: true,
          isArchived: true,
        }),
      ]),
      [
        {
          id: 'workspace-a',
          title: 'Research',
          repositoryOwner: 'intent-hq',
          repositoryName: 'intent',
        },
      ],
    );
    expect(update).toEqual({
      loading: false,
      capability: 'indexed',
      fallback: false,
      items: [
        {
          id: '["workspace-a","spec"]',
          type: 'note',
          noteId: 'spec',
          workspaceId: 'workspace-a',
          label: 'Search plan',
          description: '<script>alert("note")</script> **wombat** & text',
          score: 1.25,
          updatedAt: '2026-10-01T01:00:00Z',
          isArchived: true,
          isArchivedWorkspace: true,
          workspaceName: 'Research',
          repoLabel: 'intent-hq/intent',
        },
      ],
    });
  });

  it('keeps backend archive state when workspace metadata is stale or unavailable', () => {
    const { items } = adaptNoteSearchResponse(
      indexed([match(), match({ workspaceId: 'missing', workspaceArchived: true })]),
      [{ id: 'workspace-a', repositoryName: 'intent', status: WorkspaceStatus.Archived }],
    );
    expect(items[0]).toMatchObject({
      workspaceName: 'workspace-a',
      repoLabel: 'intent',
      isArchivedWorkspace: false,
    });
    expect(items[1]).toMatchObject({ workspaceId: 'missing', isArchivedWorkspace: true });
    expect(items[1].workspaceName).toBeUndefined();
  });

  it('preserves rank order and enforces the ten-result cap without sorting by title or score', () => {
    const { items } = adaptNoteSearchResponse(
      indexed(
        Array.from({ length: 12 }, (_, index) =>
          match({ noteId: `note-${index}`, title: index === 0 ? 'Z' : 'A', score: index }),
        ),
      ),
      [],
    );
    expect(items.map((item) => item.noteId)).toEqual([
      'note-0',
      'note-1',
      'note-2',
      'note-3',
      'note-4',
      'note-5',
      'note-6',
      'note-7',
      'note-8',
      'note-9',
    ]);
  });

  it('keeps identical note IDs distinct across workspaces and delimiter-containing IDs', () => {
    const { items } = adaptNoteSearchResponse(
      indexed([
        match(),
        match({ workspaceId: 'workspace-b' }),
        match({ workspaceId: 'a:b', noteId: 'c' }),
        match({ workspaceId: 'a', noteId: 'b:c' }),
      ]),
      [],
    );
    expect(items.map((item) => [item.workspaceId, item.noteId])).toEqual([
      ['workspace-a', 'spec'],
      ['workspace-b', 'spec'],
      ['a:b', 'c'],
      ['a', 'b:c'],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
  });

  it('recognizes indexed capability with zero matches', () => {
    expect(adaptNoteSearchResponse(indexed([]), [])).toEqual({
      items: [],
      loading: false,
      capability: 'indexed',
      fallback: false,
    });
  });

  it.each([
    { matches: [] },
    { matches: [{ noteId: 'spec', preview: 'legacy hit', score: null }] },
    { indexed: false, matches: [match()] },
    { indexed: 'true', matches: [match()] },
    { matches: [match()] },
  ])(
    'uses fallback without guessing workspace ownership for missing/old markers: %j',
    (response) => {
      expect(adaptNoteSearchResponse(response, [{ id: 'active-workspace' }])).toEqual({
        items: [],
        loading: false,
        capability: 'legacy',
        fallback: true,
      });
    },
  );

  it.each([
    { indexed: true },
    { indexed: true, matches: [{ noteId: 'spec', preview: 'not a complete indexed hit' }] },
    indexed([match({ workspaceId: '' })]),
  ])('rejects a malformed indexed response without inventing identity: %j', (response) => {
    expect(() => adaptNoteSearchResponse(response, [{ id: 'active-workspace' }])).toThrow(
      TypeError,
    );
  });
});

describe('note query controller', () => {
  let controller: NoteQueryController;
  let updates: NoteQueryUpdate[];
  const latest = () => updates.at(-1);

  beforeEach(() => {
    vi.useFakeTimers();
    request.mockReset();
    request.mockResolvedValue(indexed());
    updates = [];
    controller = createNoteQuery((update) => updates.push(update));
  });
  afterEach(() => {
    controller.cancel();
    vi.useRealTimers();
  });

  it('debounces rapid typing by 150ms and sends the exact global request', async () => {
    controller.query('wom', 'workspace-a', []);
    await vi.advanceTimersByTimeAsync(100);
    controller.query('wombat', 'workspace-a', []);
    await vi.advanceTimersByTimeAsync(149);
    expect(request).not.toHaveBeenCalled();
    expect(latest()).toEqual({ items: [], loading: true, capability: 'unknown', fallback: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledExactlyOnceWith('search.notes', {
      query: 'wombat',
      limit: 10,
      includeArchived: false,
      preferWorkspaceId: 'workspace-a',
    });
    expect(latest()).toMatchObject({
      loading: false,
      capability: 'indexed',
      fallback: false,
      items: [{ noteId: 'spec' }],
    });
  });

  it('omits preference and hard workspace scope when no workspace is active', async () => {
    controller.query('wombat', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    expect(request).toHaveBeenCalledExactlyOnceWith('search.notes', {
      query: 'wombat',
      limit: 10,
      includeArchived: false,
    });
  });

  it('distinguishes indexed zero results from an empty legacy response', async () => {
    request.mockResolvedValueOnce(indexed([])).mockResolvedValueOnce({ matches: [] });
    controller.query('!!!', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()).toEqual({ items: [], loading: false, capability: 'indexed', fallback: false });
    controller.query('old daemon', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()).toEqual({ items: [], loading: false, capability: 'legacy', fallback: true });
  });

  it('drops an older response arriving during the replacement debounce', async () => {
    const old = deferred();
    request.mockReturnValueOnce(old.promise);
    controller.query('old', 'workspace-a', []);
    await vi.advanceTimersByTimeAsync(150);
    controller.query('new', 'workspace-a', []);
    old.resolve(indexed([match({ title: 'Obsolete' })]));
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toHaveLength(2);
    expect(latest()?.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()?.items[0].label).toBe('Search plan');
  });

  it('ignores out-of-order successes and stale errors after a newer result', async () => {
    const first = deferred();
    const second = deferred();
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    controller.query('first', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    controller.query('second', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    controller.query('latest', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    const settled = latest();
    first.resolve(indexed([match({ title: 'Obsolete' })]));
    second.reject(new Error('Old request failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(latest()).toBe(settled);
    expect(updates).toHaveLength(4);
  });

  it.each(['clear', 'cancel', 'close'] as const)(
    '%s invalidates both queued and in-flight work',
    async (action) => {
      controller.query('queued', undefined, []);
      controller[action]();
      await vi.advanceTimersByTimeAsync(150);
      expect(request).not.toHaveBeenCalled();

      const pending = deferred();
      request.mockReturnValueOnce(pending.promise);
      controller.query('in-flight', undefined, []);
      await vi.advanceTimersByTimeAsync(150);
      const before = updates.length;
      controller[action]();
      const after = updates.length;
      expect(after).toBe(before + (action === 'cancel' ? 0 : 1));
      if (action !== 'cancel')
        expect(latest()).toEqual({
          items: [],
          loading: false,
          capability: 'unknown',
          fallback: true,
        });
      pending.resolve(indexed());
      await vi.advanceTimersByTimeAsync(0);
      expect(updates).toHaveLength(after);
    },
  );

  it('clears on empty/whitespace query and permits a fresh search after closing', async () => {
    const pending = deferred();
    request.mockReturnValueOnce(pending.promise);
    controller.query('wombat', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    controller.query('  ', undefined, []);
    pending.resolve(indexed());
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()).toEqual({ items: [], loading: false, capability: 'unknown', fallback: true });
    expect(request).toHaveBeenCalledTimes(1);
    controller.close();
    controller.query('reopened', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()?.items[0].noteId).toBe('spec');
  });

  it('invalidates the old workspace request and clears existing rows on workspace changes', async () => {
    controller.query('wombat', 'workspace-a', []);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()?.items).toHaveLength(1);
    const pending = deferred();
    request.mockReturnValueOnce(pending.promise);
    controller.query('wombat', 'workspace-a', []);
    await vi.advanceTimersByTimeAsync(150);
    controller.query('wombat', 'workspace-b', [{ id: 'workspace-a', title: 'New metadata' }]);
    expect(latest()?.items).toEqual([]);
    pending.resolve(indexed([match({ title: 'Old ranking' })]));
    await vi.advanceTimersByTimeAsync(150);
    expect(request).toHaveBeenLastCalledWith('search.notes', {
      query: 'wombat',
      limit: 10,
      includeArchived: false,
      preferWorkspaceId: 'workspace-b',
    });
    expect(latest()?.items[0]).toMatchObject({
      label: 'Search plan',
      workspaceName: 'New metadata',
    });
  });

  it('exposes errors with local fallback and recovers on the next query', async () => {
    const error = new Error('Disconnected');
    request.mockRejectedValueOnce(error);
    controller.query('wombat', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()).toEqual({
      items: [],
      loading: false,
      capability: 'unknown',
      fallback: true,
      error,
    });
    controller.query('retry', undefined, []);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()).toMatchObject({ loading: false, capability: 'indexed', fallback: false });
    expect(latest()?.error).toBeUndefined();
  });

  it('surfaces malformed indexed hits as errors rather than local-workspace results', async () => {
    request.mockResolvedValueOnce({
      indexed: true,
      matches: [{ noteId: 'spec', preview: 'legacy' }],
    });
    controller.query('wombat', 'active-workspace', []);
    await vi.advanceTimersByTimeAsync(150);
    expect(latest()).toMatchObject({
      items: [],
      loading: false,
      capability: 'unknown',
      fallback: true,
      error: expect.any(TypeError),
    });
  });
});
