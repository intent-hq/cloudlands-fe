import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import { ContentType, NoteVisibility, type Note } from "$shared/types";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.select(fn, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLeading: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLeading(pattern, worker);
  },
}));

vi.mock("../../workspace-lifecycle/workspace-lifecycle-slice", () => ({
  workspaceUnmounted: Object.assign((wsId: string) => ({
    type: "workspace-lifecycle/workspaceUnmounted",
    payload: [wsId],
  }), { type: "workspace-lifecycle/workspaceUnmounted", toString: () => "workspace-lifecycle/workspaceUnmounted" }),
}));

const { takeEveryFromListenSyncMock, notesIpcMock, dispatchContentUpdateEventMock } = vi.hoisted(() => ({
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
  notesIpcMock: vi.fn(),
  dispatchContentUpdateEventMock: vi.fn(),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

vi.mock("./notes-ipc", () => ({
  notesIpc: notesIpcMock,
}));

vi.mock("./dispatch-content-update-event", () => ({
  dispatchContentUpdateEvent: dispatchContentUpdateEventMock,
}));

import {
  applyNoteUpdated,
  applyTaskStatusChanged,
  clearWorkspaceNotesForWorkspaces,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesRequested,
  loadWorkspaceNotesSucceeded,
  refreshWorkspaceNotesRequested,
  setWorkspaceNotesLoading,
} from "../workspace-notes-slice";
import {
  handleLoadWorkspaceNotesRequested,
  handleRefreshWorkspaceNotesRequested,
  watchNoteUpdatedSaga,
  watchTaskStatusChangedSaga,
  workspaceNotesSaga,
  watchLoadWorkspaceNotesRequestedSaga,
  watchRefreshWorkspaceNotesRequestedSaga,
  watchNoteCreatedSaga,
  watchNoteDeletedSaga,
  _resetNoteUpdateSequence,
} from "./workspace-notes-saga";
import { notesCrudSaga } from "./notes-crud-saga";

function mockNote(id: string, workspaceId = "ws-1"): Note {
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
  };
}

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("workspaceNotesSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notesIpcMock.mockReset();
    dispatchContentUpdateEventMock.mockReset();
    _resetNoteUpdateSequence();
  });

  it("forks all workspace notes watchers and registers unmount cleanup", () => {
    testSaga(workspaceNotesSaga)
      .next()
      .fork(watchLoadWorkspaceNotesRequestedSaga)
      .next()
      .fork(watchRefreshWorkspaceNotesRequestedSaga)
      .next()
      .fork(watchTaskStatusChangedSaga)
      .next()
      .fork(watchNoteCreatedSaga)
      .next()
      .fork(watchNoteDeletedSaga)
      .next()
      .fork(watchNoteUpdatedSaga)
      .next()
      .fork(notesCrudSaga);

    // Verify the last effect is a takeEvery for workspaceUnmounted cleanup
    // (use manual stepping since testSaga has function-identity issues with mocked modules)
    const iterator = workspaceNotesSaga();
    // Advance through the 7 fork effects
    for (let i = 0; i < 7; i++) iterator.next();
    const takeEveryEffect = iterator.next();
    expect(takeEveryEffect.done).toBe(false);
    expect((takeEveryEffect.value as any)?.type).toBe("FORK"); // takeEvery is a FORK internally
    expect((takeEveryEffect.value as any)?.payload?.args?.[1]?.name).toBe("handleNoteSequenceCleanup");
    expect(iterator.next().done).toBe(true);
  });

  it("loads workspace notes and normalizes missing workspace entries", () => {
    const action = loadWorkspaceNotesRequested(["ws-1", "ws-2"]);
    const iterator = handleLoadWorkspaceNotesRequested(action);

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(setWorkspaceNotesLoading(["ws-1", "ws-2"], true)),
      done: false,
    });

    const callEffect = iterator.next().value as any;
    expect(callEffect.type).toBe("CALL");
    expect(callEffect.payload.args).toEqual(["notes:batch-list", { workspaceIds: ["ws-1", "ws-2"] }]);

    expect(
      iterator.next({ ok: true, data: { "ws-1": [mockNote("note-1")] } }).value
    ).toEqual(
      sagaEffects.put(
        loadWorkspaceNotesSucceeded(["ws-1", "ws-2"], {
          "ws-1": [mockNote("note-1")],
          "ws-2": [],
        })
      )
    );
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("clears tracked workspaces before refreshing notes", () => {
    const action = refreshWorkspaceNotesRequested(["ws-1"]);
    const iterator = handleRefreshWorkspaceNotesRequested(action);

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(clearWorkspaceNotesForWorkspaces(["ws-1"])),
      done: false,
    });

    const callEffect = iterator.next().value as any;
    expect(callEffect.type).toBe("CALL");
    expect(callEffect.payload.args[0]).toEqual(loadWorkspaceNotesRequested(["ws-1"]));
  });

  it("dispatches load failures when batch loading fails", () => {
    const action = loadWorkspaceNotesRequested(["ws-1"]);
    const iterator = handleLoadWorkspaceNotesRequested(action);

    iterator.next();
    iterator.next();

    expect(iterator.next({ ok: false, error: "nope" })).toEqual({
      value: sagaEffects.put(loadWorkspaceNotesFailed(["ws-1"], "nope")),
      done: false,
    });
  });

  it("registers a task status listener that updates tracked task metadata", () => {
    const iterator = watchTaskStatusChangedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromListenSyncMock).toHaveBeenCalledWith(
      "task:status-changed",
      expect.any(Function)
    );

    expect(
      getListenSyncHandler("task:status-changed")({
        workspaceId: "ws-1",
        data: { noteId: "task-1", newStatus: "complete" },
      }).next()
    ).toEqual({
      value: sagaEffects.put(applyTaskStatusChanged("ws-1", "task-1", "complete")),
      done: false,
    });
  });

  it("fetches note via IPC when note:updated does not include a full note payload", () => {
    const iterator = watchNoteUpdatedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromListenSyncMock).toHaveBeenCalledWith("note:updated", expect.any(Function));

    const handler = getListenSyncHandler("note:updated")({ workspaceId: "ws-1", noteId: "note-1" });
    // Should issue a call to notesIpc to fetch the full note
    const callEffect = handler.next().value as any;
    expect(callEffect.type).toBe("CALL");
    expect(callEffect.payload.args).toEqual(["notes:get", { workspaceId: "ws-1", noteId: "note-1" }]);

    // When IPC returns the full note, should dispatch applyNoteUpdated
    const fetchedNote = mockNote("note-1");
    expect(handler.next({ ok: true, data: fetchedNote })).toEqual({
      value: sagaEffects.put(applyNoteUpdated("ws-1", "note-1", fetchedNote)),
      done: false,
    });
  });

  it("updates notes when note:updated includes the full note object", () => {
    watchNoteUpdatedSaga().next();

    expect(
      getListenSyncHandler("note:updated")({
        workspaceId: "ws-1",
        noteId: "note-1",
        note: mockNote("note-1"),
      }).next()
    ).toEqual({
      value: sagaEffects.put(applyNoteUpdated("ws-1", "note-1", mockNote("note-1"))),
      done: false,
    });
  });

  it("merges content into existing note when note:updated has content but no full note", () => {
    watchNoteUpdatedSaga().next();

    const existingNote = mockNote("note-1");
    const handler = getListenSyncHandler("note:updated")({
      workspaceId: "ws-1",
      noteId: "note-1",
      content: "Updated content",
    });

    // First yield should be a SELECT to look up the existing note
    const selectEffect = handler.next().value as any;
    expect(selectEffect.type).toBe("SELECT");
    expect(selectEffect.payload.args).toEqual(["ws-1", "note-1"]);

    // Provide the existing note — should dispatch applyNoteUpdated with merged content
    const putEffect = handler.next(existingNote).value as any;
    expect(putEffect.type).toBe("PUT");
    const action = putEffect.payload.action;
    expect(action.type).toBe("workspaceNotes/applyNoteUpdated");
    expect(action.payload[0]).toBe("ws-1");
    expect(action.payload[1]).toBe("note-1");
    expect(action.payload[2].content).toBe("Updated content");
    expect(action.payload[2].title).toBe(existingNote.title);
  });

  it("merges content from changes field when note:updated has changes.content", () => {
    watchNoteUpdatedSaga().next();

    const existingNote = mockNote("note-1");
    const handler = getListenSyncHandler("note:updated")({
      workspaceId: "ws-1",
      noteId: "note-1",
      changes: { content: "Changed content" },
    });

    // First yield: SELECT for existing note
    const selectEffect = handler.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    // Provide existing note — should merge changes.content
    const putEffect = handler.next(existingNote).value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action.payload[2].content).toBe("Changed content");
  });

  it("falls back to IPC when content-only update arrives but note not in store", () => {
    watchNoteUpdatedSaga().next();

    const handler = getListenSyncHandler("note:updated")({
      workspaceId: "ws-1",
      noteId: "note-1",
      content: "Updated content",
    });

    // First yield: SELECT for existing note
    const selectEffect = handler.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    // Provide undefined (note not in store) — should fall through to IPC
    const callEffect = handler.next(undefined).value as any;
    expect(callEffect.type).toBe("CALL");
    expect(callEffect.payload.args).toEqual(["notes:get", { workspaceId: "ws-1", noteId: "note-1" }]);

    // When IPC returns, should dispatch applyNoteUpdated
    const fetchedNote = mockNote("note-1");
    expect(handler.next({ ok: true, data: fetchedNote })).toEqual({
      value: sagaEffects.put(applyNoteUpdated("ws-1", "note-1", fetchedNote)),
      done: false,
    });
  });

  // ===========================================================================
  // Regression: dispatchContentUpdateEvent fires for every applyNoteUpdated path
  // ===========================================================================

  describe("dispatchContentUpdateEvent firing", () => {
    it("fires content update event on full-note fast path with default source", () => {
      watchNoteUpdatedSaga().next();

      const note = mockNote("note-1");
      const handler = getListenSyncHandler("note:updated")({
        workspaceId: "ws-1",
        noteId: "note-1",
        note,
      });

      // PUT applyNoteUpdated
      handler.next();
      // Generator should now be done (the dispatchContentUpdateEvent is a plain call, not a yield)
      expect(handler.next().done).toBe(true);
      expect(dispatchContentUpdateEventMock).toHaveBeenCalledWith(
        "note-1", note.content, "external", "ws-1",
      );
    });

    it("fires content update event on full-note path with source=agent", () => {
      watchNoteUpdatedSaga().next();

      const note = mockNote("note-1");
      const handler = getListenSyncHandler("note:updated")({
        workspaceId: "ws-1",
        noteId: "note-1",
        note,
        source: "agent",
      });

      handler.next();
      handler.next();
      expect(dispatchContentUpdateEventMock).toHaveBeenCalledWith(
        "note-1", note.content, "agent", "ws-1",
      );
    });

    it("fires content update event on content-merge fast path", () => {
      watchNoteUpdatedSaga().next();

      const existingNote = mockNote("note-1");
      const handler = getListenSyncHandler("note:updated")({
        workspaceId: "ws-1",
        noteId: "note-1",
        content: "Merged content",
        source: "agent",
      });

      // SELECT for existing note
      handler.next();
      // Provide existing note → PUT applyNoteUpdated
      handler.next(existingNote);
      // Done
      expect(handler.next().done).toBe(true);
      expect(dispatchContentUpdateEventMock).toHaveBeenCalledWith(
        "note-1", "Merged content", "agent", "ws-1",
      );
    });

    it("fires content update event on IPC fallback path", () => {
      watchNoteUpdatedSaga().next();

      const handler = getListenSyncHandler("note:updated")({
        workspaceId: "ws-1",
        noteId: "note-1",
      });

      // CALL to notesIpc
      handler.next();
      const fetchedNote = mockNote("note-1");
      // PUT applyNoteUpdated
      handler.next({ ok: true, data: fetchedNote });
      // Done
      expect(handler.next().done).toBe(true);
      expect(dispatchContentUpdateEventMock).toHaveBeenCalledWith(
        "note-1", fetchedNote.content, "external", "ws-1",
      );
    });

    it("passes source=agent through to IPC fallback path", () => {
      watchNoteUpdatedSaga().next();

      const handler = getListenSyncHandler("note:updated")({
        workspaceId: "ws-1",
        noteId: "note-1",
        source: "agent",
      });

      handler.next();
      const fetchedNote = mockNote("note-1");
      handler.next({ ok: true, data: fetchedNote });
      handler.next();
      expect(dispatchContentUpdateEventMock).toHaveBeenCalledWith(
        "note-1", fetchedNote.content, "agent", "ws-1",
      );
    });
  });
});