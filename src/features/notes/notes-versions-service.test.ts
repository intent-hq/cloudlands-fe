import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthorType, ContentType, NoteVisibility } from "$shared/types";
import type { Note, NoteVersion } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";

// FAKE seam: appClient.notes.listVersions / restoreVersion are stubbed so no
// daemon call happens. The middleware runs against the REAL configured store
// so dispatch → reducer → resulting slice state is exercised end to end.
vi.mock("$lib/client", () => ({
  appClient: {
    notes: {
      listVersions: vi.fn(() => Promise.resolve([] as NoteVersion[])),
      restoreVersion: vi.fn(() => Promise.resolve({ success: true })),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  fetchNoteVersions,
  loadWorkspaceNotesSucceeded,
  restoreNoteVersion,
} from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import {
  selectNoteById,
  selectNoteVersions,
} from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";

const notesApi = appClient.notes as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-versions-1";
const NOTE = "note-versions-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeVersion(v: number, content = `body-${v}`): NoteVersion {
  return {
    versionId: String(v),
    versionNumber: v,
    content,
    title: `T${v}`,
    author: { id: "u", name: "U", type: AuthorType.User },
    createdAt: `2026-01-0${v}T00:00:00.000Z`,
  };
}

function makeNote(overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(NOTE),
    workspaceId: WorkspaceId(WS),
    title: "T",
    content: "body",
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

describe("notesVersionsService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    notesApi.listVersions.mockResolvedValue([] as never);
    notesApi.restoreVersion.mockResolvedValue({ success: true } as never);
  });

  it("fetchNoteVersions calls notes.listVersions and applies the result", async () => {
    const versions = [makeVersion(1), makeVersion(2)];
    notesApi.listVersions.mockResolvedValueOnce(versions as never);

    appStore.dispatch(fetchNoteVersions(WS, NOTE));
    await flush();

    expect(notesApi.listVersions).toHaveBeenCalledWith(WS, NOTE);
    const state = selectNoteVersions.select(appStore.state, WS);
    expect(state?.versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(state?.loading).toBe(false);
    expect(state?.error).toBeNull();
  });

  it("fetchNoteVersions dispatches an error when notes.listVersions throws", async () => {
    notesApi.listVersions.mockRejectedValueOnce(new Error("boom") as never);

    appStore.dispatch(fetchNoteVersions(WS, NOTE));
    await flush();

    const state = selectNoteVersions.select(appStore.state, WS);
    expect(state?.loading).toBe(false);
    expect(state?.error).toBe("boom");
  });

  it("restoreNoteVersion updates the note content and refetches the versions list", async () => {
    const existing = makeNote({ content: "old" });
    appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: [existing] }));
    const restored = makeNote({ content: "restored-body" });
    notesApi.restoreVersion.mockResolvedValueOnce({ success: true, note: restored } as never);
    const refreshed = [makeVersion(1), makeVersion(2), makeVersion(3, "restored-body")];
    notesApi.listVersions.mockResolvedValueOnce(refreshed as never);

    appStore.dispatch(restoreNoteVersion(WS, NOTE, "1"));
    await flush();
    await flush();

    expect(notesApi.restoreVersion).toHaveBeenCalledWith(WS, NOTE, "1");
    expect(notesApi.listVersions).toHaveBeenCalledWith(WS, NOTE);
    expect(selectNoteById.select(appStore.state, WS, NOTE)?.content).toBe("restored-body");
    const state = selectNoteVersions.select(appStore.state, WS);
    expect(state?.versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
  });

  it("restoreNoteVersion leaves state untouched on a failed restore", async () => {
    const existing = makeNote({ content: "keep" });
    appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: [existing] }));
    notesApi.restoreVersion.mockResolvedValueOnce({ success: false, error: "nope" } as never);

    appStore.dispatch(restoreNoteVersion(WS, NOTE, "1"));
    await flush();

    expect(notesApi.listVersions).not.toHaveBeenCalled();
    expect(selectNoteById.select(appStore.state, WS, NOTE)?.content).toBe("keep");
  });
});
