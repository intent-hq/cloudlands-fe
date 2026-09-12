import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

import { appClient } from '$lib/client';
import { toast } from 'svelte-sonner';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import {
  createNoteRequested,
  markNoteRead,
} from '../../note-read-tracking/note-read-tracking-slice';
import { openTab, openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  addOptimisticNote,
  applyNoteUpdated,
  createNote,
  deleteNote,
  loadWorkspaceNotesSucceeded,
  updateNote,
  updateNoteContent,
  updateNoteTitle,
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import { NOTE_CONTENT_SAVE_DEBOUNCE_MS, notesWriteSaga } from './notes-write-saga';

const WS = 'ws-notes-write';
const WS2 = 'ws-notes-write-2';
const NOTE = 'note-1';
const NOW = '2026-01-01T00:00:00.000Z';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: NoteId(NOTE),
    workspaceId: WorkspaceId(WS),
    title: 'Old',
    content: 'old body',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    rev: 4,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function harness(seed: Note | Note[] = note()) {
  const channel = stdChannel();
  const actions: Parameters<typeof workspaceNotesReducer>[1][] = [];
  const notesByWorkspace: Record<string, Note[]> = {};
  for (const item of Array.isArray(seed) ? seed : [seed]) {
    const workspaceId = String(item.workspaceId);
    (notesByWorkspace[workspaceId] ??= []).push(item);
  }
  let workspaceNotes = workspaceNotesReducer(
    undefined,
    loadWorkspaceNotesSucceeded(Object.keys(notesByWorkspace), notesByWorkspace),
  );
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    actions.push(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => ({ workspaceNotes }) }, notesWriteSaga);
  return { actions, channel, dispatch, getState: () => workspaceNotes, task };
}

