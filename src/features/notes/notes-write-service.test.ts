import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
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

// FAKE the toast seam so the conflict prompt is asserted without svelte-sonner.
vi.mock('svelte-sonner', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { appClient } from '$lib/client';
import { toast } from 'svelte-sonner';
import { store as appStore } from '$store/renderer/store';

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
import { runExternalContentUpdateEffect } from '$lib/components/workspace/note-with-comments/external-update-effect';
import {
  NOTE_CONTENT_SAVE_DEBOUNCE_MS,
  createNote,
  deleteNote,
  flushNoteContent,
  hasPendingNoteContent,
  updateNoteContent,
  updateNoteTitle,
} from './notes-write-service';

const notesApi = appClient.notes as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = 'ws-svc-1';
// Every loaded note carries a daemon `rev`; content saves must forward it.
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
  // Suite invariant (AC10): every content save for a loaded note forwards a
  // defined rev as expectedVersion. Only the never-loaded LWW test opts out.
  let expectUnloadedSave = false;

  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    if (!expectUnloadedSave) {
      for (const call of notesApi.setContent.mock.calls) {
        expect(call[2], `setContent(${String(call[0])}) sent no rev`).toEqual(expect.any(Number));
      }
    }
    expectUnloadedSave = false;
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.values(notesApi).forEach((fn) => fn.mockResolvedValue({ success: true } as never));
    notesApi.list.mockResolvedValue([] as never);
  });

  it('applies content optimistically and debounces the setContent save', async () => {
    seed(makeNote('n1'));

    updateNoteContent(WS, 'n1', 'edited');
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.content).toBe('edited');
    expect(notesApi.setContent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(notesApi.setContent).toHaveBeenCalledTimes(1);
    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'edited', LOADED_REV, WS);
  });

  it('coalesces rapid edits into a single debounced save', async () => {
    seed(makeNote('n1'));

    updateNoteContent(WS, 'n1', 'a');
    updateNoteContent(WS, 'n1', 'ab');
    updateNoteContent(WS, 'n1', 'abc');
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);

    expect(notesApi.setContent).toHaveBeenCalledTimes(1);
    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'abc', LOADED_REV, WS);
  });

  it('immediate save bypasses the debounce', async () => {
    seed(makeNote('n1'));

    updateNoteContent(WS, 'n1', 'now', { immediate: true });
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'now', LOADED_REV, WS);
  });

  // Documented LWW fallback: a note that was never loaded has no rev to send,
  // so expectedVersion is omitted (the daemon then writes last-writer-wins).
  it('omits expectedVersion only when the note was never loaded', async () => {
    expectUnloadedSave = true;
    seed();

    updateNoteContent(WS, 'never-loaded', 'edited', { immediate: true });
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenCalledWith('never-loaded', 'edited', undefined, WS);
  });

  // Round-5 regression: debounce state is keyed by `${workspaceId}:${noteId}`,
  // so pending saves for same-id notes in different workspaces (every
  // workspace has a `spec` note) must not clobber each other.
  it('keeps pending saves for same-id notes in different workspaces separate', async () => {
    const WS2 = 'ws-svc-2';
    seed(makeNote('spec'));
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([WS2], {
        [WS2]: [makeNote('spec', { workspaceId: WorkspaceId(WS2) })],
      }),
    );

    updateNoteContent(WS, 'spec', 'ws1 edit');
    updateNoteContent(WS2, 'spec', 'ws2 edit');
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);

    expect(notesApi.setContent).toHaveBeenCalledTimes(2);
    expect(notesApi.setContent).toHaveBeenCalledWith('spec', 'ws1 edit', LOADED_REV, WS);
    expect(notesApi.setContent).toHaveBeenCalledWith('spec', 'ws2 edit', LOADED_REV, WS2);
  });

  // ---- monorepo#533: the unacknowledged-save window is observable -----------
  // hasPendingNoteContent must span BOTH the 800ms debounce window and the
  // in-flight daemon call, so external-update consumers can defer applying
  // refetched content that predates the save.

  it('hasPendingNoteContent is true through the debounce window and the in-flight save', async () => {
    seed(makeNote('n1'));
    let resolveSave!: (v: unknown) => void;
    notesApi.setContent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }) as never,
    );

    expect(hasPendingNoteContent(WS, 'n1')).toBe(false);

    updateNoteContent(WS, 'n1', 'edited');
    expect(hasPendingNoteContent(WS, 'n1')).toBe(true);

    // Debounce elapses → flush starts, save still in flight
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(notesApi.setContent).toHaveBeenCalledTimes(1);
    expect(hasPendingNoteContent(WS, 'n1')).toBe(true);

    resolveSave({ success: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(hasPendingNoteContent(WS, 'n1')).toBe(false);
  });

  it('hasPendingNoteContent clears after an immediate save resolves', async () => {
    seed(makeNote('n1'));

    updateNoteContent(WS, 'n1', 'now', { immediate: true });
    expect(hasPendingNoteContent(WS, 'n1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(hasPendingNoteContent(WS, 'n1')).toBe(false);
  });

  it('hasPendingNoteContent stays true when a newer edit lands while a flush is in flight', async () => {
    seed(makeNote('n1'));
    let resolveSave!: (v: unknown) => void;
    notesApi.setContent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }) as never,
    );

    updateNoteContent(WS, 'n1', 'first', { immediate: true });
    updateNoteContent(WS, 'n1', 'second');

    resolveSave({ success: true });
    await vi.advanceTimersByTimeAsync(1);
    // First save acked, but the second edit is still debounced.
    expect(hasPendingNoteContent(WS, 'n1')).toBe(true);

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(hasPendingNoteContent(WS, 'n1')).toBe(false);
  });

  it('hasPendingNoteContent is scoped per workspace', async () => {
    const WS2 = 'ws-svc-2';
    seed(makeNote('spec'));
    appStore.dispatch(
      loadWorkspaceNotesSucceeded([WS2], {
        [WS2]: [makeNote('spec', { workspaceId: WorkspaceId(WS2) })],
      }),
    );

    updateNoteContent(WS, 'spec', 'ws1 edit');
    expect(hasPendingNoteContent(WS, 'spec')).toBe(true);
    expect(hasPendingNoteContent(WS2, 'spec')).toBe(false);

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(hasPendingNoteContent(WS, 'spec')).toBe(false);
  });

  it('hasPendingNoteContent clears even when the save fails', async () => {
    seed(makeNote('n1'));
    notesApi.setContent.mockResolvedValueOnce({ success: false, error: 'x' } as never);

    updateNoteContent(WS, 'n1', 'edited', { immediate: true });
    expect(hasPendingNoteContent(WS, 'n1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(hasPendingNoteContent(WS, 'n1')).toBe(false);
  });

  it('refetches to reconcile when a content save fails', async () => {
    seed(makeNote('n1'));
    notesApi.setContent.mockResolvedValueOnce({ success: false, error: 'x' } as never);

    updateNoteContent(WS, 'n1', 'edited', { immediate: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(notesApi.list).toHaveBeenCalledWith(WS);
  });

  it('surfaces the daemon error via toast.error when a content save fails (non-conflict)', async () => {
    seed(makeNote('n1'));
    notesApi.setContent.mockResolvedValueOnce({ success: false, error: 'boom' } as never);

    updateNoteContent(WS, 'n1', 'edited', { immediate: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(toast.error).toHaveBeenCalledWith(
      'Failed to save note',
      expect.objectContaining({ description: 'boom' }),
    );
  });

  it('updateNoteTitle is optimistic and rolls back on failure', async () => {
    seed(makeNote('n1', { title: 'Old' }));
    notesApi.updateMetadata.mockResolvedValueOnce({ success: false, error: 'no' } as never);

    await updateNoteTitle(WS, 'n1', 'New');
    expect(notesApi.updateMetadata).toHaveBeenCalledWith('n1', { title: 'New' }, LOADED_REV, WS);
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.title).toBe('Old');
    expect(toast.error).toHaveBeenCalledWith(
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
    expect(toast.error).toHaveBeenCalledWith(
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

  it('passes the stored rev as expectedVersion on a content save', async () => {
    seed(makeNote('n1', { rev: 4 }));

    updateNoteContent(WS, 'n1', 'edited', { immediate: true });
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'edited', 4, WS);
  });

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

  it('advances the stored rev immediately after a successful content save', async () => {
    seed(makeNote('n1', { rev: 4 }));

    updateNoteContent(WS, 'n1', 'edited', { immediate: true });
    await vi.advanceTimersByTimeAsync(1);

    expect(selectNoteById.select(appStore.state, WS, 'n1')?.rev).toBe(5);
  });

  it('advances the stored rev immediately after a successful title update', async () => {
    seed(makeNote('n1', { rev: 2 }));

    await updateNoteTitle(WS, 'n1', 'New');
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.rev).toBe(3);
  });

  it('never regresses a newer rev already landed by a refetch', async () => {
    seed(makeNote('n1', { rev: 4 }));
    notesApi.setContent.mockImplementationOnce(async () => {
      // A subscribe→refetch lands a newer server rev while the save is in flight.
      seed(makeNote('n1', { rev: 9, content: 'refetched' }));
      return { success: true };
    });

    updateNoteContent(WS, 'n1', 'edited', { immediate: true });
    await vi.advanceTimersByTimeAsync(1);

    expect(selectNoteById.select(appStore.state, WS, 'n1')?.rev).toBe(9);
  });

  // ---- §11.4-D: content-save-then-rename race (stale-rev regression) ---------
  // Repro: type (debounced save) → immediately rename. The rename must await the
  // in-flight save and read the advanced rev — both changes apply, no conflict.

  it('applies content-save-then-rename without a conflict (mock daemon gates on expectedVersion)', async () => {
    seed(makeNote('n1', { rev: 3, title: 'Old', content: 'body' }));

    // Stateful daemon-conditional mock (§11.4-D): reject with -32005-shaped
    // conflict when expectedVersion mismatches the server rev, else bump it.
    let serverRev = 3;
    const conflictResult = () => ({
      success: false,
      error: 'conflict',
      conflict: { current: makeNote('n1', { rev: serverRev }) },
    });
    notesApi.setContent.mockImplementation((_id: string, _c: string, expectedVersion?: number) => {
      if (expectedVersion !== serverRev) return Promise.resolve(conflictResult());
      serverRev += 1;
      return Promise.resolve({ success: true });
    });
    notesApi.updateMetadata.mockImplementation(
      (_id: string, _m: unknown, expectedVersion?: number) => {
        if (expectedVersion !== serverRev) return Promise.resolve(conflictResult());
        serverRev += 1;
        return Promise.resolve({ success: true });
      },
    );

    updateNoteContent(WS, 'n1', 'typed content', { immediate: true });
    // Rename issued while the content save is still in flight (the race window).
    await updateNoteTitle(WS, 'n1', 'Renamed');
    await vi.advanceTimersByTimeAsync(1);

    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'typed content', 3, WS);
    // The rename waited for the save and read the advanced rev — not the stale 3.
    expect(notesApi.updateMetadata).toHaveBeenCalledWith('n1', { title: 'Renamed' }, 4, WS);

    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.title).toBe('Renamed');
    expect(note?.content).toBe('typed content');
    expect(note?.rev).toBe(5);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(notesApi.list).not.toHaveBeenCalled();
  });

  // ---- daemon merged response is the authoritative local state --------------
  // The daemon merges a content save against concurrent edits and echoes the
  // merged `newContent` plus (on newer daemons) the post-write `rev`.

  it('applies newContent and the echoed rev from a successful content save', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    notesApi.setContent.mockResolvedValueOnce({
      success: true,
      newContent: 'merged: mine + agent',
      noteRev: 7,
    } as never);

    updateNoteContent(WS, 'n1', 'mine', { immediate: true });
    await vi.advanceTimersByTimeAsync(1);

    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('merged: mine + agent');
    expect(note?.rev).toBe(7);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(notesApi.list).not.toHaveBeenCalled();
  });

  it('falls back to sentRev + 1 when the response carries newContent but no rev (older daemon)', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    notesApi.setContent.mockResolvedValueOnce({ success: true, newContent: 'merged' } as never);

    updateNoteContent(WS, 'n1', 'mine', { immediate: true });
    await vi.advanceTimersByTimeAsync(1);

    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('merged');
    expect(note?.rev).toBe(5);
  });

  it('carries a newer local edit onto the merged echo of an older save instead of dropping either', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveSave!: (v: unknown) => void;
    notesApi.setContent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }) as never,
    );

    updateNoteContent(WS, 'n1', 'first', { immediate: true });
    // A keystroke lands while the first save is in flight.
    updateNoteContent(WS, 'n1', 'first+more');
    resolveSave({ success: true, newContent: 'first (merged)', noteRev: 5 });
    await vi.advanceTimersByTimeAsync(1);

    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('first+more (merged)');
    expect(note?.rev).toBe(5);
  });

  // The echo is authoritative even when its text equals what was sent: a
  // refetch that landed older text (and an intermediate rev) during the
  // round-trip must not win over the daemon's post-write state.
  it('applies an echo equal to the sent content over an older refetch that landed in flight', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveSave!: (v: unknown) => void;
    notesApi.setContent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }) as never,
    );

    updateNoteContent(WS, 'n1', 'mine');
    const flushed = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'mine', 4, WS);

    seed(makeNote('n1', { rev: 5, content: 'refetched older content' }));
    resolveSave({ success: true, newContent: 'mine', noteRev: 6 });

    await expect(flushed).resolves.toEqual({ content: 'mine', rev: 6 });
    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('mine');
    expect(note?.rev).toBe(6);
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

  it('rebases a queued draft onto the superseded echo and sends it against the echo rev', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementationOnce(daemonAfterAgentEdit() as never);

    updateNoteContent(WS, 'n1', 'body first');
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenLastCalledWith('n1', 'body first', 4, WS);
    updateNoteContent(WS, 'n1', 'body first plus typing');
    const second = flushNoteContent(WS, 'n1');

    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
    // The echo is not applied verbatim (it would drop the typing); the pending
    // draft is rebased onto it and that is what the store now shows.
    await expect(first).resolves.toEqual({ content: 'AGENT\nbody first plus typing', rev: 6 });
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.content).toBe(
      'AGENT\nbody first plus typing',
    );

    await expect(second).resolves.toEqual({ content: 'AGENT\nbody first plus typing', rev: 7 });
    expect(notesApi.setContent).toHaveBeenLastCalledWith(
      'n1',
      'AGENT\nbody first plus typing',
      6,
      WS,
    );
    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('AGENT\nbody first plus typing');
    expect(note?.rev).toBe(7);
    expect(notesApi.setContent).toHaveBeenCalledTimes(2);

    // The chain settled: the next edit starts from the in-sync store rev.
    updateNoteContent(WS, 'n1', 'AGENT\nbody first plus typing more', { immediate: true });
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenLastCalledWith(
      'n1',
      'AGENT\nbody first plus typing more',
      7,
      WS,
    );
  });

  // A refetch that landed a rev NEWER than the superseded echo holds daemon
  // state the editor has not applied yet. The rebased draft must not replace
  // it in the store (the newer rev would then name the older text); it is
  // still rebased onto the echo and sent against the echo rev so the daemon
  // merges the newer change in. The flush resolves with that rebased draft —
  // not the refetch — so the editor keeps the pending edit rather than being
  // reset to a text that lacks it (PR #2404 re-verification: the reset made
  // the next save an exact write that deleted the agent's text).
  it('keeps a newer refetch in the store when a superseded echo lands, and resolves the draft rebased onto the echo', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementationOnce(daemonAfterAgentEdit() as never);

    updateNoteContent(WS, 'n1', 'body first');
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    updateNoteContent(WS, 'n1', 'body first plus typing');

    seed(makeNote('n1', { rev: 8, content: 'AGENT\nbody first\nLATER' }));
    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });

    await expect(first).resolves.toEqual({ content: 'AGENT\nbody first plus typing', rev: 6 });
    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('AGENT\nbody first\nLATER');
    expect(note?.rev).toBe(8);

    await flushNoteContent(WS, 'n1');
    expect(notesApi.setContent).toHaveBeenLastCalledWith(
      'n1',
      'AGENT\nbody first plus typing',
      6,
      WS,
    );
  });

  // ---- Caller-supplied draft base content ------------------------------------
  // The pending draft was rebased onto an echo (gaining "AGENT") before the
  // editor showed it; the user's next keystroke is typed on the pre-rebase
  // text. Relative to the rebased draft that text reads as deleting AGENT, so
  // the caller names the text it typed on and its edit is replayed instead.
  it('replays a draft typed on the pre-rebase text onto the rebased pending draft', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementation(((_id: string, content: string, rev: number) =>
        Promise.resolve({ success: true, newContent: content, noteRev: rev + 1 })) as never);

    updateNoteContent(WS, 'n1', 'body first', { baseContent: 'body' });
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    updateNoteContent(WS, 'n1', 'body first plus typing', { baseContent: 'body first' });
    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
    await first;
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.content).toBe(
      'AGENT\nbody first plus typing',
    );

    updateNoteContent(WS, 'n1', 'body first plus typing after', {
      baseContent: 'body first plus typing',
    });
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.content).toBe(
      'AGENT\nbody first plus typing after',
    );
    await flushNoteContent(WS, 'n1');
    expect(notesApi.setContent).toHaveBeenLastCalledWith(
      'n1',
      'AGENT\nbody first plus typing after',
      6,
      WS,
    );
  });

  it('takes a draft without base content as typed on the rebased pending draft', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementation(((_id: string, content: string, rev: number) =>
        Promise.resolve({ success: true, newContent: content, noteRev: rev + 1 })) as never);

    updateNoteContent(WS, 'n1', 'body first');
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    updateNoteContent(WS, 'n1', 'body first plus typing');
    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
    await first;

    updateNoteContent(WS, 'n1', 'AGENT\nbody first plus typing after');
    await flushNoteContent(WS, 'n1');
    expect(notesApi.setContent).toHaveBeenLastCalledWith(
      'n1',
      'AGENT\nbody first plus typing after',
      6,
      WS,
    );
  });

  // ---- Caller-supplied draft base rev ---------------------------------------
  // The editor loaded "body"@4 and the user typed "body local" before the
  // component's save debounce fired. An agent's note.add then landed
  // "AGENT\nbody"@5 in the store through the note:updated refetch, and only
  // after that was the draft staged. The save must name rev 4 — the text the
  // draft was derived from — so the daemon three-way merges from "body" and
  // keeps both edits. Reading the store rev at staging (5) made it an exact
  // write that deleted the agent's block (observed live on a real stack).

  /**
   * Daemon model, current text "AGENT\nbody"@5: an exact-rev write replaces;
   * a stale rev 4 three-way merges from "body" (per the production
   * `three_way_merge` oracle).
   */
  function daemonAfterAgentAdd(): (_: string, content: string, rev?: number) => Promise<unknown> {
    const staleRevMerge: Record<string, string> = { 'body local': 'AGENT\nbody local' };
    return (_id, content, rev) =>
      Promise.resolve({
        success: true,
        newContent: rev === 5 ? content : (staleRevMerge[content] ?? content),
        noteRev: 6,
      });
  }

  it('sends the caller base rev, not the refetched store rev, on the first staging of a draft', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    seed(makeNote('n1', { rev: 5, content: 'AGENT\nbody' }));
    notesApi.setContent.mockImplementationOnce(daemonAfterAgentAdd() as never);

    updateNoteContent(WS, 'n1', 'body local', { baseRev: 4 });
    const applied = await flushNoteContent(WS, 'n1');

    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'body local', 4, WS);
    expect(applied).toEqual({ content: 'AGENT\nbody local', rev: 6 });
    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('AGENT\nbody local');
    expect(note?.rev).toBe(6);
  });

  it('without a caller base rev the refetched store rev is sent and the daemon overwrites (exact write)', async () => {
    seed(makeNote('n1', { rev: 5, content: 'AGENT\nbody' }));
    notesApi.setContent.mockImplementationOnce(daemonAfterAgentAdd() as never);

    updateNoteContent(WS, 'n1', 'body local');
    const applied = await flushNoteContent(WS, 'n1');

    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'body local', 5, WS);
    expect(applied).toEqual({ content: 'body local', rev: 6 });
  });

  it('a chain already under way keeps the base it was rebased onto over a later caller base rev', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementationOnce(daemonAfterAgentEdit() as never);

    updateNoteContent(WS, 'n1', 'body first', { baseRev: 4 });
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenLastCalledWith('n1', 'body first', 4, WS);

    updateNoteContent(WS, 'n1', 'body first plus typing', { baseRev: 4 });
    const second = flushNoteContent(WS, 'n1');
    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
    await first;
    await second;

    expect(notesApi.setContent).toHaveBeenLastCalledWith(
      'n1',
      'AGENT\nbody first plus typing',
      6,
      WS,
    );
  });

  it('rebases a queued undo onto the superseded echo instead of replaying the undone text', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementationOnce(daemonAfterAgentEdit() as never);

    updateNoteContent(WS, 'n1', 'body first');
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    updateNoteContent(WS, 'n1', 'body');
    const second = flushNoteContent(WS, 'n1');

    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
    await expect(first).resolves.toEqual({ content: 'AGENT\nbody', rev: 6 });

    await expect(second).resolves.toEqual({ content: 'AGENT\nbody', rev: 7 });
    expect(notesApi.setContent).toHaveBeenLastCalledWith('n1', 'AGENT\nbody', 6, WS);
    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('AGENT\nbody');
    expect(note?.rev).toBe(7);
  });

  it('rebases a still-debounced undo onto the superseded echo', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementationOnce(daemonAfterAgentEdit() as never);

    updateNoteContent(WS, 'n1', 'body first');
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    updateNoteContent(WS, 'n1', 'body');
    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });
    await expect(first).resolves.toEqual({ content: 'AGENT\nbody', rev: 6 });
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.content).toBe('AGENT\nbody');

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(notesApi.setContent).toHaveBeenLastCalledWith('n1', 'AGENT\nbody', 6, WS);
    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('AGENT\nbody');
    expect(note?.rev).toBe(7);
  });

  // ---- §11.4-D: content saves no longer route to the conflict prompt --------
  // A `conflict` result on a content save is treated as a generic failure
  // (error toast + reconcile refetch) — never the "note changed" reload+toast.

  it('treats a conflict result on a content save as a generic failure (no reload prompt)', async () => {
    seed(makeNote('n1', { rev: 3, content: 'mine' }));
    notesApi.setContent.mockResolvedValueOnce({
      success: false,
      error: 'conflict',
      conflict: { current: makeNote('n1', { rev: 8, content: 'server' }) },
    } as never);
    notesApi.list.mockResolvedValueOnce([
      makeNote('n1', { rev: 9, content: 'refetched' }),
    ] as never);

    updateNoteContent(WS, 'n1', 'mine-edited', { immediate: true });
    await vi.advanceTimersByTimeAsync(1);

    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Failed to save note',
      expect.objectContaining({ description: 'conflict' }),
    );
    // The conflict entity is NOT applied directly; the generic refetch reconciles.
    expect(notesApi.list).toHaveBeenCalledWith(WS);
    const note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('refetched');
    expect(note?.rev).toBe(9);
  });

  // ---- flushNoteContent: immediate flush that resolves with the applied result

  it('flushNoteContent flushes a debounced save immediately and resolves with the applied content', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    notesApi.setContent.mockResolvedValueOnce({
      success: true,
      newContent: 'merged',
      noteRev: 9,
    } as never);

    updateNoteContent(WS, 'n1', 'edited');
    expect(notesApi.setContent).not.toHaveBeenCalled();

    const flushed = flushNoteContent(WS, 'n1');
    // No debounce wait: the save is issued synchronously by the flush.
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenCalledWith('n1', 'edited', 4, WS);

    await expect(flushed).resolves.toEqual({ content: 'merged', rev: 9 });
    expect(selectNoteById.select(appStore.state, WS, 'n1')?.content).toBe('merged');
    expect(hasPendingNoteContent(WS, 'n1')).toBe(false);

    // The debounce timer was cleared: nothing saves again.
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(notesApi.setContent).toHaveBeenCalledTimes(1);
  });

  // AppliedNoteContent is "what the store holds now": when a newer debounced
  // edit superseded the echo, the result reports that newer text rebased onto
  // the echo, not the merge of the older text that was not applied verbatim.
  it('flushNoteContent resolves with the rebased draft when a newer edit is still debounced', async () => {
    seed(makeNote('n1', { rev: 4, content: 'body' }));
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockImplementationOnce(daemonAfterAgentEdit() as never);

    updateNoteContent(WS, 'n1', 'body first');
    const first = flushNoteContent(WS, 'n1');
    await Promise.resolve();
    updateNoteContent(WS, 'n1', 'body first plus typing');
    resolveFirst({ success: true, newContent: 'AGENT\nbody first', noteRev: 6 });

    const applied = await first;
    let note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('AGENT\nbody first plus typing');
    expect(applied).toEqual({ content: note?.content, rev: 6 });

    // The superseding edit saves on its own, rebased, against the echo rev.
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(notesApi.setContent).toHaveBeenLastCalledWith(
      'n1',
      'AGENT\nbody first plus typing',
      6,
      WS,
    );
    note = selectNoteById.select(appStore.state, WS, 'n1');
    expect(note?.content).toBe('AGENT\nbody first plus typing');
    expect(note?.rev).toBe(7);
  });

  it('flushNoteContent resolves undefined when nothing is pending', async () => {
    seed(makeNote('n1'));

    await expect(flushNoteContent(WS, 'n1')).resolves.toBeUndefined();
    expect(notesApi.setContent).not.toHaveBeenCalled();
  });

  it('flushNoteContent resolves undefined when the save fails', async () => {
    seed(makeNote('n1'));
    notesApi.setContent.mockResolvedValueOnce({ success: false, error: 'boom' } as never);

    updateNoteContent(WS, 'n1', 'edited');
    await expect(flushNoteContent(WS, 'n1')).resolves.toBeUndefined();
  });

  // ---- §11.4-D: metadata/delete conflicts still reload-to-latest + prompt ---

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
    expect(toast.warning).toHaveBeenCalledTimes(1);
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
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

