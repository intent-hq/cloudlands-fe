import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ backendRequest: vi.fn() }));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), warning: vi.fn() },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));

import { appClient } from '$lib/client';
import type { MutationResult } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import type { CommentV2 } from '$features/comments/comment-types-v2';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { commentsReducer, loadCommentsAction } from '../../comments/comments-slice';
import {
  createNoteRequested,
  markNoteRead,
} from '../../note-read-tracking/note-read-tracking-slice';
import { openTab, openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  addOptimisticNote,
  addCommentRequested,
  applyNoteDeleted,
  applyNoteUpdated,
  createNote,
  createNotePersistRequested,
  deleteNote,
  loadWorkspaceNotesSucceeded,
  readNoteRequested,
  resolveCommentRequested,
  updateNote,
  updateNoteContent,
  updateNoteTitle,
  updateNoteTitlePersistRequested,
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import { NoteCapabilityUnknownError } from '$lib/client/live/live-notes-client';
import { rebaseText } from '$lib/notes/text-rebase';
import { daemonTextAt, recordDaemonNote } from './note-daemon-text';
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

function harness(seed: Note | Note[] = note(), comments: CommentV2[] = []) {
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
  let commentState = commentsReducer(undefined, loadCommentsAction(comments));
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    commentState = commentsReducer(commentState, action);
    actions.push(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ workspaceNotes, comments: commentState }) },
    notesWriteSaga,
  );
  return { actions, channel, dispatch, getState: () => workspaceNotes, task };
}

