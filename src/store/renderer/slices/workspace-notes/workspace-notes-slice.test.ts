import { describe, expect, it } from 'vitest';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyLocalNoteUpdate,
  applyNoteUpdated,
  applyTaskStatusChanged,
  clearWorkspaceNotesForWorkspaces,
  emptyWorkspaceNotesState,
  initialState,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteAttributionViewFinished,
  noteAttributionViewReleased,
  noteAttributionViewRequested,
  noteContentViewFinished,
  noteContentViewReleased,
  noteContentViewRequested,
  notePresenceViewReleased,
  notePresenceViewRequested,
  notePresenceViewersReceived,
  noteWorkspaceRootFinished,
  noteWorkspaceRootReleased,
  noteWorkspaceRootRequested,
  setWorkspaceNotesLoading,
  workspaceNotesReducer,
} from './workspace-notes-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';

function mockNote(id: string, workspaceId = WS_1, overrides: Partial<Note> = {}): Note {
  return {
    id: id as Note['id'],
    workspaceId: workspaceId as Note['workspaceId'],
    title: `Note ${id}`,
    content: `Content ${id}`,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('workspaceNotesReducer', () => {
  it('returns the initial state', () => {
    expect(workspaceNotesReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('correlates and releases note content, root, presence, and attribution views', () => {
    const authority = 'authority-1';
    const viewer = {
      principalId: 'principal-1',
      login: 'viewer',
      displayName: 'Viewer',
      avatarUrl: null,
      cursor: null,
      cursorSeenAt: null,
    };
    const attribution = {
      workspaceId: WS_1,
      noteId: 'note-1',
      computedAt: '2026-10-09T00:00:00.000Z',
      attributions: { '1': { timestamp: 1 } },
    };
    let state = workspaceNotesReducer(
      initialState,
      noteContentViewRequested('consumer', 'content-1', WS_1, 'note-1'),
    );
    state = workspaceNotesReducer(
      state,
      noteContentViewFinished(WS_1, 'consumer', 'content-1', authority, 'offline'),
    );
    state = workspaceNotesReducer(
      state,
      noteContentViewFinished(WS_1, 'consumer', 'content-1', authority),
    );
    state = workspaceNotesReducer(state, noteWorkspaceRootRequested('consumer', 'root-1', WS_1));
    state = workspaceNotesReducer(
      state,
      noteWorkspaceRootFinished(WS_1, 'consumer', 'root-1', authority, '/workspace'),
    );
    state = workspaceNotesReducer(
      state,
      notePresenceViewRequested('consumer', 'presence-1', WS_1, 'note-1'),
    );
    state = workspaceNotesReducer(
      state,
      notePresenceViewersReceived(WS_1, 'consumer', 'presence-1', authority, [viewer]),
    );
    state = workspaceNotesReducer(
      state,
      noteAttributionViewRequested('consumer', 'attribution-1', WS_1, 'note-1'),
    );
    const beforeStale = state;
    state = workspaceNotesReducer(
      state,
      noteAttributionViewFinished('consumer', 'stale', WS_1, authority, attribution),
    );
    expect(state).toBe(beforeStale);
    state = workspaceNotesReducer(
      state,
      noteAttributionViewFinished('consumer', 'attribution-1', WS_1, authority, attribution),
    );

    const workspace = state.byWorkspaceId[WS_1];
    expect(getItem(workspace.contentViews, 'consumer')).toMatchObject({
      status: 'ready',
      authority,
    });
    expect(getItem(workspace.contentViews, 'consumer')).not.toHaveProperty('error');
    expect(getItem(workspace.workspaceRoots, 'consumer')).toMatchObject({
      status: 'ready',
      path: '/workspace',
    });
    const presenceView = getItem(workspace.presenceViews, 'consumer');
    expect(presenceView && getItems(presenceView.viewers)).toEqual([viewer]);
    expect(getItem(workspace.attributionViews, 'consumer')?.data).toEqual(attribution);

    state = workspaceNotesReducer(state, noteContentViewReleased(WS_1, 'consumer'));
    state = workspaceNotesReducer(state, noteWorkspaceRootReleased(WS_1, 'consumer'));
    state = workspaceNotesReducer(state, notePresenceViewReleased(WS_1, 'consumer'));
    state = workspaceNotesReducer(state, noteAttributionViewReleased(WS_1, 'consumer'));
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      contentViews: { ids: [] },
      workspaceRoots: { ids: [] },
      presenceViews: { ids: [] },
      attributionViews: { ids: [] },
    });
  });

  it('stores notes and per-workspace flags after a successful load', () => {
    const notesByWorkspace = {
      [WS_1]: [mockNote('note-1')],
      [WS_2]: [],
    };

    expect(
      workspaceNotesReducer(
        initialState,
        loadWorkspaceNotesSucceeded([WS_1, WS_2], notesByWorkspace),
      ),
    ).toEqual({
      retainedDrafts: {},
      nextPublicationLifetime: 2,
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceNotesState,
          publicationLifetime: 1,
          notes: {
            idField: 'id',
            ids: ['note-1'],
            map: { 'note-1': mockNote('note-1') },
            refsCount: {},
          },
          initialized: true,
          notesVersion: 1,
        },
        [WS_2]: {
          ...emptyWorkspaceNotesState,
          publicationLifetime: 2,
          notes: {
            idField: 'id',
            ids: [],
            map: {},
            refsCount: {},
          },
          initialized: true,
          notesVersion: 1,
        },
      },
    });
  });

  it('keeps cached full content when a slim re-list row (same rev) arrives without content', () => {
    const full = mockNote('note-1', WS_1, { content: 'Full body', rev: 3 });
    const slim = mockNote('note-1', WS_1, {
      content: '',
      contentPreview: 'Full bo',
      contentLength: 9,
      rev: 3,
    });
    const seeded = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [full] }),
    );
    const relisted = workspaceNotesReducer(
      seeded,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [slim] }),
    );

    const merged = getItem(relisted.byWorkspaceId[WS_1].notes, 'note-1' as Note['id']);
    expect(merged?.content).toBe('Full body');
    expect(merged?.contentPreview).toBe('Full bo');
  });

  it('lets a slim row with a strictly newer rev replace outdated cached content', () => {
    const full = mockNote('note-1', WS_1, { content: 'Old body', rev: 3 });
    const slim = mockNote('note-1', WS_1, {
      content: '',
      contentPreview: 'New bo',
      contentLength: 8,
      rev: 4,
    });
    const seeded = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [full] }),
    );
    const relisted = workspaceNotesReducer(
      seeded,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [slim] }),
    );

    const merged = getItem(relisted.byWorkspaceId[WS_1].notes, 'note-1' as Note['id']);
    expect(merged?.content).toBe('');
    expect(merged?.contentLength).toBe(8);
  });

  it('lets a slim row win when either rev is missing (cached body cannot be proven current)', () => {
    const full = mockNote('note-1', WS_1, { content: 'Cached body', rev: 3 });
    const revlessSlim = mockNote('note-1', WS_1, {
      content: '',
      contentPreview: 'New bo',
      contentLength: 8,
      rev: undefined,
    });
    const seeded = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [full] }),
    );
    const relisted = workspaceNotesReducer(
      seeded,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [revlessSlim] }),
    );

    // The stale marker stays intact so content surfaces refetch on demand,
    // instead of grafting a possibly-outdated body under new preview markers.
    const merged = getItem(relisted.byWorkspaceId[WS_1].notes, 'note-1' as Note['id']);
    expect(merged?.content).toBe('');
    expect(merged?.contentLength).toBe(8);
  });

  it('stores slim rows as-is when nothing is cached for the note', () => {
    const slim = mockNote('note-new', WS_1, {
      content: '',
      contentPreview: 'Preview',
      contentLength: 42,
    });
    const state = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [slim] }),
    );

    const stored = getItem(state.byWorkspaceId[WS_1].notes, 'note-new' as Note['id']);
    expect(stored?.content).toBe('');
    expect(stored?.contentLength).toBe(42);
  });

  it('bumps notesVersion on loadWorkspaceNotesSucceeded so mount-time hydration ticks version-gated selectors', () => {
    const first = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1')] }),
    );
    const second = workspaceNotesReducer(
      first,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1'), mockNote('note-2')] }),
    );

    expect(first.byWorkspaceId[WS_1].notesVersion).toBe(1);
    expect(second.byWorkspaceId[WS_1].notesVersion).toBe(2);
  });

  it('tracks loading and errors per workspace', () => {
    let state = workspaceNotesReducer(initialState, setWorkspaceNotesLoading([WS_1], true));
    state = workspaceNotesReducer(state, loadWorkspaceNotesFailed([WS_1], 'boom'));

    expect(state.byWorkspaceId[WS_1]).toEqual({
      ...emptyWorkspaceNotesState,
      publicationLifetime: 1,
      loading: false,
      error: 'boom',
    });
  });

  it('clears only the requested workspace snapshots', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1, WS_2], {
        [WS_1]: [mockNote('note-1')],
        [WS_2]: [mockNote('note-2', WS_2)],
      }),
    );

    expect(workspaceNotesReducer(loadedState, clearWorkspaceNotesForWorkspaces([WS_1]))).toEqual({
      retainedDrafts: {},
      nextPublicationLifetime: 3,
      byWorkspaceId: {
        [WS_2]: loadedState.byWorkspaceId[WS_2],
      },
    });
  });

  it('updates task status for tracked task notes', () => {
    const taskNote = mockNote('task-1', WS_1, {
      metadata: { task: { status: 'not_started' } },
    });
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [taskNote] }),
    );

    const nextState = workspaceNotesReducer(
      loadedState,
      applyTaskStatusChanged(WS_1, 'task-1', 'complete'),
    );

    expect(
      getItem(nextState.byWorkspaceId[WS_1].notes, 'task-1' as Note['id'])?.metadata?.task?.status,
    ).toBe('complete');
    expect(nextState.byWorkspaceId[WS_1].notesVersion).toBe(
      loadedState.byWorkspaceId[WS_1].notesVersion + 1,
    );
  });

  it('does not bump notesVersion on applyTaskStatusChanged for uninitialized or non-task notes', () => {
    const uninitializedState = workspaceNotesReducer(
      initialState,
      applyTaskStatusChanged(WS_1, 'task-1', 'complete'),
    );
    expect(uninitializedState).toBe(initialState);

    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('plain-1')] }),
    );
    const noTaskState = workspaceNotesReducer(
      loadedState,
      applyTaskStatusChanged(WS_1, 'plain-1', 'complete'),
    );
    expect(noTaskState).toBe(loadedState);
  });

  it('appends created notes only for tracked workspaces', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1')] }),
    );

    const trackedState = workspaceNotesReducer(
      loadedState,
      applyNoteCreated(WS_1, mockNote('note-2')),
    );
    const untrackedState = workspaceNotesReducer(
      loadedState,
      applyNoteCreated(WS_2, mockNote('note-3', WS_2)),
    );

    expect(getItems(trackedState.byWorkspaceId[WS_1].notes).map((note) => note.id)).toEqual([
      'note-1',
      'note-2',
    ]);
    expect(trackedState.byWorkspaceId[WS_1].notesVersion).toBe(
      loadedState.byWorkspaceId[WS_1].notesVersion + 1,
    );
    expect(untrackedState).toBe(loadedState);
  });

  it('removes deleted notes from the tracked workspace', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote('note-1'), mockNote('note-2')],
      }),
    );

    const nextState = workspaceNotesReducer(loadedState, applyNoteDeleted(WS_1, 'note-1'));

    expect(getItems(nextState.byWorkspaceId[WS_1].notes).map((note) => note.id)).toEqual([
      'note-2',
    ]);
    expect(nextState.byWorkspaceId[WS_1].notesVersion).toBe(
      loadedState.byWorkspaceId[WS_1].notesVersion + 1,
    );
  });

  it('does not bump notesVersion on applyNoteDeleted when the note is absent', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1')] }),
    );

    const nextState = workspaceNotesReducer(loadedState, applyNoteDeleted(WS_1, 'note-missing'));

    expect(nextState).toBe(loadedState);
  });

  it('replaces updated notes when a full note payload is available', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1')] }),
    );
    const updatedNote = mockNote('note-1', WS_1, { title: 'Updated title' });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, 'note-1', updatedNote),
    );

    expect(getItem(nextState.byWorkspaceId[WS_1].notes, 'note-1' as Note['id'])?.title).toBe(
      'Updated title',
    );
  });

  it('caches updated notes before workspace notes finish initializing', () => {
    const updatedSpec = mockNote('spec', WS_1, { content: '# Coordinator plan' });

    const nextState = workspaceNotesReducer(
      initialState,
      applyNoteUpdated(WS_1, 'spec', updatedSpec),
    );

    expect(nextState.byWorkspaceId[WS_1].initialized).toBe(false);
    expect(getItem(nextState.byWorkspaceId[WS_1].notes, 'spec' as Note['id'])?.content).toBe(
      '# Coordinator plan',
    );
  });

  // ---- monorepo#533: rev gating on applyNoteUpdated --------------------------
  // A refetch triggered by an older note:updated event can land after a newer
  // state was already applied (or after advanceNoteRev recorded a daemon ack).
  // A strictly-lower rev is definitively stale and must not revert content.

  it('drops applyNoteUpdated carrying a strictly-lower rev than the stored note', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote('note-1', WS_1, { rev: 5, content: 'newer' })],
      }),
    );
    const staleNote = mockNote('note-1', WS_1, { rev: 4, content: 'older' });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, 'note-1', staleNote),
    );

    expect(nextState).toBe(loadedState);
    expect(getItem(nextState.byWorkspaceId[WS_1].notes, 'note-1' as Note['id'])?.content).toBe(
      'newer',
    );
  });

  it('applies applyNoteUpdated with an equal rev (same-rev refetch is not stale)', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1', WS_1, { rev: 5 })] }),
    );
    const sameRevNote = mockNote('note-1', WS_1, { rev: 5, content: 'refetched' });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, 'note-1', sameRevNote),
    );

    expect(getItem(nextState.byWorkspaceId[WS_1].notes, 'note-1' as Note['id'])?.content).toBe(
      'refetched',
    );
  });

  it('applies applyNoteUpdated with a higher rev', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1', WS_1, { rev: 5 })] }),
    );
    const newerNote = mockNote('note-1', WS_1, { rev: 6, content: 'advanced' });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, 'note-1', newerNote),
    );

    expect(getItem(nextState.byWorkspaceId[WS_1].notes, 'note-1' as Note['id'])?.rev).toBe(6);
  });

  it('applies applyNoteUpdated when either rev is missing (older daemons, last-writer-wins)', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1', WS_1, { rev: 5 })] }),
    );
    const revlessNote = mockNote('note-1', WS_1, { content: 'no rev' });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, 'note-1', revlessNote),
    );

    expect(getItem(nextState.byWorkspaceId[WS_1].notes, 'note-1' as Note['id'])?.content).toBe(
      'no rev',
    );
  });

  it('returns state unchanged when note workspace ID does not match action workspace ID', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1')] }),
    );
    const noteFromDifferentWorkspace = mockNote('note-2', WS_2, { title: 'Wrong workspace' });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, 'note-2', noteFromDifferentWorkspace),
    );

    expect(nextState).toBe(loadedState);
    expect(getItem(nextState.byWorkspaceId[WS_1].notes, 'note-2' as Note['id'])).toBeUndefined();
  });

  it('drops non-string local content/title/source updates before storing notes', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1')] }),
    );

    const nextState = workspaceNotesReducer(
      loadedState,
      applyLocalNoteUpdate(WS_1, 'note-1', {
        content: { slice: 'not-a-function' },
        title: 42,
        source: { invalid: true },
      } as unknown as Partial<Note>),
    );

    const note = getItem(nextState.byWorkspaceId[WS_1].notes, 'note-1' as Note['id']);
    expect(note?.content).toBe('Content note-1');
    expect(note?.title).toBe('Note note-1');
    expect((note as any).source).toBeUndefined();
  });

  it('clears workspace state on workspaceUnmounted', () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1, WS_2], {
        [WS_1]: [mockNote('note-1')],
        [WS_2]: [mockNote('note-2', WS_2)],
      }),
    );

    const nextState = workspaceNotesReducer(loadedState, workspaceUnmounted(WS_1));

    expect(nextState.byWorkspaceId[WS_1]).toBeUndefined();
    expect(nextState.byWorkspaceId[WS_2]).toEqual(loadedState.byWorkspaceId[WS_2]);
  });
});