// The editor's external-update pipeline chained to the REAL service: what the
// flush resolves with is what the editor renders, with unsaved keystrokes
// folded on top.
describe('notesWriteService chained to the editor external-update effect', () => {
  const NOTE = 'n';

  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.values(notesApi).forEach((fn) => fn.mockResolvedValue({ success: true } as never));
    notesApi.list.mockResolvedValue([] as never);
  });

  // Regression (PR #2404 re-verification): a refetch landed rev 8 while the
  // first save was in flight and a second draft was staged. The superseded
  // echo (rev 6) then arrived. The store must keep the rev-8 text, yet the
  // editor must keep the echoed AGENT text AND the staged "plus typing" AND
  // the unstaged "newest" — and the next save must carry all of them against
  // the echo rev, so the daemon merges the rev-8 change (LATER) in instead of
  // treating the draft as an exact write that deletes it.
  it('retains staged and unstaged typing in the editor when a superseded echo lands after a newer refetch', async () => {
    seed(makeNote(NOTE, { rev: 4, content: 'body' }));
    const editor = new Editor({ extensions: [StarterKit], content: '<p>body first</p>' });
    let resolveFirst!: (v: unknown) => void;
    notesApi.setContent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      // The daemon three-way merges a rev-6 draft with its rev-8 change.
      .mockImplementation(((_id: string, content: string, rev: number) =>
        Promise.resolve({
          success: true,
          newContent: rev === 6 ? content.replace('newest', 'newest LATER') : content,
          noteRev: 9,
        })) as never);
    updateNoteContent(WS, NOTE, 'body first');
    let last = 'body first';
    let edited = true;
    // The refetch that triggers the pipeline while the first save is pending.
    seed(makeNote(NOTE, { rev: 5, content: 'AGENT body' }));
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const completion = runExternalContentUpdateEffect({
      updateVersion: 999,
      getEditor: () => editor,
      getIsInitialized: () => true,
      getHasPendingNoteContent: () => hasPendingNoteContent(WS, NOTE),
      flushNoteContent,
      getCurrentNoteContent: () => selectNoteById.select(appStore.state, WS, NOTE)?.content ?? '',
      getLastKnownContent: () => last,
      setLastKnownContent: (value) => {
        last = value;
      },
      getHasUserEditedSinceLastSave: () => edited,
      setHasUserEditedSinceLastSave: (value) => {
        edited = value;
      },
      getIsRestorePending: () => false,
      getWorkspaceId: () => WS,
      getNoteId: () => NOTE,
      getCommentManager: () => null,
      processMarkdownToHTML: async (text) => `<p>${text}</p>`,
      processHTMLToMarkdown: () => editor.getText(),
      logger,
    });
    await Promise.resolve();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' plus typing');
    updateNoteContent(WS, NOTE, 'body first plus typing');
    last = 'body first plus typing';
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' newest');
    seed(makeNote(NOTE, { rev: 8, content: 'AGENT body first LATER' }));
    resolveFirst({ success: true, newContent: 'AGENT body first', noteRev: 6 });
    try {
      await completion;
      expect(selectNoteById.select(appStore.state, WS, NOTE)?.content).toBe(
        'AGENT body first LATER',
      );
      expect(editor.getText()).toBe('AGENT body first plus typing newest');

      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' after');
      updateNoteContent(WS, NOTE, editor.getText());
      await flushNoteContent(WS, NOTE);
      expect(notesApi.setContent).toHaveBeenLastCalledWith(
        NOTE,
        'AGENT body first plus typing newest after',
        6,
        WS,
      );
      expect(selectNoteById.select(appStore.state, WS, NOTE)).toMatchObject({
        content: 'AGENT body first plus typing newest LATER after',
        rev: 9,
      });
    } finally {
      await flushNoteContent(WS, NOTE);
      editor.destroy();
    }
  });
});
