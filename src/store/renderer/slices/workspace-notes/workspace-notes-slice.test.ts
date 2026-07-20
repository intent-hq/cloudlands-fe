import {
  describe,
  expect,
  it,
} from "vitest";
import {
  ContentType,
  NoteVisibility,
  type Note,
} from "$shared/types";
import {
  getItem,
  getItems,
} from "$lib/store-shim/utils/collections/collection-utils";
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyLocalNoteUpdate,
  applyNoteUpdated,
  applyTaskStatusChanged,
  clearWorkspaceNotesForWorkspaces,
  emptyWorkspaceNotesState,
  initialState,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  setWorkspaceNotesLoading,
  workspaceNotesReducer,
} from "./workspace-notes-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";

const WS_1 = "ws-1";
const WS_2 = "ws-2";

function mockNote(id: string, workspaceId = WS_1, overrides: Partial<Note> = {}): Note {
  return {
    id: id as Note["id"],
    workspaceId: workspaceId as Note["workspaceId"],
    title: `Note ${id}`,
    content: `Content ${id}`,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspaceNotesReducer", () => {
  it("returns the initial state", () => {
    expect(workspaceNotesReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores notes and per-workspace flags after a successful load", () => {
    const notesByWorkspace = {
      [WS_1]: [mockNote("note-1")],
      [WS_2]: [],
    };

    expect(
      workspaceNotesReducer(initialState, loadWorkspaceNotesSucceeded([WS_1, WS_2], notesByWorkspace))
    ).toEqual({
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceNotesState,
          notes: {
            idField: "id",
            ids: ["note-1"],
            map: { "note-1": mockNote("note-1") },
            refsCount: {},
          },
          initialized: true,
          notesVersion: 1,
        },
        [WS_2]: {
          ...emptyWorkspaceNotesState,
          notes: {
            idField: "id",
            ids: [],
            map: {},
            refsCount: {},
          },
          initialized: true,
          notesVersion: 1,
        },
      },
    });
  });

  it("bumps notesVersion on loadWorkspaceNotesSucceeded so mount-time hydration ticks version-gated selectors", () => {
    const first = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("note-1")] })
    );
    const second = workspaceNotesReducer(
      first,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("note-1"), mockNote("note-2")] })
    );

    expect(first.byWorkspaceId[WS_1].notesVersion).toBe(1);
    expect(second.byWorkspaceId[WS_1].notesVersion).toBe(2);
  });

  it("tracks loading and errors per workspace", () => {
    let state = workspaceNotesReducer(initialState, setWorkspaceNotesLoading([WS_1], true));
    state = workspaceNotesReducer(state, loadWorkspaceNotesFailed([WS_1], "boom"));

    expect(state.byWorkspaceId[WS_1]).toEqual({
      ...emptyWorkspaceNotesState,
      loading: false,
      error: "boom",
    });
  });

  it("clears only the requested workspace snapshots", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1, WS_2], {
        [WS_1]: [mockNote("note-1")],
        [WS_2]: [mockNote("note-2", WS_2)],
      })
    );

    expect(workspaceNotesReducer(loadedState, clearWorkspaceNotesForWorkspaces([WS_1]))).toEqual({
      byWorkspaceId: {
        [WS_2]: loadedState.byWorkspaceId[WS_2],
      },
    });
  });

  it("updates task status for tracked task notes", () => {
    const taskNote = mockNote("task-1", WS_1, {
      metadata: { task: { status: "not_started" } },
    });
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [taskNote] })
    );

    const nextState = workspaceNotesReducer(
      loadedState,
      applyTaskStatusChanged(WS_1, "task-1", "complete")
    );

    expect(getItem(nextState.byWorkspaceId[WS_1].notes, "task-1" as Note["id"])?.metadata?.task?.status).toBe(
      "complete"
    );
    expect(nextState.byWorkspaceId[WS_1].notesVersion).toBe(
      loadedState.byWorkspaceId[WS_1].notesVersion + 1
    );
  });

  it("does not bump notesVersion on applyTaskStatusChanged for uninitialized or non-task notes", () => {
    const uninitializedState = workspaceNotesReducer(
      initialState,
      applyTaskStatusChanged(WS_1, "task-1", "complete")
    );
    expect(uninitializedState).toBe(initialState);

    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("plain-1")] })
    );
    const noTaskState = workspaceNotesReducer(
      loadedState,
      applyTaskStatusChanged(WS_1, "plain-1", "complete")
    );
    expect(noTaskState).toBe(loadedState);
  });

  it("appends created notes only for tracked workspaces", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("note-1")] })
    );

    const trackedState = workspaceNotesReducer(loadedState, applyNoteCreated(WS_1, mockNote("note-2")));
    const untrackedState = workspaceNotesReducer(loadedState, applyNoteCreated(WS_2, mockNote("note-3", WS_2)));

    expect(getItems(trackedState.byWorkspaceId[WS_1].notes).map((note) => note.id)).toEqual([
      "note-1",
      "note-2",
    ]);
    expect(trackedState.byWorkspaceId[WS_1].notesVersion).toBe(
      loadedState.byWorkspaceId[WS_1].notesVersion + 1
    );
    expect(untrackedState).toBe(loadedState);
  });

  it("removes deleted notes from the tracked workspace", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], {
        [WS_1]: [mockNote("note-1"), mockNote("note-2")],
      })
    );

    const nextState = workspaceNotesReducer(loadedState, applyNoteDeleted(WS_1, "note-1"));

    expect(getItems(nextState.byWorkspaceId[WS_1].notes).map((note) => note.id)).toEqual(["note-2"]);
    expect(nextState.byWorkspaceId[WS_1].notesVersion).toBe(
      loadedState.byWorkspaceId[WS_1].notesVersion + 1
    );
  });

  it("does not bump notesVersion on applyNoteDeleted when the note is absent", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("note-1")] })
    );

    const nextState = workspaceNotesReducer(loadedState, applyNoteDeleted(WS_1, "note-missing"));

    expect(nextState).toBe(loadedState);
  });

  it("replaces updated notes when a full note payload is available", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("note-1")] })
    );
    const updatedNote = mockNote("note-1", WS_1, { title: "Updated title" });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, "note-1", updatedNote)
    );

    expect(getItem(nextState.byWorkspaceId[WS_1].notes, "note-1" as Note["id"])?.title).toBe(
      "Updated title"
    );
  });

  it("caches updated notes before workspace notes finish initializing", () => {
    const updatedSpec = mockNote("spec", WS_1, { content: "# Coordinator plan" });

    const nextState = workspaceNotesReducer(
      initialState,
      applyNoteUpdated(WS_1, "spec", updatedSpec)
    );

    expect(nextState.byWorkspaceId[WS_1].initialized).toBe(false);
    expect(getItem(nextState.byWorkspaceId[WS_1].notes, "spec" as Note["id"])?.content).toBe(
      "# Coordinator plan"
    );
  });

  it("returns state unchanged when note workspace ID does not match action workspace ID", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("note-1")] })
    );
    const noteFromDifferentWorkspace = mockNote("note-2", WS_2, { title: "Wrong workspace" });

    const nextState = workspaceNotesReducer(
      loadedState,
      applyNoteUpdated(WS_1, "note-2", noteFromDifferentWorkspace)
    );

    expect(nextState).toBe(loadedState);
    expect(getItem(nextState.byWorkspaceId[WS_1].notes, "note-2" as Note["id"])).toBeUndefined();
  });

  it("drops non-string local content/title/source updates before storing notes", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [mockNote("note-1")] })
    );

    const nextState = workspaceNotesReducer(
      loadedState,
      applyLocalNoteUpdate(WS_1, "note-1", {
        content: { slice: "not-a-function" },
        title: 42,
        source: { invalid: true },
      } as unknown as Partial<Note>)
    );

    const note = getItem(nextState.byWorkspaceId[WS_1].notes, "note-1" as Note["id"]);
    expect(note?.content).toBe("Content note-1");
    expect(note?.title).toBe("Note note-1");
    expect((note as any).source).toBeUndefined();
  });

  it("clears workspace state on workspaceUnmounted", () => {
    const loadedState = workspaceNotesReducer(
      initialState,
      loadWorkspaceNotesSucceeded([WS_1, WS_2], {
        [WS_1]: [mockNote("note-1")],
        [WS_2]: [mockNote("note-2", WS_2)],
      })
    );

    const nextState = workspaceNotesReducer(loadedState, workspaceUnmounted(WS_1));

    expect(nextState.byWorkspaceId[WS_1]).toBeUndefined();
    expect(nextState.byWorkspaceId[WS_2]).toEqual(loadedState.byWorkspaceId[WS_2]);
  });
});