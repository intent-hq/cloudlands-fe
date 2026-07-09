import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentType, NoteVisibility } from "$shared/types";
import type { Note } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";
import { SPEC_NOTE_ID } from "$shared/constants/notes";

// FAKE seam: `appClient.notes.list` is stubbed so the notes-read middleware
// exercises the workspaceMounted → notes.list → loadWorkspaceNotesSucceeded
// wire without a daemon round-trip. Only the read the boot seeder uses is
// stubbed — READ-ONLY.
const { notesListMock } = vi.hoisted(() => ({
  notesListMock: vi.fn<(wsId: string) => Promise<Note[]>>(),
}));
vi.mock("$lib/client", () => ({
  appClient: { notes: { list: notesListMock } },
}));

import { store as appStore } from "$store/renderer/store";
import { workspaceMounted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import {
  applyNoteFromEvent,
  __resetNotesReadServiceForTests,
} from "./notes-read-service";
import {
  clearWorkspaceNotesForWorkspaces,
  loadWorkspaceNotesSucceeded,
} from "$store/renderer/slices/workspace-notes/workspace-notes-slice";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeNote(id: string, wsId: string, overrides: Partial<Note> = {}): Note {
  const now = "2026-01-01T00:00:00.000Z";
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

describe("notesReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());

  beforeEach(() => {
    __resetNotesReadServiceForTests();
    notesListMock.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("workspaceMounted fetches notes for a not-yet-hydrated workspace and selects the spec", async () => {
    const ws = "ws-notes-mount-1";
    appStore.dispatch(clearWorkspaceNotesForWorkspaces([ws]));

    const spec = makeNote(SPEC_NOTE_ID, ws, { title: "Spec" });
    const other = makeNote("note-a", ws);
    notesListMock.mockResolvedValueOnce([spec, other]);

    appStore.dispatch(workspaceMounted(ws));
    await flush();

    expect(notesListMock).toHaveBeenCalledTimes(1);
    expect(notesListMock).toHaveBeenCalledWith(ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.initialized).toBe(true);
    expect(wsState?.notes.ids).toContain(SPEC_NOTE_ID);
    expect(wsState?.selectedNoteId).toBe(SPEC_NOTE_ID);
  });

  it("workspaceMounted is a no-op for a boot-seeded workspace (already initialized)", async () => {
    const ws = "ws-notes-mount-2";
    // Simulate what the boot seeder does: mark initialized with a note.
    const seeded = makeNote("seeded-1", ws);
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [seeded] }));

    appStore.dispatch(workspaceMounted(ws));
    await flush();

    expect(notesListMock).not.toHaveBeenCalled();
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.initialized).toBe(true);
    // Selection isn't touched by the re-mount no-op path.
    expect(wsState?.selectedNoteId).toBeNull();
  });

  it("coalesces rapid workspaceMounted dispatches for the same workspace into a single fetch", async () => {
    const ws = "ws-notes-mount-coalesce";
    appStore.dispatch(clearWorkspaceNotesForWorkspaces([ws]));

    let resolveFetch: (n: Note[]) => void = () => {};
    notesListMock.mockImplementationOnce(
      () => new Promise<Note[]>((resolve) => (resolveFetch = resolve)),
    );

    appStore.dispatch(workspaceMounted(ws));
    appStore.dispatch(workspaceMounted(ws));
    appStore.dispatch(workspaceMounted(ws));
    resolveFetch([]);
    await flush();

    expect(notesListMock).toHaveBeenCalledTimes(1);
  });

  it("applyNoteFromEvent('note:deleted') dispatches applyNoteDeleted without fetching", async () => {
    const ws = "ws-notes-evt-del";
    const seeded = makeNote("note-del", ws);
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [seeded] }));

    applyNoteFromEvent(ws, "note-del", "note:deleted");
    await flush();

    expect(notesListMock).not.toHaveBeenCalled();
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.ids).not.toContain("note-del");
  });

  it("applyNoteFromEvent('note:created') refetches the workspace and dispatches applyNoteCreated for the target note", async () => {
    const ws = "ws-notes-evt-create";
    // Boot-seeded with an existing note (initialized=true required by applyNoteCreated).
    const existing = makeNote("note-x", ws);
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const fresh = makeNote("note-new", ws, { title: "New" });
    notesListMock.mockResolvedValueOnce([existing, fresh]);

    applyNoteFromEvent(ws, "note-new", "note:created");
    await flush();

    expect(notesListMock).toHaveBeenCalledWith(ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.ids).toContain("note-new");
    expect(wsState?.notes.map["note-new"]?.title).toBe("New");
  });

  it("applyNoteFromEvent('note:updated') refetches and dispatches applyNoteUpdated for the target note", async () => {
    const ws = "ws-notes-evt-update";
    const existing = makeNote("note-u", ws, { title: "Old" });
    appStore.dispatch(loadWorkspaceNotesSucceeded([ws], { [ws]: [existing] }));

    const updated = makeNote("note-u", ws, { title: "New Title" });
    notesListMock.mockResolvedValueOnce([updated]);

    applyNoteFromEvent(ws, "note-u", "note:updated");
    await flush();

    expect(notesListMock).toHaveBeenCalledWith(ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    expect(wsState?.notes.map["note-u"]?.title).toBe("New Title");
    // notesVersion bumps on applyNoteUpdated.
    expect(wsState?.notesVersion).toBeGreaterThan(0);
  });

  it("leaves prior notes state intact when the fetch fails", async () => {
    const ws = "ws-notes-fetch-fail";
    appStore.dispatch(clearWorkspaceNotesForWorkspaces([ws]));
    notesListMock.mockRejectedValueOnce(new Error("boom"));

    appStore.dispatch(workspaceMounted(ws));
    await flush();

    expect(notesListMock).toHaveBeenCalledWith(ws);
    const wsState = appStore.state.workspaceNotes.byWorkspaceId[ws];
    // No hydration occurred (initialized stays false / undefined).
    expect(wsState?.initialized ?? false).toBe(false);
  });
});


