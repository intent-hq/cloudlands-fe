import { describe, expect, it } from "vitest";
import {
  SCRIPT_EVENT_ACTION_MAP,
  SCRIPT_EVENT_TYPES,
} from "../script-events-slice";

describe("script-events-slice", () => {
  it("has an action for every script event type", () => {
    const expectedEvents = [
      "script:started",
      "script:stopped",
      "script:output",
      "script:error",
      "script:url-detected",
    ];

    for (const event of expectedEvents) {
      expect(SCRIPT_EVENT_ACTION_MAP[event as keyof typeof SCRIPT_EVENT_ACTION_MAP]).toBeDefined();
    }
  });

  it("SCRIPT_EVENT_TYPES matches the action map size", () => {
    expect(SCRIPT_EVENT_TYPES.length).toBe(
      Object.keys(SCRIPT_EVENT_ACTION_MAP).length,
    );
  });
});

