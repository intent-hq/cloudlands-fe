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

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { loadWorkspaceNotesSucceeded } from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import { selectNoteById } from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";
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
});
