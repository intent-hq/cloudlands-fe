import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentType, NoteVisibility } from "$shared/types";
import type { Note } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";

// FAKE seam: appClient.notes.* are stubbed so no mutation reaches the daemon.
// The service runs against the REAL configured store so optimistic dispatch and
// rollback are exercised end to end.
vi.mock("$lib/client", () => ({
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
vi.mock("svelte-sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { appClient } from "$lib/client";
import { toast } from "svelte-sonner";
import { store as appStore } from "$store/renderer/store";
import { loadWorkspaceNotesSucceeded } from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import {
  selectAllNotes,
  selectNoteById,
} from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";
import { createNoteRequested } from "$store/renderer/slices/note-read-tracking/note-read-tracking-slice";
import { initializeLayout } from "$store/renderer/slices/panel-layout/panel-layout-slice";
import {
  selectActiveTab,
  selectAllTabs,
} from "$store/renderer/slices/panel-layout/panel-layout-selectors";
import {
  NOTE_CONTENT_SAVE_DEBOUNCE_MS,
  createNote,
  deleteNote,
  updateNoteContent,
  updateNoteTitle,
} from "./notes-write-service";

const notesApi = appClient.notes as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-svc-1";

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(WS),
    title: "Title",
    content: "body",
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seed(...notes: Note[]): void {
  appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: notes }));
}

describe("notesWriteService (fake seam, real store)", () => {
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

  it("applies content optimistically and debounces the setContent save", async () => {
    seed(makeNote("n1"));

    updateNoteContent(WS, "n1", "edited");
    expect(selectNoteById.select(appStore.state, WS, "n1")?.content).toBe("edited");
    expect(notesApi.setContent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(notesApi.setContent).toHaveBeenCalledTimes(1);
    expect(notesApi.setContent).toHaveBeenCalledWith("n1", "edited");
  });

  it("coalesces rapid edits into a single debounced save", async () => {
    seed(makeNote("n1"));

    updateNoteContent(WS, "n1", "a");
    updateNoteContent(WS, "n1", "ab");
    updateNoteContent(WS, "n1", "abc");
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);

    expect(notesApi.setContent).toHaveBeenCalledTimes(1);
    expect(notesApi.setContent).toHaveBeenCalledWith("n1", "abc");
  });

  it("immediate save bypasses the debounce", async () => {
    seed(makeNote("n1"));

    updateNoteContent(WS, "n1", "now", { immediate: true });
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenCalledWith("n1", "now");
  });

  it("refetches to reconcile when a content save fails", async () => {
    seed(makeNote("n1"));
    notesApi.setContent.mockResolvedValueOnce({ success: false, error: "x" } as never);

    updateNoteContent(WS, "n1", "edited", { immediate: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(notesApi.list).toHaveBeenCalledWith(WS);
  });

  it("updateNoteTitle is optimistic and rolls back on failure", async () => {
    seed(makeNote("n1", { title: "Old" }));
    notesApi.updateMetadata.mockResolvedValueOnce({ success: false, error: "no" } as never);

    await updateNoteTitle(WS, "n1", "New");
    expect(notesApi.updateMetadata).toHaveBeenCalledWith("n1", { title: "New" });
    expect(selectNoteById.select(appStore.state, WS, "n1")?.title).toBe("Old");
  });

  it("deleteNote is optimistic and restores the note on failure", async () => {
    seed(makeNote("n1"));
    notesApi.delete.mockResolvedValueOnce({ success: false, error: "no" } as never);

    await deleteNote(WS, "n1");
    expect(notesApi.delete).toHaveBeenCalledWith("n1");
    expect(selectNoteById.select(appStore.state, WS, "n1")).toBeDefined();
  });

  it("createNote forwards to the seam and reconciles via list on success", async () => {
    seed();
    notesApi.list.mockResolvedValueOnce([makeNote("real-1")] as never);

    await createNote(WS, { title: "Fresh", content: "" });
    expect(notesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, title: "Fresh", content: "" }),
    );
    expect(notesApi.list).toHaveBeenCalledWith(WS);
  });

  it("retains the optimistic note (no orphan/duplicate) when the post-create refetch fails", async () => {
    seed();
    notesApi.create.mockResolvedValueOnce({ success: true } as never);
    notesApi.list.mockRejectedValueOnce(new Error("refetch boom") as never);

    await expect(createNote(WS, { title: "Fresh", content: "" })).resolves.toBeUndefined();
    expect(notesApi.list).toHaveBeenCalledWith(WS);

    const notes = selectAllNotes.select(appStore.state, WS);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe("Fresh");
  });

  // ---- §11.4-D: expectedVersion is passed from the stored rev when known ----

  it("passes the stored rev as expectedVersion on a content save", async () => {
    seed(makeNote("n1", { rev: 4 }));

    updateNoteContent(WS, "n1", "edited", { immediate: true });
    await Promise.resolve();
    expect(notesApi.setContent).toHaveBeenCalledWith("n1", "edited", 4);
  });

  it("passes the stored rev as expectedVersion on a title update", async () => {
    seed(makeNote("n1", { rev: 2 }));

    await updateNoteTitle(WS, "n1", "New");
    expect(notesApi.updateMetadata).toHaveBeenCalledWith("n1", { title: "New" }, 2);
  });

  it("passes the stored rev as expectedVersion on delete", async () => {
    seed(makeNote("n1", { rev: 9 }));

    await deleteNote(WS, "n1");
    expect(notesApi.delete).toHaveBeenCalledWith("n1", 9);
  });

  // ---- §11.4-D: conflict outcome → reload-to-latest + prompt ----------------

  it("reloads to the server note and prompts on a content-save conflict (no generic refetch)", async () => {
    seed(makeNote("n1", { rev: 3, content: "mine" }));
    notesApi.setContent.mockResolvedValueOnce({
      success: false,
      conflict: { current: makeNote("n1", { rev: 8, content: "server" }) },
    } as never);

    updateNoteContent(WS, "n1", "mine-edited", { immediate: true });
    await vi.advanceTimersByTimeAsync(1);

    const note = selectNoteById.select(appStore.state, WS, "n1");
    expect(note?.content).toBe("server");
    expect(note?.rev).toBe(8);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    // Conflict path must NOT fall through to the generic reconcile refetch.
    expect(notesApi.list).not.toHaveBeenCalled();
  });

  it("reloads to the server title and prompts on a title-update conflict (no rollback)", async () => {
    seed(makeNote("n1", { title: "Old", rev: 2 }));
    notesApi.updateMetadata.mockResolvedValueOnce({
      success: false,
      conflict: { current: makeNote("n1", { title: "Server Title", rev: 5 }) },
    } as never);

    await updateNoteTitle(WS, "n1", "Mine");

    const note = selectNoteById.select(appStore.state, WS, "n1");
    expect(note?.title).toBe("Server Title");
    expect(note?.rev).toBe(5);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("reloads to the server note and prompts on a delete conflict (no stale-snapshot restore)", async () => {
    seed(makeNote("n1", { rev: 9, title: "Old", content: "mine" }));
    notesApi.delete.mockResolvedValueOnce({
      success: false,
      conflict: { current: makeNote("n1", { rev: 12, title: "Server", content: "server" }) },
    } as never);

    await deleteNote(WS, "n1");

    const note = selectNoteById.select(appStore.state, WS, "n1");
    // The note is reloaded from the authoritative server version (rev advances),
    // NOT restored from the pre-delete snapshot (which was rev 9).
    expect(note?.rev).toBe(12);
    expect(note?.title).toBe("Server");
    expect(note?.content).toBe("server");
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  // ---- createNoteRequested middleware: "Add new note" trigger -----------------
  // The Context-tab "Add new note" button and the command palette "New note"
  // command dispatch `createNoteRequested(workspaceId)`. The notes-write
  // middleware (registered in `src/store/renderer/middleware.ts`) must forward
  // that to `appClient.notes.create` with the legacy defaults and open the new
  // note in the main panel.

  it("dispatching createNoteRequested forwards note.create with the legacy defaults", async () => {
    const wsCreate = "ws-create-note";
    notesApi.list.mockResolvedValueOnce([makeNote("real-new", { workspaceId: WorkspaceId(wsCreate) })] as never);

    appStore.dispatch(createNoteRequested(wsCreate));
    // Flush the fire-and-forget middleware promise (microtasks for the awaited
    // appClient.notes.create + appClient.notes.list resolutions + follow-ups).
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(notesApi.create).toHaveBeenCalledTimes(1);
    expect(notesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: wsCreate,
        title: "New Note",
        content: "",
        tags: [],
      }),
    );
  });

  it("opens the new note as a focused panel-layout tab after createNoteRequested succeeds", async () => {
    const wsCreate = "ws-create-note-open";
    // Seed a focused panel so the openTab reducer has somewhere to place the tab —
    // the sidebar's "Add note" path is exercised against the real panel-layout slice.
    appStore.dispatch(
      initializeLayout(wsCreate, {
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [], activeTabId: null } },
        focusedPanelId: "p1",
      }),
    );
    notesApi.list.mockResolvedValueOnce(
      [makeNote("real-open", { workspaceId: WorkspaceId(wsCreate) })] as never,
    );

    appStore.dispatch(createNoteRequested(wsCreate));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const tabs = selectAllTabs.select(appStore.state, wsCreate);
    const noteTab = tabs.find((t) => t.type === "note" && t.noteId === "real-open");
    expect(noteTab).toBeDefined();
    expect(noteTab?.title).toBe("New Note");
    expect(noteTab?.closable).toBe(true);
    expect(noteTab?.workspaceId).toBe(wsCreate);

    // The new tab is focused (matches the sidebar's openTab path).
    const active = selectActiveTab.select(appStore.state, wsCreate);
    expect(active?.id).toBe(noteTab?.id);
  });

  it("createNoteRequested with a blank workspaceId does not call the seam", async () => {
    appStore.dispatch(createNoteRequested(""));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(notesApi.create).not.toHaveBeenCalled();
  });
});
