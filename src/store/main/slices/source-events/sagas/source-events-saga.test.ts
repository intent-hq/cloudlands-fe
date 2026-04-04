import { describe, expect, it } from "vitest";
import {
  SOURCE_EVENT_ACTION_MAP,
  SOURCE_EVENT_TYPES,
} from "../source-events-slice";

describe("source-events-slice", () => {
  it("has an action for every source event type", () => {
    const expectedEvents = [
      "source:created",
      "source:updated",
      "source:deleted",
    ];

    for (const event of expectedEvents) {
      expect(SOURCE_EVENT_ACTION_MAP[event as keyof typeof SOURCE_EVENT_ACTION_MAP]).toBeDefined();
    }
  });

  it("SOURCE_EVENT_TYPES matches the action map size", () => {
    expect(SOURCE_EVENT_TYPES.length).toBe(
      Object.keys(SOURCE_EVENT_ACTION_MAP).length,
    );
  });
});