describe('notesWriteSaga', () => {
  // Suite invariant (AC10): every content save for a loaded note forwards a
  // defined rev as expectedVersion. Only the never-loaded LWW test opts out.
  let expectUnloadedSave = false;

  afterEach(() => {
    const setContent = appClient.notes.setContent;
    if (!expectUnloadedSave && vi.isMockFunction(setContent)) {
      for (const call of setContent.mock.calls) {
        expect(call[2], `setContent(${String(call[0])}) sent no rev`).toEqual(expect.any(Number));
      }
    }
    expectUnloadedSave = false;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('serializes content before metadata and threads the advanced revision', async () => {
    let resolveContent!: (result: { success: true }) => void;
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockReturnValue(
      new Promise((resolve) => {
        resolveContent = resolve;
      }),
    );
    const updateMetadata = vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: true,
    });
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'new body', true));
    run.channel.put(updateNoteTitle(WS, NOTE, 'New'));
    await settle();
    expect(setContent.mock.calls).toEqual([[NOTE, 'new body', 4, WS]]);
    expect(updateMetadata.mock.calls).toEqual([]);

    resolveContent({ success: true });
    await settle();
    expect(updateMetadata.mock.calls).toEqual([[NOTE, { title: 'New' }, 5, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.rev).toEqual(6);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('debounces latest content per workspace and note while different keys proceed independently', async () => {
    vi.useFakeTimers();
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({ success: true });
    const run = harness([
      note(),
      note({ id: NoteId('note-2'), rev: 9 }),
      note({ workspaceId: WorkspaceId(WS2), rev: 12 }),
    ]);

    run.channel.put(updateNoteContent(WS, NOTE, 'a'));
    run.channel.put(updateNoteContent(WS, NOTE, 'ab'));
    run.channel.put(updateNoteContent(WS, 'note-2', 'other note'));
    run.channel.put(updateNoteContent(WS2, NOTE, 'other workspace'));
    await settle();

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS - 1);
    expect(setContent.mock.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(setContent.mock.calls).toEqual([
      [NOTE, 'ab', 4, WS],
      ['note-2', 'other note', 9, WS],
      [NOTE, 'other workspace', 12, WS2],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('creates with the exact request and reconciles the optimistic note to the canonical note', async () => {
    const created = note({
      id: NoteId('note-created'),
      title: 'Fresh',
      content: '',
      tags: ['tag'],
    });
    const wireCreated = {
      ...created,
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
    } as Note;
    const create = vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([note(), wireCreated]);
    const run = harness();

    run.channel.put(createNote(WS, { title: 'Fresh', content: '', tags: ['tag'] }));
    await settle();

    expect(create.mock.calls).toEqual([
      [{ workspaceId: WS, title: 'Fresh', content: '', tags: ['tag'] }],
    ]);
    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions.slice(-2)).toEqual([
      loadWorkspaceNotesSucceeded([WS], { [WS]: [note(), created] }),
      addOptimisticNote(WS, created),
    ]);
    expect(run.getState().byWorkspaceId[WS]?.notes.ids.map(String)).toEqual([NOTE, 'note-created']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('removes the optimistic note when creation fails without refetching', async () => {
    const create = vi.spyOn(appClient.notes, 'create').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const list = vi.spyOn(appClient.notes, 'list');
    const run = harness();

    run.channel.put(createNote(WS, { title: 'Fresh', content: '' }));
    await settle();

    expect(create.mock.calls).toEqual([[{ workspaceId: WS, title: 'Fresh', content: '' }]]);
    expect(list.mock.calls).toEqual([]);
    expect(run.getState().byWorkspaceId[WS]?.notes.ids.map(String)).toEqual([NOTE]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('preserves an explicit panel target when createNoteRequested opens the new note', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const created = note({
      id: NoteId('note-created'),
      title: 'New Note',
      content: '',
    });
    const create = vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([note(), created]);
    const run = harness();

    run.channel.put(createNoteRequested(WS, { panelLayoutId: WS, panelId: 'working-panel' }));
    await settle();

    expect(create.mock.calls).toEqual([
      [{ workspaceId: WS, title: 'New Note', content: '', tags: [] }],
    ]);
    expect(list.mock.calls).toEqual([[WS]]);
    const orderedSuccess = run.actions.filter((action) => {
      if (action.type === addOptimisticNote.type) {
        return String((action.payload as [string, Note])[1].id) === 'note-created';
      }
      return action.type === markNoteRead.type || action.type === openTab.type;
    });
    const opened = orderedSuccess[2] as ReturnType<typeof openTab>;
    expect(orderedSuccess).toEqual([
      addOptimisticNote(WS, created),
      markNoteRead(WS, 'note-created'),
      openTab(
        WS,
        {
          type: 'note',
          title: 'New Note',
          closable: true,
          noteId: 'note-created',
          workspaceId: WS,
        },
        'working-panel',
        opened.payload.newTabId,
        false,
        opened.payload.timestamp,
      ),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('routes untargeted createNoteRequested through configured rightmost-column placement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const created = note({
      id: NoteId('note-created'),
      title: 'New Note',
      content: '',
    });
    vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true });
    vi.spyOn(appClient.notes, 'list').mockResolvedValue([note(), created]);
    const run = harness();

    run.channel.put(createNoteRequested(WS, { panelLayoutId: 'nested-layout' }));
    await settle();

    const orderedSuccess = run.actions.filter((action) => {
      if (action.type === addOptimisticNote.type) {
        return String((action.payload as [string, Note])[1].id) === 'note-created';
      }
      return (
        action.type === markNoteRead.type || action.type === openTabInRightmostColumnRequested.type
      );
    });
    const opened = orderedSuccess[2] as ReturnType<typeof openTabInRightmostColumnRequested>;
    expect(orderedSuccess).toEqual([
      addOptimisticNote(WS, created),
      markNoteRead(WS, 'note-created'),
      openTabInRightmostColumnRequested(
        'nested-layout',
        {
          type: 'note',
          title: 'New Note',
          closable: true,
          noteId: 'note-created',
          workspaceId: WS,
        },
        { newTabId: opened.payload.newTabId },
        opened.payload.timestamp,
      ),
    ]);
    expect(run.actions.some((action) => action.type === openTab.type)).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('refetches the canonical note after a non-conflict content failure', async () => {
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const canonical = note({ content: 'server body', rev: 8 });
    const wireCanonical = {
      ...canonical,
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
    } as Note;
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([wireCanonical]);
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'mine', true));
    await settle();

    expect(setContent.mock.calls).toEqual([[NOTE, 'mine', 4, WS]]);
    expect(list.mock.calls).toEqual([[WS]]);
    expect(
      run.actions.filter((action) => action.type === loadWorkspaceNotesSucceeded.type),
    ).toEqual([loadWorkspaceNotesSucceeded([WS], { [WS]: [canonical] })]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toEqual(canonical);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies the merged newContent and the echoed rev after a successful content save', async () => {
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: true,
      newContent: 'mine + agent',
      noteRev: 7,
    });
    const list = vi.spyOn(appClient.notes, 'list');
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'mine', true));
    await settle();

    expect(setContent.mock.calls).toEqual([[NOTE, 'mine', 4, WS]]);
    expect(list.mock.calls).toEqual([]);
    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.content).toEqual('mine + agent');
    expect(applied?.rev).toEqual(7);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('falls back to sentRev + 1 when a successful content save echoes no rev', async () => {
    vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: true,
      newContent: 'merged',
    });
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'mine', true));
    await settle();

    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.content).toEqual('merged');
    expect(applied?.rev).toEqual(5);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies an echo equal to the sent content over an older refetch that landed in flight', async () => {
    let resolveSave!: (result: unknown) => void;
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }) as never,
    );
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'mine', true));
    await settle();
    expect(setContent.mock.calls).toEqual([[NOTE, 'mine', 4, WS]]);

    run.dispatch(
      loadWorkspaceNotesSucceeded([WS], {
        [WS]: [note({ content: 'refetched older content', rev: 5 })],
      }),
    );
    resolveSave({ success: true, newContent: 'mine', noteRev: 6 });
    await settle();

    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.content).toEqual('mine');
    expect(applied?.rev).toEqual(6);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps newer local text queued behind an older save when the older echo lands', async () => {
    let resolveFirst!: (result: unknown) => void;
    let resolveSecond!: (result: unknown) => void;
    const setContent = vi
      .spyOn(appClient.notes, 'setContent')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }) as never,
      );
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'first', true));
    await settle();
    run.channel.put(updateNoteContent(WS, NOTE, 'first plus typing', true));
    await settle();
    expect(setContent.mock.calls).toEqual([[NOTE, 'first', 4, WS]]);

    resolveFirst({ success: true, newContent: 'first plus agent', noteRev: 5 });
    await settle();
    let current = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(current?.content).toEqual('first plus typing');
    expect(current?.rev).toEqual(5);
    // The queued save read the advanced rev, not the stale 4.
    expect(setContent.mock.calls).toEqual([
      [NOTE, 'first', 4, WS],
      [NOTE, 'first plus typing', 5, WS],
    ]);

    resolveSecond({ success: true, newContent: 'first plus typing', noteRev: 6 });
    await settle();
    current = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(current?.content).toEqual('first plus typing');
    expect(current?.rev).toEqual(6);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps a still-debounced newer edit when the older save echoes merged text', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: unknown) => void;
    const setContent = vi
      .spyOn(appClient.notes, 'setContent')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockResolvedValue({ success: true });
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'first', true));
    await settle();
    run.channel.put(updateNoteContent(WS, NOTE, 'first plus typing'));
    await settle();

    resolveFirst({ success: true, newContent: 'first plus agent', noteRev: 5 });
    await settle();
    const current = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(current?.content).toEqual('first plus typing');
    expect(current?.rev).toEqual(5);

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(setContent.mock.calls).toEqual([
      [NOTE, 'first', 4, WS],
      [NOTE, 'first plus typing', 5, WS],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('omits expectedVersion only when the note was never loaded', async () => {
    expectUnloadedSave = true;
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({ success: true });
    const run = harness();

    run.channel.put(updateNoteContent(WS, 'never-loaded', 'mine', true));
    await settle();

    expect(setContent.mock.calls).toEqual([['never-loaded', 'mine', undefined, WS]]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('treats a conflict result on a content save as a generic failure (refetch, no reload prompt)', async () => {
    const canonical = note({ content: 'server body', rev: 8 });
    const wireCanonical = {
      ...canonical,
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
    } as Note;
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: false,
      error: 'conflict',
      conflict: { current: wireCanonical },
    });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([wireCanonical]);
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'mine', true));
    await settle();

    expect(setContent.mock.calls).toEqual([[NOTE, 'mine', 4, WS]]);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(run.actions.filter((action) => action.type === applyNoteUpdated.type)).toEqual([]);
    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toEqual(canonical);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies the daemon note directly after a metadata conflict without a generic refetch', async () => {
    const canonical = note({ title: 'Server', rev: 8 });
    const wireCanonical = {
      ...canonical,
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
    } as Note;
    const updateMetadata = vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      conflict: { current: wireCanonical },
    });
    const list = vi.spyOn(appClient.notes, 'list');
    const run = harness();

    run.channel.put(updateNoteTitle(WS, NOTE, 'Mine'));
    await settle();

    expect(updateMetadata.mock.calls).toEqual([[NOTE, { title: 'Mine' }, 4, WS]]);
    expect(list.mock.calls).toEqual([]);
    expect(run.actions.filter((action) => action.type === applyNoteUpdated.type)).toEqual([
      applyNoteUpdated(WS, NOTE, canonical),
    ]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toEqual(canonical);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('preserves cached unmetDependsOn when a conflict note omits the projection', async () => {
    const cached = note({
      metadata: {
        task: {
          status: 'not_started',
          dependsOn: [NoteId('dep-1')],
          unmetDependsOn: [NoteId('dep-1')],
        },
      },
    });
    const wireCurrent = note({
      title: 'Server',
      rev: 8,
      metadata: { task: { status: 'not_started', dependsOn: [NoteId('dep-1')] } },
    });
    vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      conflict: { current: wireCurrent },
    });
    const run = harness(cached);

    run.channel.put(updateNoteTitle(WS, NOTE, 'Mine'));
    await settle();

    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.title).toEqual('Server');
    expect(applied?.metadata?.task?.unmetDependsOn).toEqual([NoteId('dep-1')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('lets an explicit unmetDependsOn on a conflict note win over the cache', async () => {
    const cached = note({
      metadata: {
        task: {
          status: 'not_started',
          dependsOn: [NoteId('dep-1'), NoteId('dep-2')],
          unmetDependsOn: [NoteId('dep-1')],
        },
      },
    });
    const wireCurrent = note({
      title: 'Server',
      rev: 8,
      metadata: {
        task: {
          status: 'not_started',
          dependsOn: [NoteId('dep-1'), NoteId('dep-2')],
          unmetDependsOn: [NoteId('dep-2')],
        },
      },
    });
    vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      conflict: { current: wireCurrent },
    });
    const run = harness(cached);

    run.channel.put(updateNoteTitle(WS, NOTE, 'Mine'));
    await settle();

    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.metadata?.task?.unmetDependsOn).toEqual([NoteId('dep-2')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops cached unmet ids the conflict note no longer depends on', async () => {
    const cached = note({
      metadata: {
        task: {
          status: 'not_started',
          dependsOn: [NoteId('dep-1'), NoteId('dep-2')],
          unmetDependsOn: [NoteId('dep-1'), NoteId('dep-2')],
        },
      },
    });
    const wireCurrent = note({
      title: 'Server',
      rev: 8,
      metadata: { task: { status: 'not_started', dependsOn: [NoteId('dep-2')] } },
    });
    vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      conflict: { current: wireCurrent },
    });
    const run = harness(cached);

    run.channel.put(updateNoteTitle(WS, NOTE, 'Mine'));
    await settle();

    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.metadata?.task?.unmetDependsOn).toEqual([NoteId('dep-2')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('clears cached unmet ids when the conflict note removed all dependencies', async () => {
    const cached = note({
      metadata: {
        task: {
          status: 'not_started',
          dependsOn: [NoteId('dep-1')],
          unmetDependsOn: [NoteId('dep-1')],
        },
      },
    });
    const wireCurrent = note({
      title: 'Server',
      rev: 8,
      metadata: { task: { status: 'not_started' } },
    });
    vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      conflict: { current: wireCurrent },
    });
    const run = harness(cached);

    run.channel.put(updateNoteTitle(WS, NOTE, 'Mine'));
    await settle();

    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.metadata?.task?.unmetDependsOn).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rolls an optimistic title back when the daemon rejects it', async () => {
    const updateMetadata = vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const run = harness();

    run.channel.put(updateNoteTitle(WS, NOTE, 'New'));
    await settle();

    expect(updateMetadata.mock.calls).toEqual([[NOTE, { title: 'New' }, 4, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.title).toEqual('Old');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rolls optimistic metadata back when the daemon rejects it', async () => {
    const updateMetadata = vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const run = harness(note({ tags: ['old'] }));

    run.channel.put(updateNote(WS, NOTE, { tags: ['new'] }));
    await settle();

    expect(updateMetadata.mock.calls).toEqual([[NOTE, { tags: ['new'] }, 4, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.tags).toEqual(['old']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('restores the deleted snapshot when the daemon rejects deletion', async () => {
    const remove = vi.spyOn(appClient.notes, 'delete').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const snapshot = note();
    const run = harness(snapshot);

    run.channel.put(deleteNote(WS, NOTE));
    await settle();

    expect(remove.mock.calls).toEqual([[NOTE, 4, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toEqual(snapshot);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels a pending content debounce on workspace cleanup', async () => {
    vi.useFakeTimers();
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({ success: true });
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'never saved'));
    run.channel.put(workspaceUnmounted(WS));
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS);

    expect(setContent.mock.calls).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});
