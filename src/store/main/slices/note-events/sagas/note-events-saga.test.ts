import { describe, expect, it } from "vitest";
import {
  noteCreated,
  NOTE_EVENT_ACTION_MAP,
  NOTE_EVENT_TYPES,
} from "../note-events-slice";
import {
  WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS,
} from "../../workspace-lifecycle-events/workspace-lifecycle-events-slice";
import {
  terminalData,
} from "../../terminal-events/terminal-events-slice";

// ---------------------------------------------------------------------------
// Slice structure tests
// ---------------------------------------------------------------------------

describe("note-events-slice", () => {
  it("has an action for every note/comment event type", () => {
    const expectedEvents = [
      "note:created",
      "note:updated",
      "note:deleted",
      "line-attribution:updated",
      "comment:added",
      "comment:updated",
      "comment:deleted",
      "comment:resolved",
      "comment:status-changed",
      "comment:updated-batch",
    ];

    for (const event of expectedEvents) {
      expect(NOTE_EVENT_ACTION_MAP[event as keyof typeof NOTE_EVENT_ACTION_MAP]).toBeDefined();
    }
  });

  it("NOTE_EVENT_TYPES matches the action map size", () => {
    expect(NOTE_EVENT_TYPES.length).toBe(
      Object.keys(NOTE_EVENT_ACTION_MAP).length,
    );
  });

  it("does not mark note events as global", () => {
    expect(WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(noteCreated.type)).toBe(false);
    expect(WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(terminalData.type)).toBe(false);
  });
});

