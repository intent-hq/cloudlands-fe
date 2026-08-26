import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType, NoteVisibility } from '$shared/types';
import type { Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

// FAKE seam: `appClient.notes.get` is stubbed so event-driven refreshes never
// reach the daemon (the event path fetches the single target note, §5.2).
const { notesGetMock } = vi.hoisted(() => ({
  notesGetMock: vi.fn<(noteId: string, wsId?: string) => Promise<Note | null>>(),
}));
vi.mock('$lib/client', () => ({
  appClient: { notes: { get: notesGetMock } },
}));

import { store as appStore } from '$store/renderer/store';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import {
  applyNoteFromEvent,
  ensureNoteContentLoaded,
  __resetNotesReadServiceForTests,
} from './notes-read-service';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeNote(id: string, wsId: string, overrides: Partial<Note> = {}): Note {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(wsId),
    title: `Note ${id}`,
    content: `body-${id}`,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Note;
}

describe('notesReadService (fake seam, real store)', () => {
  beforeAll(() => appStore.init());

  beforeEach(() => {
    __resetNotesReadServiceForTests();
    notesGetMock.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("applyNoteFromEvent('note:deleted') dispatches applyNoteDeleted without fetching", async () => {
    const ws = 'ws-notes-evt-del';
    const seeded = makeNote('note-del', ws);
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [seeded] }));

    applyNoteFromEvent(ws, 'note-del', 'note:deleted');
    await flush();

    expect(notesGetMock).not.toHaveBeenCalled();
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.ids).not.toContain('note-del');
  });

  it("applyNoteFromEvent('note:created') fetches the target note and dispatches applyNoteCreated", async () => {
    const ws = 'ws-notes-evt-create';
    // Boot-seeded with an existing note (initialized=true required by applyNoteCreated).
    const existing = makeNote('note-x', ws);
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const fresh = makeNote('note-new', ws, { title: 'New' });
    notesGetMock.mockResolvedValueOnce(fresh);

    applyNoteFromEvent(ws, 'note-new', 'note:created');
    await flush();

    expect(notesGetMock).toHaveBeenCalledWith('note-new', ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.ids).toContain('note-new');
    expect(wsState?.notes.map['note-new']?.title).toBe('New');
  });

  it("applyNoteFromEvent('note:updated') fetches the target note and dispatches applyNoteUpdated", async () => {
    const ws = 'ws-notes-evt-update';
    const existing = makeNote('note-u', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const updated = makeNote('note-u', ws, { title: 'New Title' });
    notesGetMock.mockResolvedValueOnce(updated);

    applyNoteFromEvent(ws, 'note-u', 'note:updated');
    await flush();

    expect(notesGetMock).toHaveBeenCalledWith('note-u', ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-u']?.title).toBe('New Title');
    // notesVersion bumps on applyNoteUpdated.
    expect(wsState?.notesVersion).toBeGreaterThan(0);
  });

  it('ignores a fetched note that belongs to another workspace', async () => {
    const ws = 'ws-notes-evt-foreign';
    const existing = makeNote('note-f', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    notesGetMock.mockResolvedValueOnce(makeNote('note-f', 'ws-other', { title: 'Foreign' }));

    applyNoteFromEvent(ws, 'note-f', 'note:updated');
    await flush();

    expect(notesGetMock).toHaveBeenCalledWith('note-f', ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-f']?.title).toBe('Old');
  });

  it('an event arriving while a fetch is in flight triggers one trailing refetch', async () => {
    const ws = 'ws-notes-evt-trailing';
    const existing = makeNote('note-t', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const first = deferred<Note | null>();
    notesGetMock.mockReturnValueOnce(first.promise);
    notesGetMock.mockResolvedValueOnce(makeNote('note-t', ws, { title: 'Final' }));

    applyNoteFromEvent(ws, 'note-t', 'note:updated');
    // Second event for the same key while the first fetch is still in flight.
    applyNoteFromEvent(ws, 'note-t', 'note:updated');
    expect(notesGetMock).toHaveBeenCalledTimes(1);

    first.resolve(makeNote('note-t', ws, { title: 'Intermediate' }));
    await flush();

    expect(notesGetMock).toHaveBeenCalledTimes(2);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-t']?.title).toBe('Final');
  });

  it('N events during an in-flight fetch collapse to a single trailing refetch', async () => {
    const ws = 'ws-notes-evt-collapse';
    const existing = makeNote('note-c', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const first = deferred<Note | null>();
    notesGetMock.mockReturnValueOnce(first.promise);
    notesGetMock.mockResolvedValue(makeNote('note-c', ws, { title: 'Final' }));

    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    expect(notesGetMock).toHaveBeenCalledTimes(1);

    first.resolve(makeNote('note-c', ws, { title: 'Intermediate' }));
    await flush();

    expect(notesGetMock).toHaveBeenCalledTimes(2);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-c']?.title).toBe('Final');
  });

  it('no trailing refetch when no event arrived mid-flight', async () => {
    const ws = 'ws-notes-evt-clean';
    const existing = makeNote('note-cl', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    notesGetMock.mockResolvedValue(makeNote('note-cl', ws, { title: 'New' }));

    applyNoteFromEvent(ws, 'note-cl', 'note:updated');
    await flush();
    await flush();

    expect(notesGetMock).toHaveBeenCalledTimes(1);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-cl']?.title).toBe('New');
  });

  it('trailing refetch still runs when the in-flight fetch rejects', async () => {
    const ws = 'ws-notes-evt-reject';
    const existing = makeNote('note-r', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const first = deferred<Note | null>();
    notesGetMock.mockReturnValueOnce(first.promise);
    notesGetMock.mockResolvedValueOnce(makeNote('note-r', ws, { title: 'Final' }));

    applyNoteFromEvent(ws, 'note-r', 'note:updated');
    // Event arrives while the (about to fail) fetch is in flight.
    applyNoteFromEvent(ws, 'note-r', 'note:updated');
    expect(notesGetMock).toHaveBeenCalledTimes(1);

    first.reject(new Error('daemon unavailable'));
    await flush();

    expect(notesGetMock).toHaveBeenCalledTimes(2);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-r']?.title).toBe('Final');
  });

  it('ensureNoteContentLoaded fetches the full note for a stale slim row and upserts it', async () => {
    const ws = 'ws-notes-ensure-stale';
    // Slim-projection row: contentLength says there IS content, content is empty.
    const slim = makeNote('note-s', ws, {
      content: '',
      contentPreview: 'preview',
      contentLength: 42,
    });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));

    const full = makeNote('note-s', ws, { content: 'full body' });
    notesGetMock.mockResolvedValueOnce(full);

    ensureNoteContentLoaded(ws, 'note-s');
    await flush();

    expect(notesGetMock).toHaveBeenCalledWith('note-s', ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-s']?.content).toBe('full body');
  });

  it('ensureNoteContentLoaded is a no-op when the cached row already has content', async () => {
    const ws = 'ws-notes-ensure-full';
    const fullRow = makeNote('note-fu', ws, { content: 'already here' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [fullRow] }));

    ensureNoteContentLoaded(ws, 'note-fu');
    await flush();

    expect(notesGetMock).not.toHaveBeenCalled();
  });

  it('ensureNoteContentLoaded is a no-op for a genuinely empty note (contentLength 0)', async () => {
    const ws = 'ws-notes-ensure-empty';
    const emptyNote = makeNote('note-e', ws, { content: '', contentLength: 0 });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [emptyNote] }));

    ensureNoteContentLoaded(ws, 'note-e');
    await flush();

    expect(notesGetMock).not.toHaveBeenCalled();
  });

  it('concurrent ensureNoteContentLoaded calls coalesce onto one fetch', async () => {
    const ws = 'ws-notes-ensure-coalesce';
    const slim = makeNote('note-co', ws, {
      content: '',
      contentPreview: 'preview',
      contentLength: 10,
    });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [slim] }));

    const first = deferred<Note | null>();
    notesGetMock.mockReturnValueOnce(first.promise);
    notesGetMock.mockResolvedValue(makeNote('note-co', ws, { content: 'body' }));

    ensureNoteContentLoaded(ws, 'note-co');
    ensureNoteContentLoaded(ws, 'note-co');
    // Single-flight: the second call coalesces onto the in-flight fetch
    // (marking it dirty for one trailing refetch) instead of firing its own.
    expect(notesGetMock).toHaveBeenCalledTimes(1);

    first.resolve(makeNote('note-co', ws, { content: 'body' }));
    await flush();
    await flush();

    expect(notesGetMock).toHaveBeenCalledTimes(2);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-co']?.content).toBe('body');
  });
});
