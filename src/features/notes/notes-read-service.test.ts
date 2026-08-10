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
});
