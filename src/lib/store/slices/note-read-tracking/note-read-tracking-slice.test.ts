import { describe, it, expect, vi } from "vitest";
import {
  noteReadTrackingReducer,
  markAsViewed,
  clearCurrentlyViewed,
  markNoteRead,
  computeUnreadNotesSuccess,
  setLoading,
  clearCache,
  clearUnread,
  loadNoteReadStatusSuccess,
  workspaceChanged,
  initialState,
  type NoteReadTrackingState,
} from "./note-read-tracking-slice";

describe("noteReadTrackingReducer", () => {
  it("should return initial state", () => {
    const state = noteReadTrackingReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("markAsViewed", () => {
    it("should set currently viewed note and remove from unread", () => {
      const prev: NoteReadTrackingState = {
        ...initialState,
        unreadNoteIds: ["note-1", "note-2"],
      };
      const state = noteReadTrackingReducer(prev, markAsViewed("note-1"));
      expect(state.currentlyViewedNoteId).toBe("note-1");
      expect(state.unreadNoteIds).toEqual(["note-2"]);
    });

    it("should return same state for empty noteId", () => {
      const state = noteReadTrackingReducer(initialState, markAsViewed(""));
      expect(state).toBe(initialState);
    });
  });

  describe("clearCurrentlyViewed", () => {
    it("should clear currently viewed note", () => {
      const prev: NoteReadTrackingState = {
        ...initialState,
        currentlyViewedNoteId: "note-1",
      };
      const state = noteReadTrackingReducer(prev, clearCurrentlyViewed());
      expect(state.currentlyViewedNoteId).toBeNull();
    });

    it("should return same state if no note is viewed", () => {
      const state = noteReadTrackingReducer(initialState, clearCurrentlyViewed());
      expect(state).toBe(initialState);
    });
  });

  describe("markNoteRead", () => {
    it("should optimistically add read record and remove from unread", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

      const prev: NoteReadTrackingState = {
        ...initialState,
        unreadNoteIds: ["note-1", "note-2"],
      };
      const state = noteReadTrackingReducer(prev, markNoteRead("ws-1", "note-1"));

      expect(state.readRecords["note-1"]).toBeDefined();
      expect(state.readRecords["note-1"].lastReadAt).toBe("2025-01-01T00:00:00.000Z");
      expect(state.readRecords["note-1"].readCount).toBe(1);
      expect(state.unreadNoteIds).toEqual(["note-2"]);

      vi.useRealTimers();
    });

    it("should increment readCount for existing record", () => {
      const prev: NoteReadTrackingState = {
        ...initialState,
        readRecords: {
          "note-1": { lastReadAt: "2024-01-01T00:00:00Z", readCount: 3 },
        },
      };
      const state = noteReadTrackingReducer(prev, markNoteRead("ws-1", "note-1"));
      expect(state.readRecords["note-1"].readCount).toBe(4);
    });
  });

  describe("computeUnreadNotesSuccess", () => {
    it("should set unread IDs and clear loading", () => {
      const prev: NoteReadTrackingState = { ...initialState, isLoading: true };
      const state = noteReadTrackingReducer(prev, computeUnreadNotesSuccess(["a", "b"]));
      expect(state.unreadNoteIds).toEqual(["a", "b"]);
      expect(state.isLoading).toBe(false);
    });
  });

  describe("setLoading", () => {
    it("should set loading state", () => {
      const state = noteReadTrackingReducer(initialState, setLoading(true));
      expect(state.isLoading).toBe(true);
    });
  });

  describe("clearCache", () => {
    it("should reset to initial state", () => {
      const prev: NoteReadTrackingState = {
        readRecords: { "n": { lastReadAt: "x", readCount: 1 } },
        unreadNoteIds: ["n"],
        isLoading: true,
        currentlyViewedNoteId: "n",
        currentWorkspaceId: "ws",
      };
      const state = noteReadTrackingReducer(prev, clearCache());
      expect(state).toEqual(initialState);
    });
  });

  describe("clearUnread", () => {
    it("should remove note from unread and clear if currently viewed", () => {
      const prev: NoteReadTrackingState = {
        ...initialState,
        unreadNoteIds: ["note-1", "note-2"],
        currentlyViewedNoteId: "note-1",
      };
      const state = noteReadTrackingReducer(prev, clearUnread("note-1"));
      expect(state.unreadNoteIds).toEqual(["note-2"]);
      expect(state.currentlyViewedNoteId).toBeNull();
    });
  });

  describe("loadNoteReadStatusSuccess", () => {
    it("should cache read record", () => {
      const record = { lastReadAt: "2025-01-01T00:00:00Z", readCount: 5 };
      const state = noteReadTrackingReducer(initialState, loadNoteReadStatusSuccess("note-1", record));
      expect(state.readRecords["note-1"]).toEqual(record);
    });
  });

  describe("workspaceChanged", () => {
    it("should reset state with new workspace ID", () => {
      const prev: NoteReadTrackingState = {
        readRecords: { "n": { lastReadAt: "x" } },
        unreadNoteIds: ["n"],
        isLoading: true,
        currentlyViewedNoteId: "n",
        currentWorkspaceId: "old-ws",
      };
      const state = noteReadTrackingReducer(prev, workspaceChanged("new-ws"));
      expect(state.currentWorkspaceId).toBe("new-ws");
      expect(state.readRecords).toEqual({});
      expect(state.unreadNoteIds).toEqual([]);
      expect(state.currentlyViewedNoteId).toBeNull();
    });
  });
});

