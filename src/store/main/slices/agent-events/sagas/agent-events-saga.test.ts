import { describe, expect, it } from "vitest";
import {
  AGENT_EVENT_ACTION_MAP,
  AGENT_EVENT_TYPES,
} from "../agent-events-slice";

describe("agent-events-slice", () => {
  it("has an action for every agent event type", () => {
    const expectedEvents = [
      "agent:session-created",
      "agent:session-updated",
      "agent:session-completed",
      "agent:auth-required",
      "agent:remote-error",
      "agent:plan-required",
    ];

    for (const event of expectedEvents) {
      expect(AGENT_EVENT_ACTION_MAP[event as keyof typeof AGENT_EVENT_ACTION_MAP]).toBeDefined();
    }
  });

  it("AGENT_EVENT_TYPES matches the action map size", () => {
    expect(AGENT_EVENT_TYPES.length).toBe(
      Object.keys(AGENT_EVENT_ACTION_MAP).length,
    );
  });
});

