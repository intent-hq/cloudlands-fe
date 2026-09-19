import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType, NoteVisibility } from '$shared/types';
import type { Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

// FAKE seam: appClient.notes.* are stubbed so no mutation reaches the daemon.
// The service runs against the REAL configured store so optimistic dispatch and
// rollback are exercised end to end.
vi.mock('$lib/client', () => ({
  appClient: {
    notes: {
      create: vi.fn(() => Promise.resolve({ success: true })),
      setContent: vi.fn(() => Promise.resolve({ success: true })),
      updateMetadata: vi.fn(() => Promise.resolve({ success: true })),
      delete: vi.fn(() => Promise.resolve({ success: true })),
      list: vi.fn(() => Promise.resolve([] as Note[])),
    },
  },
}));

// FAKE the toast seam so saga-owned conflict/error prompts are asserted without svelte-sonner.
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { store as appStore } from '$store/renderer/store';
import { notesWriteSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-write-saga';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  selectAllNotes,
  selectNoteById,
} from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { createNote, deleteNote, updateNoteTitle } from './notes-write-service';

const notesApi = appClient.notes as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = 'ws-svc-1';
const LOADED_REV = 1;

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(WS),
    title: 'Title',
    content: 'body',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    rev: LOADED_REV,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seed(...notes: Note[]): void {
  appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: notes }));
}

describe('notesWriteService (fake seam, real store)', () => {
  beforeAll(() => {
    appStore.init();
    appStore.runSaga(notesWriteSaga);
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.values(notesApi).forEach((fn) => fn.mockResolvedValue({ success: true } as never));
    notesApi.list.mockResolvedValue([] as never);
  });

  it('updateNoteTitle is optimistic and rolls back on failure', async () => {
    seed(makeNote('n1', { title: 'Old' }));
    notesApi.updateMetadata.mockResolvedValueOnce({ success: false, error: 'no' } as never);

    await updateNoteTitle(WS, 'n1', 'New');
    expect(notesApi.updateMetadata).toHaveBeenCalledWith('n1', { title: 'New' }, LOADED_REV, WS);
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.title).toBe('Old');
    expect(notify.error).toHaveBeenCalledWith(
      'Failed to update note title',
      expect.objectContaining({ description: 'no' }),
    );
  });

  it('deleteNote is optimistic and restores the note on failure', async () => {
    seed(makeNote('n1'));
    notesApi.delete.mockResolvedValueOnce({ success: false, error: 'no' } as never);

    await deleteNote(WS, 'n1');
    expect(notesApi.delete).toHaveBeenCalledWith('n1', LOADED_REV, WS);
    expect(selectNoteById.select(appStore.state, WS, 'n1')).toBeDefined();
    expect(notify.error).toHaveBeenCalledWith(
      'Failed to delete note',
      expect.objectContaining({ description: 'no' }),
    );
  });

  it('createNote forwards to the seam and reconciles via list on success', async () => {
    seed();
    notesApi.list.mockResolvedValueOnce([makeNote('real-1')] as never);

    await createNote(WS, { title: 'Fresh', content: '' });
    expect(notesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, title: 'Fresh', content: '' }),
    );
    expect(notesApi.list).toHaveBeenCalledWith(WS);
  });

  it('retains the optimistic note (no orphan/duplicate) when the post-create refetch fails', async () => {
    seed();
    notesApi.create.mockResolvedValueOnce({ success: true } as never);
    notesApi.list.mockRejectedValueOnce(new Error('refetch boom') as never);

    await expect(createNote(WS, { title: 'Fresh', content: '' })).resolves.toBeUndefined();
    expect(notesApi.list).toHaveBeenCalledWith(WS);

    const notes = selectAllNotes.select(appStore.state, WS);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe('Fresh');
  });

  // ---- §11.4-D: expectedVersion is passed from the stored rev when known ----

  it('passes the stored rev as expectedVersion on a title update', async () => {
    seed(makeNote('n1', { rev: 2 }));

    await updateNoteTitle(WS, 'n1', 'New');
    expect(notesApi.updateMetadata).toHaveBeenCalledWith('n1', { title: 'New' }, 2, WS);
  });

  it('passes the stored rev as expectedVersion on delete', async () => {
    seed(makeNote('n1', { rev: 9 }));

    await deleteNote(WS, 'n1');
    expect(notesApi.delete).toHaveBeenCalledWith('n1', 9, WS);
  });

  // ---- §11.4-D: successful conditional writes advance the stored rev --------
  // The daemon's success responses don't echo the entity, but a conditional
  // write only succeeds when the stored rev equals expectedVersion and every
  // write bumps rev by exactly one — so `sentRev + 1` is authoritative and must
  // land in the store immediately (not after the async subscribe→refetch).

  it('advances the stored rev immediately after a successful title update', async () => {
    seed(makeNote('n1', { rev: 2 }));

    await updateNoteTitle(WS, 'n1', 'New');
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.rev).toBe(3);
  });

  it('reloads to the server title and prompts on a title-update conflict (no rollback)', async () => {
    seed(makeNote('n1', { title: 'Old', rev: 2 }));
    notesApi.updateMetadata.mockResolvedValueOnce({
      success: false,
      conflict: { current: makeNote('n1', { title: 'Server Title', rev: 5 }) },
    } as never);

    await updateNoteTitle(WS, 'n1', 'Mine');

    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.title).toBe('Server Title');
    expect(note?.rev).toBe(5);
    expect(notify.warning).toHaveBeenCalledTimes(1);
  });

  it('preserves cached unmetDependsOn when a conflict note omits the projection', async () => {
    seed(
      makeNote('n1', {
        rev: 3,
        metadata: {
          task: {
            status: 'not_started',
            dependsOn: [NoteId('dep-1')],
            unmetDependsOn: [NoteId('dep-1')],
          },
        },
      }),
    );
    notesApi.updateMetadata.mockResolvedValueOnce({
      success: false,
      conflict: {
        current: makeNote('n1', {
          rev: 8,
          title: 'Server Title',
          metadata: { task: { status: 'not_started', dependsOn: [NoteId('dep-1')] } },
        }),
      },
    } as never);

    await updateNoteTitle(WS, 'n1', 'Mine');

    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.title).toBe('Server Title');
    expect(note?.metadata?.task?.unmetDependsOn).toEqual([NoteId('dep-1')]);
  });

  it('reloads to the server note and prompts on a delete conflict (no stale-snapshot restore)', async () => {
    seed(makeNote('n1', { rev: 9, title: 'Old', content: 'mine' }));
    notesApi.delete.mockResolvedValueOnce({
      success: false,
      conflict: { current: makeNote('n1', { rev: 12, title: 'Server', content: 'server' }) },
    } as never);

    await deleteNote(WS, 'n1');

    const note = selectNoteById.select(appStore.state, WS, 'n1');
    // The note is reloaded from the authoritative server version (rev advances),
    // NOT restored from the pre-delete snapshot (which was rev 9).
    expect(note?.rev).toBe(12);
    expect(note?.title).toBe('Server');
    expect(note?.content).toBe('server');
    expect(notify.warning).toHaveBeenCalledTimes(1);
  });
});
