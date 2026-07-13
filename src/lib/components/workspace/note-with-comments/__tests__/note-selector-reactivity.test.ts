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
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";
import {
  get,
} from "svelte/store";
import { reducers } from "$store/renderer/reducer";
import { selectNoteById } from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";
import {
  ContentType,
  NoteVisibility,
  type Note,
} from "$shared/types";
import NoteSelectorReactivityHarness from "./NoteSelectorReactivityHarness.test.svelte";

const WS_1 = "ws-1";

function createTestStore() {
  return new Store(reducers);
}

function renderInitializedStore() {
  const store = createTestStore();
  return { store };
}

afterEach(() => {
  cleanup();
});

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
  it("returns the correct note when noteId prop changes without remounting", async () => {
    const { store } = renderInitializedStore();
    const { rerender } = render(NoteSelectorReactivityHarness, {
      props: {
        store,
        workspaceId: WS_1,
        noteId: "note-a",
        notesByWorkspace: {
          [WS_1]: [mockNote("note-a"), mockNote("note-b")],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-note-id").textContent).toBe("note-a");
    });
    expect(screen.getByTestId("selected-note-content").textContent).toBe("Content for note-a");
    expect(screen.getByTestId("selected-from-state-id").textContent).toBe("note-a");
    expect(screen.getByTestId("readable-note-count").textContent).toBe("2");
    expect(selectNoteById.select(store.state, WS_1, "note-a")?.id).toBe("note-a");
    expect(get(store.getReadableState()).workspaceNotes.byWorkspaceId[WS_1]?.notes.ids).toEqual([
      "note-a",
      "note-b",
    ]);

    // Switch noteId — simulates navigating to a different note without remounting
    await rerender({
      store,
      workspaceId: WS_1,
      noteId: "note-b",
      notesByWorkspace: {
        [WS_1]: [mockNote("note-a"), mockNote("note-b")],
      },
    });

    // The readable must now return note-b
    await waitFor(() => {
      expect(screen.getByTestId("selected-note-id").textContent).toBe("note-b");
    });
    expect(screen.getByTestId("selected-note-content").textContent).toBe("Content for note-b");
    expect(screen.getByTestId("selected-from-state-id").textContent).toBe("note-b");
  });

  it("returns undefined when noteId prop changes to a non-existent note", async () => {
    const { store } = renderInitializedStore();
    const { rerender } = render(NoteSelectorReactivityHarness, {
      props: {
        store,
        workspaceId: WS_1,
        noteId: "note-a",
        notesByWorkspace: {
          [WS_1]: [mockNote("note-a")],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-note-id").textContent).toBe("note-a");
    });

    // Switch to a note that doesn't exist
    await rerender({
      store,
      workspaceId: WS_1,
      noteId: "note-missing",
      notesByWorkspace: {
        [WS_1]: [mockNote("note-a")],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-note-id").textContent).toBe("");
    });
    expect(screen.getByTestId("selected-from-state-id").textContent).toBe("");
  });

  it("returns undefined when workspaceId prop is cleared", async () => {
    const { store } = renderInitializedStore();
    const { rerender } = render(NoteSelectorReactivityHarness, {
      props: {
        store,
        workspaceId: WS_1,
        noteId: "note-a",
        notesByWorkspace: {
          [WS_1]: [mockNote("note-a")],
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-note-id").textContent).toBe("note-a");
    });

    // Clear workspace — should return undefined
    await rerender({
      store,
      workspaceId: null,
      noteId: "note-a",
      notesByWorkspace: {
        [WS_1]: [mockNote("note-a")],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected-note-id").textContent).toBe("");
    });
    expect(screen.getByTestId("selected-from-state-id").textContent).toBe("");
  });
});
