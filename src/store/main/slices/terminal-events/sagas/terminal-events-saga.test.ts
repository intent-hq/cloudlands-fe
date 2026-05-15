import {
  describe,
  expect,
  it,
} from "vitest";
import {
  TERMINAL_EVENT_ACTION_MAP,
  TERMINAL_EVENT_TYPES,
} from "../terminal-events-slice";

describe("terminal-events-slice", () => {
  it("has an action for every terminal event type", () => {
    const expectedEvents = [
      "terminal:created",
      "terminal:data",
      "terminal:exit",
      "terminal:error",
      "terminal:disposed",
      "terminal:professional:data",
      "terminal:professional:exit",
      "terminal:professional:command:start",
      "terminal:professional:command:executed",
      "terminal:professional:command:finished",
      "terminal:professional:cwd:changed",
    ];

    for (const event of expectedEvents) {
      expect(TERMINAL_EVENT_ACTION_MAP[event as keyof typeof TERMINAL_EVENT_ACTION_MAP]).toBeDefined();
    }
  });

  it("TERMINAL_EVENT_TYPES matches the action map size", () => {
    expect(TERMINAL_EVENT_TYPES.length).toBe(
      Object.keys(TERMINAL_EVENT_ACTION_MAP).length,
    );
  });
});