it('renews publication lifetime on workspace reuse while preserving other live owners', () => {
  const loaded = workspaceNotesReducer(
    undefined,
    loadWorkspaceNotesSucceeded([WS_1, WS_2], {
      [WS_1]: [mockNote('note-1')],
      [WS_2]: [mockNote('note-2', WS_2)],
    }),
  );
  const edited = workspaceNotesReducer(
    loaded,
    applyLocalNoteUpdate(WS_1, 'note-1', { title: 'ordinary edit' }),
  );
  expect(edited.byWorkspaceId[WS_1].publicationLifetime).toBe(
    loaded.byWorkspaceId[WS_1].publicationLifetime,
  );
  const unmounted = workspaceNotesReducer(edited, workspaceUnmounted(WS_1));
  const recreated = workspaceNotesReducer(
    unmounted,
    loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote('note-1')] }),
  );
  expect(recreated.byWorkspaceId[WS_1].publicationLifetime).not.toBe(
    loaded.byWorkspaceId[WS_1].publicationLifetime,
  );
  expect(recreated.byWorkspaceId[WS_2].publicationLifetime).toBe(
    loaded.byWorkspaceId[WS_2].publicationLifetime,
  );
  expect(Object.keys(recreated.byWorkspaceId)).toHaveLength(2);
});
