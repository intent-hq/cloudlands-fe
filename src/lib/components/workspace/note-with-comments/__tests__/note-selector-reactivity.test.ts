/**
 * Regression test: selectNoteById must react to noteId changes via writable stores.
 *
 * Before the fix, NoteWithComments created the selector with static args at init time:
 *   const currentNote$ = selectNoteById(workspace.id, noteId);
 * If noteId changed (note switch without remount), the selector kept returning the old note.
 *
 * The fix passes writable stores so the selector re-evaluates when noteId changes.
 */
import {
  describe,
  it,
  expect,
} from "vitest";
import {
  get,
  writable,
} from "svelte/store";
import { init } from "$lib/store/init";
import { selectNoteById } from "$lib/store/slices/workspace-notes/workspace-notes-selectors";
import { loadWorkspaceNotesSucceeded } from "$lib/store/slices/workspace-notes/workspace-notes-slice";
import {
  ContentType,
  NoteVisibility,
  type Note,
} from "$shared/types";

const WS_1 = "ws-1";

function mockNote(id: string, workspaceId = WS_1): Note {
  return {
    id: id as Note["id"],
    workspaceId: workspaceId as Note["workspaceId"],
    title: `Note ${id}`,
    content: `Content for ${id}`,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
}

describe("selectNoteById reactivity with writable store args", () => {
  it("returns the correct note when noteId writable store changes", () => {
    const { store } = init();

    // Load two notes into the store
    store.dispatch(
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote("note-a"), mockNote("note-b")],
      }),
    );

    // Create writable stores mirroring the pattern used in NoteWithComments
    const workspaceIdStore = writable(WS_1);
    const noteIdStore = writable("note-a");

    // Create selector at "init time" with writable stores
    const readable$ = selectNoteById.withStore(store)(workspaceIdStore, noteIdStore);

    // Initially should resolve to note-a
    const noteA = get(readable$);
    expect(noteA).toBeDefined();
    expect(noteA!.id).toBe("note-a");
    expect(noteA!.content).toBe("Content for note-a");

    // Switch noteId — simulates navigating to a different note without remounting
    noteIdStore.set("note-b");

    // The readable must now return note-b
    const noteB = get(readable$);
    expect(noteB).toBeDefined();
    expect(noteB!.id).toBe("note-b");
    expect(noteB!.content).toBe("Content for note-b");
  });

  it("returns undefined when noteId writable is set to a non-existent note", () => {
    const { store } = init();

    store.dispatch(
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote("note-a")],
      }),
    );

    const workspaceIdStore = writable(WS_1);
    const noteIdStore = writable("note-a");
    const readable$ = selectNoteById.withStore(store)(workspaceIdStore, noteIdStore);

    expect(get(readable$)?.id).toBe("note-a");

    // Switch to a note that doesn't exist
    noteIdStore.set("note-missing");
    expect(get(readable$)).toBeUndefined();
  });

  it("returns undefined when workspaceId writable is cleared", () => {
    const { store } = init();

    store.dispatch(
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote("note-a")],
      }),
    );

    const workspaceIdStore = writable<string | null>(WS_1);
    const noteIdStore = writable<string | null>("note-a");
    const readable$ = selectNoteById.withStore(store)(workspaceIdStore, noteIdStore);

    expect(get(readable$)?.id).toBe("note-a");

    // Clear workspace — should return undefined
    workspaceIdStore.set(null);
    expect(get(readable$)).toBeUndefined();
  });
});