describe('notesWriteSaga', () => {
  // Suite invariant (AC10): every content save for a loaded note forwards a
  // defined rev as expectedVersion. Only the never-loaded LWW test opts out.
  let expectUnloadedSave = false;

  // These suites model a daemon without truncated reads unless a test says otherwise.
  beforeEach(() => {
    vi.spyOn(appClient.notes, 'supportsTruncatedRead').mockResolvedValue(false);
  });

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

  it('does not let a blocked save delay a different note', async () => {
    let resolveFirst!: (result: { success: true }) => void;
    const setContent = vi
      .spyOn(appClient.notes, 'setContent')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true });
    const run = harness([note(), note({ id: NoteId('note-2'), rev: 9 })]);

    run.channel.put(updateNoteContent(WS, NOTE, 'blocked', true));
    await settle();
    run.channel.put(updateNoteContent(WS, 'note-2', 'independent', true));
    await settle();

    expect(setContent.mock.calls).toEqual([
      [NOTE, 'blocked', 4, WS],
      ['note-2', 'independent', 9, WS],
    ]);
    resolveFirst({ success: true });
    await settle();
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
    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
    expect(run.actions.slice(-2)).toEqual([
      loadWorkspaceNotesSucceeded([WS], { [WS]: [note(), created] }),
      addOptimisticNote(WS, created),
    ]);
    expect(run.getState().byWorkspaceId[WS]?.notes.ids.map(String)).toEqual([NOTE, 'note-created']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('opens the note the daemon created, not a concurrently created one (#4780)', async () => {
    const agentNote = note({ id: NoteId('n-agent'), title: 'Agent note', content: '' });
    const mine = note({ id: NoteId('n-mine'), title: 'New Note', content: '' });
    vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true, id: 'n-mine' });
    vi.spyOn(appClient.notes, 'list').mockResolvedValue([note(), agentNote, mine]);
    const run = harness();

    run.channel.put(createNoteRequested(WS, { panelLayoutId: WS, panelId: 'working-panel' }));
    await settle();

    const marked = run.actions.filter((action) => action.type === markNoteRead.type);
    expect(marked).toEqual([markNoteRead(WS, 'n-mine')]);
    const opened = run.actions.filter((action) => action.type === openTab.type) as ReturnType<
      typeof openTab
    >[];
    expect(opened.map((action) => action.payload.tab.noteId)).toEqual(['n-mine']);
    expect(run.actions).toContainEqual(addOptimisticNote(WS, mine));
    expect(run.actions).not.toContainEqual(addOptimisticNote(WS, agentNote));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('resolves createNotePersistRequested to the daemon id even when the relist lags (#4780)', async () => {
    const agentNote = note({ id: NoteId('n-agent'), title: 'Agent note', content: '' });
    vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true, id: 'n-mine' });
    vi.spyOn(appClient.notes, 'list').mockResolvedValue([note(), agentNote]);
    const run = harness();

    const request = createNotePersistRequested(WS, { title: 'Fresh', content: '' });
    run.channel.put(request);
    await settle();

    expect(run.actions).toContainEqual(request.success('n-mine'));
    expect(run.actions).not.toContainEqual(addOptimisticNote(WS, agentNote));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('resolves updateNoteTitlePersistRequested to false when the title save fails (#5777)', async () => {
    vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      error: 'disk full',
    });
    const run = harness();

    const request = updateNoteTitlePersistRequested(WS, NOTE, 'New');
    run.channel.put(request);
    await vi.waitFor(() => expect(run.actions).toContainEqual(request.success(false)));

    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.title).toBe('Old');
    expect(notify.error).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('resolves updateNoteTitlePersistRequested to true when the title save succeeds', async () => {
    vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({ success: true });
    const run = harness();

    const request = updateNoteTitlePersistRequested(WS, NOTE, 'New');
    run.channel.put(request);
    await vi.waitFor(() => expect(run.actions).toContainEqual(request.success(true)));

    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.title).toBe('New');
    expect(notify.error).not.toHaveBeenCalled();
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
    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
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

  describe('truncated-read write guard (§5.2)', () => {
    /** A row the daemon served, as the read path applies and records it. */
    function served(run: ReturnType<typeof harness>, row: Note) {
      recordDaemonNote(WS, row);
      run.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: [row] }));
    }
    /** An event re-read landing while a draft is pending. */
    function reread(run: ReturnType<typeof harness>, row: Note) {
      recordDaemonNote(WS, row);
      run.dispatch(applyNoteUpdated(WS, NOTE, row));
    }
    /** The harness does not feed saga-dispatched actions back; forward the resubmitted save. */
    async function forwardResubmit(run: ReturnType<typeof harness>) {
      let resubmit: ReturnType<typeof updateNoteContent> | undefined;
      await vi.waitFor(() => {
        resubmit = run.actions.find((action) => action.type === updateNoteContent.type) as
          ReturnType<typeof updateNoteContent> | undefined;
        expect(resubmit).toBeDefined();
      });
      if (resubmit) run.channel.put(resubmit);
    }
    const supports = (value: boolean) =>
      vi.spyOn(appClient.notes, 'supportsTruncatedRead').mockResolvedValue(value);

    it('sends the UTF-8 size of the daemon text at the base rev, then of the acknowledged echo', async () => {
      supports(true);
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockResolvedValue({ success: true, noteRev: 5, newContent: 'héllo 😀 more' });
      const run = harness();
      // "héllo 😀": h(1) é(2) llo(3) space(1) 😀(4) = 11 bytes.
      served(run, note({ content: 'héllo 😀' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'héllo 😀 more', true));
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));
      run.channel.put(updateNoteContent(WS, NOTE, 'héllo 😀 more!', true));
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(2));

      expect(setContent.mock.calls).toEqual([
        [NOTE, 'héllo 😀 more', 4, WS, { baseContentBytes: 11 }],
        [NOTE, 'héllo 😀 more!', 5, WS, { baseContentBytes: 16 }],
      ]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it("ignores an editor's re-serialized baseline (comment manager onContentChanged)", async () => {
      supports(true);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: true,
      });
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(
        updateNoteContent(WS, NOTE, '# old body\n\nedited', {
          immediate: true,
          baseRev: 4,
          baseContent: '# old body\n',
        }),
      );
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));

      expect(setContent.mock.calls).toEqual([
        [NOTE, '# old body\n\nedited', 4, WS, { baseContentBytes: 8 }],
      ]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('keeps the daemon base after a failed save, so the next edit lands', async () => {
      supports(true);
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockResolvedValueOnce({ success: false, error: 'network' })
        .mockResolvedValueOnce({ success: true, noteRev: 5, newContent: 'old body!!' });
      vi.spyOn(appClient.notes, 'list').mockResolvedValue([
        note({ content: '', contentPreview: 'old body', contentLength: 8 }),
      ]);
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'old body!', { immediate: true, baseRev: 4 }));
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));
      await settle();
      // Both editors move their baseline to the unsent text; the base stays the daemon's.
      run.channel.put(
        updateNoteContent(WS, NOTE, 'old body!!', {
          immediate: true,
          baseRev: 4,
          baseContent: 'old body!',
        }),
      );
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(2));

      expect(setContent.mock.calls[1]).toEqual([
        NOTE,
        'old body!!',
        4,
        WS,
        { baseContentBytes: 8 },
      ]);
      expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.content).toBe('old body!!');
      run.task.cancel();
      await run.task.toPromise();
    });

    it('sends no baseContentBytes to a daemon without noteTruncatedRead', async () => {
      supports(false);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: true,
      });
      const run = harness();
      served(run, note({ content: 'héllo' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'héllo!', true));
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));

      expect(setContent.mock.calls).toEqual([[NOTE, 'héllo!', 4, WS]]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('rebases the draft onto the re-read note after content-base-mismatch, losing no text', async () => {
      supports(true);
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockResolvedValueOnce({ success: false, error: 'mismatch', contentBaseMismatch: true })
        .mockResolvedValueOnce({ success: true });
      const get = vi
        .spyOn(appClient.notes, 'get')
        .mockResolvedValue(note({ content: 'AGENT old body', rev: 7 }));
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'old body MINE', true));
      await forwardResubmit(run);
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(2));

      expect(get.mock.calls).toEqual([[NOTE, WS, { maxContentBytes: 500_000 }]]);
      expect(setContent.mock.calls[1]).toEqual([
        NOTE,
        'AGENT old body MINE',
        7,
        WS,
        { baseContentBytes: 14 },
      ]);
      expect(notify.warning).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    });

    it('never sends a queued pre-rebase draft after a mismatch, so the agent edit survives', async () => {
      supports(true);
      let refuseFirst!: (result: MutationResult) => void;
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockReturnValueOnce(new Promise((resolve) => (refuseFirst = resolve)))
        .mockResolvedValue({ success: true, noteRev: 7, newContent: 'AGENT\nbody AB' });
      const get = vi
        .spyOn(appClient.notes, 'get')
        .mockResolvedValue(note({ content: 'AGENT\nbody', rev: 6 }));
      const run = harness();
      served(run, note({ content: 'body' }));

      // [body A, rev 4, base 4 bytes] goes out; [body AB] queues behind it.
      run.channel.put(updateNoteContent(WS, NOTE, 'body A', true));
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));
      run.channel.put(updateNoteContent(WS, NOTE, 'body AB', true));
      await settle();
      // An agent edit lands meanwhile; the daemon refuses the first save's base.
      refuseFirst({ success: false, error: 'mismatch', contentBaseMismatch: true });
      await forwardResubmit(run);
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(2));
      await settle();

      expect(setContent.mock.calls).toEqual([
        [NOTE, 'body A', 4, WS, { baseContentBytes: 4 }],
        [NOTE, 'AGENT\nbody AB', 6, WS, { baseContentBytes: 10 }],
      ]);
      expect(setContent.mock.calls.some((call) => call[1] === 'body AB')).toBe(false);
      // The queued draft is dropped outright, not recovered a second time.
      expect(get).toHaveBeenCalledTimes(1);
      expect(notify.warning).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    });

    it('keeps edits typed while the recovery re-read is pending', async () => {
      supports(true);
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockResolvedValueOnce({ success: false, error: 'mismatch', contentBaseMismatch: true })
        .mockResolvedValue({ success: true });
      let finishRead!: (value: Note) => void;
      vi.spyOn(appClient.notes, 'get').mockReturnValue(
        new Promise<Note>((resolve) => (finishRead = resolve)),
      );
      const run = harness();
      served(run, note({ content: 'body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'body A', true));
      await vi.waitFor(() => expect(appClient.notes.get).toHaveBeenCalledTimes(1));
      // The user keeps typing while the note is re-read.
      run.channel.put(updateNoteContent(WS, NOTE, 'body A more', true));
      await settle();
      finishRead(note({ content: 'AGENT\nbody', rev: 6 }));
      await forwardResubmit(run);
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(2));
      await settle();

      expect(setContent.mock.calls).toEqual([
        [NOTE, 'body A', 4, WS, { baseContentBytes: 4 }],
        [NOTE, 'AGENT\nbody A more', 6, WS, { baseContentBytes: 10 }],
      ]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('still guards a save with a known base while the capability is unknown', async () => {
      vi.spyOn(appClient.notes, 'supportsTruncatedRead').mockRejectedValue(
        new NoteCapabilityUnknownError(),
      );
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: true,
      });
      const run = harness();
      served(run, note({ content: 'body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'body!', true));
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));

      expect(setContent.mock.calls).toEqual([[NOTE, 'body!', 4, WS, { baseContentBytes: 4 }]]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('re-reads and rebases instead of sending an unguarded write when the base is unknown', async () => {
      supports(true);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: true,
      });
      const get = vi
        .spyOn(appClient.notes, 'get')
        .mockResolvedValue(note({ content: 'body\nAGENT', rev: 9 }));
      // Rev 4 was never recorded (e.g. aged out of the kept revs).
      const run = harness(note({ content: 'body' }));

      run.channel.put(
        updateNoteContent(WS, NOTE, 'body MINE', {
          immediate: true,
          baseRev: 4,
          baseContent: 'body',
        }),
      );
      await forwardResubmit(run);
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));

      expect(get).toHaveBeenCalledTimes(1);
      expect(setContent.mock.calls).toEqual([
        [NOTE, 'body MINE\nAGENT', 9, WS, { baseContentBytes: 10 }],
      ]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('never resurrects a note deleted while the recovery read is pending', async () => {
      supports(true);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: false,
        error: 'mismatch',
        contentBaseMismatch: true,
      });
      let finishRead!: (value: Note) => void;
      vi.spyOn(appClient.notes, 'get').mockReturnValue(
        new Promise<Note>((resolve) => (finishRead = resolve)),
      );
      const writeText = vi.fn(async () => {});
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'old body MINE', true));
      await vi.waitFor(() => expect(appClient.notes.get).toHaveBeenCalledTimes(1));
      // The note is deleted while the recovery read is pending…
      const deleted = applyNoteDeleted(WS, NOTE);
      run.dispatch(deleted);
      run.channel.put(deleted);
      await settle();
      // …and its late pre-deletion response comes back truncated.
      finishRead(
        note({ content: 'prefix\n', contentTruncated: true, contentBytes: 600_000, rev: 9 }),
      );
      await vi.waitFor(() => expect(notify.warning).toHaveBeenCalledTimes(1));
      await settle();

      expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toBeUndefined();
      expect(daemonTextAt(WS, NOTE, 9)).toBeUndefined();
      expect(setContent).toHaveBeenCalledTimes(1);
      expect(run.actions.some((action) => action.type === updateNoteContent.type)).toBe(false);
      const options = vi.mocked(notify.warning).mock.calls[0][1] as {
        action: { onClick: () => void };
      };
      options.action.onClick();
      expect(writeText).toHaveBeenCalledWith('old body MINE');
      vi.unstubAllGlobals();
      run.task.cancel();
      await run.task.toPromise();
    });

    it('offers the unsaved text when the re-read note is now truncated', async () => {
      supports(true);
      const writeText = vi.fn(async () => {});
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: false,
        error: 'mismatch',
        contentBaseMismatch: true,
      });
      vi.spyOn(appClient.notes, 'get').mockResolvedValue(
        note({ content: 'prefix\n', contentTruncated: true, contentBytes: 600_000, rev: 9 }),
      );
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'old body MINE', true));
      await vi.waitFor(() => expect(notify.warning).toHaveBeenCalledTimes(1));

      expect(setContent).toHaveBeenCalledTimes(1);
      expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toMatchObject({
        content: 'prefix\n',
        contentTruncated: true,
      });
      const options = vi.mocked(notify.warning).mock.calls[0][1] as {
        action: { onClick: () => void };
      };
      options.action.onClick();
      expect(writeText).toHaveBeenCalledWith('old body MINE');
      vi.unstubAllGlobals();
      run.task.cancel();
      await run.task.toPromise();
    });

    it('offers the text instead of looping on a second mismatch', async () => {
      supports(true);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: false,
        error: 'mismatch',
        contentBaseMismatch: true,
      });
      vi.spyOn(appClient.notes, 'get').mockResolvedValue(note({ content: 'fresh', rev: 7 }));
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'old body MINE', true));
      await forwardResubmit(run);
      await vi.waitFor(() => expect(notify.warning).toHaveBeenCalledTimes(1));
      await settle();

      expect(setContent).toHaveBeenCalledTimes(2);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('guards a rich-editor draft with its own base rev after a concurrent agent edit', async () => {
      vi.useFakeTimers();
      supports(true);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: true,
      });
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(
        updateNoteContent(WS, NOTE, 'old body MINE', { baseRev: 4, baseContent: 'old body' }),
      );
      await settle();
      reread(run, note({ content: 'AGENT old body', rev: 5 }));
      await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));

      // The daemon merges diff(rev 4 → draft) onto rev 5; the base is rev 4's text.
      expect(setContent.mock.calls).toEqual([
        [NOTE, 'old body MINE', 4, WS, { baseContentBytes: 8 }],
      ]);
      run.task.cancel();
      await run.task.toPromise();
    });

    /** A daemon that keeps every rev, enforces the guard and merges stale-rev writes. */
    function growingDaemon(initial: string) {
      const enc = new TextEncoder();
      const texts = new Map<number, string>([[4, initial]]);
      let cur = 4;
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
      let first = true;
      const write = async (
        _noteId: string,
        content: string,
        rev?: number,
        _workspaceId?: string,
        options?: { baseContentBytes?: number },
      ) => {
        if (first) {
          first = false;
          await firstGate;
        }
        const exact = rev === undefined || rev === cur;
        const base = exact ? texts.get(cur) : texts.get(rev);
        if (
          options?.baseContentBytes !== undefined &&
          (base === undefined || enc.encode(base).length !== options.baseContentBytes)
        ) {
          return { success: false, error: 'mismatch', contentBaseMismatch: true as const };
        }
        const stored = exact ? content : rebaseText(base ?? '', texts.get(cur) ?? '', content);
        cur += 1;
        texts.set(cur, stored);
        return { success: true, newContent: stored, noteRev: cur };
      };
      const grow = (big: string) => {
        cur += 1;
        texts.set(cur, (texts.get(cur - 1) ?? '') + big);
      };
      return { write, grow, releaseFirst, text: () => texts.get(cur) ?? '', rev: () => cur };
    }

    const BIG = 'X'.repeat(600_000) + '\n';

    it('keeps an agent edit that lands during a draft whose save then fails (probe H)', async () => {
      supports(true);
      const daemon = growingDaemon('body\n');
      let failFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => (failFirst = resolve));
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockImplementationOnce((async () => {
          await firstGate;
          return { success: false, error: 'network' };
        }) as never)
        .mockImplementation(daemon.write as never);
      daemon.releaseFirst();
      vi.spyOn(appClient.notes, 'list').mockRejectedValue(new Error('offline'));
      const run = harness();
      served(run, note({ content: 'body\n' }));

      run.channel.put(
        updateNoteContent(WS, NOTE, 'body MINE\n', {
          immediate: true,
          baseRev: 4,
          baseContent: 'body\n',
        }),
      );
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));
      // An agent edits the note; its event re-read lands while the draft is pending.
      daemon.grow('AGENT\n');
      reread(run, note({ content: daemon.text(), rev: daemon.rev() }));
      failFirst();
      await vi.waitFor(() =>
        expect(run.getState().byWorkspaceId[WS]?.pendingContentByNoteId[NOTE]).toBeFalsy(),
      );
      const row = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
      expect(row).toMatchObject({ content: 'body MINE\n', rev: 4 });

      // The editor takes the row's rev as its base for the next keystroke.
      run.channel.put(
        updateNoteContent(WS, NOTE, 'body MINE more\n', {
          immediate: true,
          baseRev: row?.rev,
          baseContent: 'body MINE\n',
        }),
      );
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(2));
      await settle();

      expect(setContent.mock.calls[1]).toEqual([
        NOTE,
        'body MINE more\n',
        4,
        WS,
        { baseContentBytes: 5 },
      ]);
      expect(daemon.text()).toContain('AGENT');
      expect(daemon.text()).toContain('MINE more');
      run.task.cancel();
      await run.task.toPromise();
    });

    it('never caches an oversized echo while the capability is unknown, and re-reads once it is known', async () => {
      vi.useFakeTimers();
      vi.spyOn(appClient.notes, 'supportsTruncatedRead')
        .mockRejectedValueOnce(new NoteCapabilityUnknownError()) // at save time
        .mockRejectedValueOnce(new NoteCapabilityUnknownError()) // first re-read attempt
        .mockResolvedValue(true); // hello acknowledged
      const merged = 'body MINE\n' + 'x'.repeat(600_000);
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockResolvedValue({ success: true, noteRev: 5, newContent: merged });
      const run = harness();
      served(run, note({ content: 'body\n' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'body MINE\n', true));
      for (let i = 0; i < 10; i++) await settle();
      expect(setContent.mock.calls[0]).toEqual([
        NOTE,
        'body MINE\n',
        4,
        WS,
        { baseContentBytes: 5 },
      ]);
      const row = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
      expect(row).toMatchObject({ contentTruncated: true, rev: 5 });
      expect(row?.content.length).toBeLessThan(500_000);
      expect(
        run.actions.some(
          (action) =>
            (action.payload as { updates?: { content?: string } } | undefined)?.updates?.content ===
            merged,
        ),
      ).toBe(false);
      expect(run.actions.some((action) => action.type === readNoteRequested.type)).toBe(false);

      await vi.runOnlyPendingTimersAsync();
      for (let i = 0; i < 10; i++) await settle();
      expect(run.actions.some((action) => action.type === readNoteRequested.type)).toBe(true);
      run.task.cancel();
      await run.task.toPromise();
    });

    it.each([
      ['the workspace unmounts', () => workspaceUnmounted(WS)],
      ['the note is deleted', () => applyNoteDeleted(WS, NOTE)],
    ])(
      'drops the pending re-read of a grown note when %s before the capability resolves',
      async (_label, cleanup) => {
        vi.useFakeTimers();
        vi.spyOn(appClient.notes, 'supportsTruncatedRead')
          .mockRejectedValueOnce(new NoteCapabilityUnknownError()) // at save time
          .mockRejectedValueOnce(new NoteCapabilityUnknownError()) // first re-read attempt
          .mockResolvedValue(true); // resolves only after cleanup
        vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
          success: true,
          noteRev: 5,
          newContent: 'body MINE\n' + 'x'.repeat(600_000),
        });
        const run = harness();
        served(run, note({ content: 'body\n' }));

        run.channel.put(updateNoteContent(WS, NOTE, 'body MINE\n', true));
        for (let i = 0; i < 10; i++) await settle();
        expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.contentTruncated).toBe(true);

        run.channel.put(cleanup());
        await vi.runOnlyPendingTimersAsync();
        for (let i = 0; i < 10; i++) await settle();
        await vi.runOnlyPendingTimersAsync();
        for (let i = 0; i < 10; i++) await settle();

        expect(run.actions.some((action) => action.type === readNoteRequested.type)).toBe(false);
        run.task.cancel();
        await run.task.toPromise();
      },
    );

    it('switches to the truncated view at the echo rev when the note grew during a save (probe G)', async () => {
      supports(true);
      const daemon = growingDaemon('body\n');
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockImplementation(daemon.write as never);
      const run = harness();
      served(run, note({ content: 'body\n' }));

      run.channel.put(
        updateNoteContent(WS, NOTE, 'body A\n', {
          immediate: true,
          baseRev: 4,
          baseContent: 'body\n',
        }),
      );
      await settle();
      daemon.grow(BIG); // an agent appends 600 KB while the save is pending
      daemon.releaseFirst();
      await vi.waitFor(() =>
        expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.contentTruncated).toBe(true),
      );
      const row = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
      expect(row).toMatchObject({ content: 'body A\n', rev: daemon.rev() });
      expect(row?.contentBytes).toBe(new TextEncoder().encode(daemon.text()).length);

      // The old editor types once more, claiming the echo rev as its base.
      run.channel.put(
        updateNoteContent(WS, NOTE, 'body A typed\n', {
          immediate: true,
          baseRev: row?.rev,
          baseContent: 'body A\n',
        }),
      );
      await vi.waitFor(() => expect(notify.warning).toHaveBeenCalledTimes(1));
      await settle();

      expect(setContent).toHaveBeenCalledTimes(1);
      expect(daemon.text()).toContain(BIG);
      expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.contentTruncated).toBe(true);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('retires queued drafts and offers their text when a superseded echo is over the limit', async () => {
      supports(true);
      const daemon = growingDaemon('body\n');
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockImplementation(daemon.write as never);
      const run = harness();
      served(run, note({ content: 'body\n' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'body A\n', true));
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));
      // Typed while the save is in flight: queued behind it, rebased on its echo.
      run.channel.put(updateNoteContent(WS, NOTE, 'body A more\n', true));
      await settle();
      daemon.grow(BIG);
      daemon.releaseFirst();
      await vi.waitFor(() => expect(notify.warning).toHaveBeenCalledTimes(1));
      await settle();

      expect(setContent).toHaveBeenCalledTimes(1);
      expect(daemon.text()).toContain(BIG);
      const row = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
      expect(row?.contentTruncated).toBe(true);
      expect(row?.content.length).toBeLessThan(500_000);
      expect(run.getState().byWorkspaceId[WS]?.pendingContentByNoteId[NOTE]).toBeFalsy();
      expect(run.actions.some((action) => action.type === readNoteRequested.type)).toBe(true);
      const options = vi.mocked(notify.warning).mock.calls[0][1] as {
        action: { onClick: () => void };
      };
      const writeText = vi.fn(async () => {});
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      options.action.onClick();
      expect(writeText).toHaveBeenCalledWith('body A more\n');
      vi.unstubAllGlobals();
      run.task.cancel();
      await run.task.toPromise();
    });

    it('sends a guarded write when the note grows past the limit during the debounce', async () => {
      vi.useFakeTimers();
      supports(true);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: true,
      });
      const run = harness();
      served(run, note({ content: 'old body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'old body MINE'));
      await settle();
      // An agent grows the note; the event re-read comes back truncated.
      reread(
        run,
        note({ content: 'old body\n', contentTruncated: true, contentBytes: 600_000, rev: 5 }),
      );
      await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(setContent).toHaveBeenCalledTimes(1));

      expect(setContent.mock.calls).toEqual([
        [NOTE, 'old body MINE', 4, WS, { baseContentBytes: 8 }],
      ]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it('never writes a draft into a truncated row, and offers it instead of sending', async () => {
      supports(true);
      const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
        success: true,
      });
      const run = harness();
      served(run, note({ content: 'prefix\n', contentTruncated: true, contentBytes: 600_000 }));

      run.channel.put(updateNoteContent(WS, NOTE, 'prefix edited\n', true));
      await vi.waitFor(() => expect(notify.warning).toHaveBeenCalledTimes(1));

      expect(setContent).not.toHaveBeenCalled();
      expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.content).toBe('prefix\n');
      expect(run.getState().byWorkspaceId[WS]?.pendingContentByNoteId[NOTE]).toBeFalsy();
      run.task.cancel();
      await run.task.toPromise();
    });
  });

  it('keeps a truncated note render-only through a same-rev slim relist, and never saves it', async () => {
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: true,
    });
    const run = harness(
      note({ content: 'prefix\n', contentTruncated: true, contentBytes: 600_000 }),
    );
    // The forced slim hydrate after a reconnect: same rev, no body.
    run.dispatch(
      loadWorkspaceNotesSucceeded([WS], {
        [WS]: [note({ content: '', contentPreview: 'prefix', contentLength: 600_000 })],
      }),
    );
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toMatchObject({
      content: 'prefix\n',
      contentTruncated: true,
    });

    run.channel.put(updateNoteContent(WS, NOTE, 'prefix\n', true));
    await settle();
    expect(setContent).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('relists after creating a note with the slim projection, keeping an open truncated note', async () => {
    const big = note({
      id: NoteId('big'),
      content: 'prefix\n',
      contentTruncated: true,
      contentBytes: 600_000,
      rev: 9,
    });
    vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true });
    const created = note({ id: NoteId('fresh'), title: 'Fresh', content: '', rev: 1 });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([
      note({
        id: NoteId('big'),
        content: '',
        contentPreview: 'prefix',
        contentLength: 600_000,
        rev: 9,
      }),
      created,
    ]);
    const run = harness(big);

    run.channel.put(createNote(WS, { title: 'Fresh', content: '', tags: [] }));
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    await settle();

    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map.big).toMatchObject({
      content: 'prefix\n',
      contentTruncated: true,
      contentBytes: 600_000,
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('re-reads instead of applying a conflict whose current note is over the view limit', async () => {
    const large = note({ title: 'Changed', content: 'x'.repeat(600_000), rev: 9 });
    vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      error: 'conflict',
      conflict: { current: large },
    });
    const run = harness(
      note({ content: 'prefix\n', contentTruncated: true, contentBytes: 600_000 }),
    );

    run.channel.put(updateNoteTitle(WS, NOTE, 'Mine'));
    await vi.waitFor(() =>
      expect(run.actions.some((action) => action.type === readNoteRequested.type)).toBe(true),
    );

    expect(run.actions.filter((action) => action.type === applyNoteUpdated.type)).toEqual([]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.content).not.toHaveLength(600_000);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('never sends a whole-content write for a truncated note read (§5.2)', async () => {
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: true,
    });
    const run = harness(
      note({ content: 'prefix\n', contentTruncated: true, contentBytes: 600_000 }),
    );

    run.channel.put(updateNoteContent(WS, NOTE, 'prefix edited\n', true));
    await settle();

    expect(setContent).not.toHaveBeenCalled();
    expect(run.getState().byWorkspaceId[WS]?.pendingContentByNoteId[NOTE]).toBeFalsy();
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
    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
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

  // ---- Draft rebase onto a superseded echo ----------------------------------
  // "body"@4 is saved as "body first"@4 while the user keeps typing. An agent
  // wrote at rev 5, so the daemon's echo is the merge "AGENT\nbody first"@6.
  // The still-pending draft is rebased onto that echo and sent against rev 6:
  // the daemon's exact-rev path then stores it verbatim. Sending the raw draft
  // with rev 4 would three-way merge "body first" in again ("AGENT\nbody first
  // first plus typing") and a queued undo back to "body" would be swallowed.

  /**
   * Daemon model for the second request, current text "AGENT\nbody first"@6:
   * an exact-rev write replaces; a stale rev 4 three-way merges from "body"
   * (results per the production `three_way_merge` oracle).
   */
  const STALE_REV_MERGE: Record<string, string> = {
    'body first plus typing': 'AGENT\nbody first first plus typing',
    body: 'AGENT\nbody first',
  };
  function daemonAfterAgentEdit(): (_: string, content: string, rev?: number) => Promise<unknown> {
    return (_id, content, rev) =>
      Promise.resolve({
        success: true,
        newContent: rev === 6 ? content : (STALE_REV_MERGE[content] ?? content),
        noteRev: 7,
      });
  }

  for (const [label, draft, rebased] of [
    ['typing', 'body first plus typing', 'AGENT\nbody first plus typing'],
    ['undo', 'body', 'AGENT\nbody'],
  ] as const) {
    it(`rebases a queued ${label} draft onto the superseded echo and sends it against the echo rev`, async () => {
      let resolveFirst!: (result: unknown) => void;
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }) as never,
        )
        .mockImplementation(daemonAfterAgentEdit() as never);
      const run = harness(note({ content: 'body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'body first', true));
      await settle();
      run.channel.put(updateNoteContent(WS, NOTE, draft, true));
      await settle();
      expect(setContent.mock.calls).toEqual([[NOTE, 'body first', 4, WS]]);

      resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
      await settle();
      // The echo is not applied verbatim (it would drop the local edit); the
      // pending draft is rebased onto it and sent against the echo rev.
      expect(setContent.mock.calls).toEqual([
        [NOTE, 'body first', 4, WS],
        [NOTE, rebased, 6, WS],
      ]);
      const current = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
      expect(current?.content).toEqual(rebased);
      expect(current?.rev).toEqual(7);

      // The chain settled: the next edit starts from the in-sync store rev.
      run.channel.put(updateNoteContent(WS, NOTE, `${rebased} more`, true));
      await settle();
      expect(setContent.mock.calls[2]).toEqual([NOTE, `${rebased} more`, 7, WS]);
      run.task.cancel();
      await run.task.toPromise();
    });

    it(`rebases a still-debounced ${label} draft onto the superseded echo`, async () => {
      vi.useFakeTimers();
      let resolveFirst!: (result: unknown) => void;
      const setContent = vi
        .spyOn(appClient.notes, 'setContent')
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }) as never,
        )
        .mockImplementation(daemonAfterAgentEdit() as never);
      const run = harness(note({ content: 'body' }));

      run.channel.put(updateNoteContent(WS, NOTE, 'body first', true));
      await settle();
      run.channel.put(updateNoteContent(WS, NOTE, draft));
      await settle();

      resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
      await settle();
      let current = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
      expect(current?.content).toEqual(rebased);
      expect(current?.rev).toEqual(6);
      expect(setContent.mock.calls).toEqual([[NOTE, 'body first', 4, WS]]);

      await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
      await settle();
      expect(setContent.mock.calls).toEqual([
        [NOTE, 'body first', 4, WS],
        [NOTE, rebased, 6, WS],
      ]);
      current = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
      expect(current?.content).toEqual(rebased);
      expect(current?.rev).toEqual(7);
      run.task.cancel();
      await run.task.toPromise();
    });
  }

  // Mirrors notes-write-service: a refetch that landed a rev NEWER than the
  // superseded echo keeps its content in the store; the draft is still
  // rebased onto the echo and sent against the echo rev.
  it('keeps a newer refetch in the store when a superseded echo lands, and still rebases the draft onto the echo', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: unknown) => void;
    const setContent = vi
      .spyOn(appClient.notes, 'setContent')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementation(daemonAfterAgentEdit() as never);
    const run = harness(note({ content: 'body' }));

    run.channel.put(updateNoteContent(WS, NOTE, 'body first', true));
    await settle();
    run.channel.put(updateNoteContent(WS, NOTE, 'body first plus typing'));
    await settle();
    run.channel.put(
      updateNoteContent(WS, NOTE, 'body first plus typing newest', {
        baseRev: 4,
        baseContent: 'body first plus typing',
      }),
    );
    await settle();

    run.dispatch(
      loadWorkspaceNotesSucceeded([WS], {
        [WS]: [note({ content: 'AGENT\nbody first\nLATER', rev: 8 })],
      }),
    );
    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
    await settle();
    const current = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(current?.content).toEqual('AGENT\nbody first\nLATER');
    expect(current?.rev).toEqual(8);

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    await settle();
    expect(setContent.mock.calls).toEqual([
      [NOTE, 'body first', 4, WS],
      [NOTE, 'AGENT\nbody first plus typing newest', 6, WS],
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
    expect(notify.warning).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(run.actions.filter((action) => action.type === applyNoteUpdated.type)).toEqual([]);
    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
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

  it('serializes a comment rev bump before a content save on the same note', async () => {
    vi.useFakeTimers();
    let resolveAdd!: (value: { success: true; noteRev: number }) => void;
    const add = vi.spyOn(appClient.comments, 'add').mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAdd = resolve;
      }),
    );
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: true,
      newContent: 'draft',
      noteRev: 6,
    });
    const run = harness();
    const optimistic = {
      id: 'comment-1',
      noteId: NOTE,
      workspaceId: WS,
      content: 'review',
    } as CommentV2;
    const request = addCommentRequested(NOTE, optimistic, {
      workspaceId: WS,
      searchContext: 'old body',
      commentTarget: 'old',
      comment: 'review',
      commentId: optimistic.id,
    });

    run.channel.put(request);
    await settle();
    expect(add).toHaveBeenCalledWith(NOTE, expect.objectContaining({ commentId: 'comment-1' }));
    run.channel.put(
      updateNoteContent(WS, NOTE, 'draft', {
        immediate: true,
        baseRev: 4,
        baseContent: 'old body',
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(setContent).not.toHaveBeenCalled();

    resolveAdd({ success: true, noteRev: 5 });
    await expect(request.promise).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(setContent).toHaveBeenCalledWith(NOTE, 'draft', 4, WS);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps the mutation owner alive after comment resolution rejects', async () => {
    mocks.backendRequest.mockRejectedValueOnce(new Error('offline'));
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({ success: true });
    const comment = {
      id: 'comment-1',
      noteId: NOTE,
      workspaceId: WS,
      threadId: 'thread-1',
      content: 'review',
      author: 'User',
      authorType: 'user',
      type: 'comment',
      status: 'open',
      createdAt: NOW,
      updatedAt: NOW,
    } as CommentV2;
    const run = harness(note(), [comment]);
    const request = resolveCommentRequested(WS, NOTE, comment.id);

    run.channel.put(request);
    await expect(request.promise).resolves.toBe(false);

    run.channel.put(updateNoteContent(WS, NOTE, 'saved after rejection', true));
    await settle();
    expect(setContent).toHaveBeenCalledWith(NOTE, 'saved after rejection', 4, WS);
    expect(run.task.isRunning()).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });
});
