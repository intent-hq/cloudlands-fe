import {
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { noteReadTrackingReducer, clearCurrentlyViewed, markNoteRead, clearCache, initialState, type NoteReadTrackingState } from "./note-read-tracking-slice";

describe("noteReadTrackingReducer", () => {
  it("should return initial state", () => {
    const state = noteReadTrackingReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
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
        unreadNoteIds: { "note-1": true, "note-2": true },
      };
      const state = noteReadTrackingReducer(prev, markNoteRead("ws-1", "note-1"));

      expect(state.readRecords["note-1"]).toBeDefined();
      expect(state.readRecords["note-1"].lastReadAt).toBe("2025-01-01T00:00:00.000Z");
      expect(state.readRecords["note-1"].readCount).toBe(1);
      expect(state.unreadNoteIds).toEqual({ "note-2": true });

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

  describe("clearCache", () => {
    it("should reset to initial state", () => {
      const prev: NoteReadTrackingState = {
        readRecords: { "n": { lastReadAt: "x", readCount: 1 } },
        unreadNoteIds: { n: true },
        isLoading: true,
        currentlyViewedNoteId: "n",
      };
      const state = noteReadTrackingReducer(prev, clearCache());
      expect(state).toEqual(initialState);
    });
  });
});

