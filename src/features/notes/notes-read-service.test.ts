import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType, NoteVisibility } from '$shared/types';
import type { Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

// FAKE seam: `appClient.notes.list` is stubbed so event-driven refreshes never
// reach the daemon.
const { notesListMock } = vi.hoisted(() => ({
  notesListMock: vi.fn<(wsId: string) => Promise<Note[]>>(),
}));
vi.mock('$lib/client', () => ({
  appClient: { notes: { list: notesListMock } },
}));

import { store as appStore } from '$store/renderer/store';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import { applyNoteFromEvent, __resetNotesReadServiceForTests } from './notes-read-service';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
    notesListMock.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("applyNoteFromEvent('note:deleted') dispatches applyNoteDeleted without fetching", async () => {
    const ws = 'ws-notes-evt-del';
    const seeded = makeNote('note-del', ws);
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [seeded] }));

    applyNoteFromEvent(ws, 'note-del', 'note:deleted');
    await flush();

    expect(notesListMock).not.toHaveBeenCalled();
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.ids).not.toContain('note-del');
  });

  it("applyNoteFromEvent('note:created') refetches the workspace and dispatches applyNoteCreated for the target note", async () => {
    const ws = 'ws-notes-evt-create';
    // Boot-seeded with an existing note (initialized=true required by applyNoteCreated).
    const existing = makeNote('note-x', ws);
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const fresh = makeNote('note-new', ws, { title: 'New' });
    notesListMock.mockResolvedValueOnce([existing, fresh]);

    applyNoteFromEvent(ws, 'note-new', 'note:created');
    await flush();

    expect(notesListMock).toHaveBeenCalledWith(ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.ids).toContain('note-new');
    expect(wsState?.notes.map['note-new']?.title).toBe('New');
  });

  it("applyNoteFromEvent('note:updated') refetches and dispatches applyNoteUpdated for the target note", async () => {
    const ws = 'ws-notes-evt-update';
    const existing = makeNote('note-u', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const updated = makeNote('note-u', ws, { title: 'New Title' });
    notesListMock.mockResolvedValueOnce([updated]);

    applyNoteFromEvent(ws, 'note-u', 'note:updated');
    await flush();

    expect(notesListMock).toHaveBeenCalledWith(ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-u']?.title).toBe('New Title');
    // notesVersion bumps on applyNoteUpdated.
    expect(wsState?.notesVersion).toBeGreaterThan(0);
  });

  it('an event arriving while a fetch is in flight triggers one trailing refetch', async () => {
    const ws = 'ws-notes-evt-trailing';
    const existing = makeNote('note-t', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const first = deferred<Note[]>();
    notesListMock.mockReturnValueOnce(first.promise);
    notesListMock.mockResolvedValueOnce([makeNote('note-t', ws, { title: 'Final' })]);

    applyNoteFromEvent(ws, 'note-t', 'note:updated');
    // Second event for the same key while the first fetch is still in flight.
    applyNoteFromEvent(ws, 'note-t', 'note:updated');
    expect(notesListMock).toHaveBeenCalledTimes(1);

    first.resolve([makeNote('note-t', ws, { title: 'Intermediate' })]);
    await flush();

    expect(notesListMock).toHaveBeenCalledTimes(2);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-t']?.title).toBe('Final');
  });

  it('N events during an in-flight fetch collapse to a single trailing refetch', async () => {
    const ws = 'ws-notes-evt-collapse';
    const existing = makeNote('note-c', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const first = deferred<Note[]>();
    notesListMock.mockReturnValueOnce(first.promise);
    notesListMock.mockResolvedValue([makeNote('note-c', ws, { title: 'Final' })]);

    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    applyNoteFromEvent(ws, 'note-c', 'note:updated');
    expect(notesListMock).toHaveBeenCalledTimes(1);

    first.resolve([makeNote('note-c', ws, { title: 'Intermediate' })]);
    await flush();

    expect(notesListMock).toHaveBeenCalledTimes(2);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-c']?.title).toBe('Final');
  });

  it('no trailing refetch when no event arrived mid-flight', async () => {
    const ws = 'ws-notes-evt-clean';
    const existing = makeNote('note-cl', ws, { title: 'Old' });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    notesListMock.mockResolvedValue([makeNote('note-cl', ws, { title: 'New' })]);

    applyNoteFromEvent(ws, 'note-cl', 'note:updated');
    await flush();
    await flush();

    expect(notesListMock).toHaveBeenCalledTimes(1);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map['note-cl']?.title).toBe('New');
  });
});
