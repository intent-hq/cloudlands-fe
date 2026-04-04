import { describe, expect, it } from "vitest";
import {
  GIT_EVENT_ACTION_MAP,
  GIT_EVENT_TYPES,
} from "../git-events-slice";

describe("git-events-slice", () => {
  it("has an action for every git event type", () => {
    const expectedEvents = [
      "git:commit-created",
      "git:branch-changed",
      "git:auth-required",
      "github:auth-required",
      "git:status-changed",
      "git:auto-commit-started",
      "git:auto-commit-succeeded",
      "git:auto-commit-hook-failure",
      "git:op-started",
      "git:op-progress",
      "git:op-completed",
      "git:op-failed",
    ];

    for (const event of expectedEvents) {
      expect(GIT_EVENT_ACTION_MAP[event as keyof typeof GIT_EVENT_ACTION_MAP]).toBeDefined();
    }
  });

  it("GIT_EVENT_TYPES matches the action map size", () => {
    expect(GIT_EVENT_TYPES.length).toBe(
      Object.keys(GIT_EVENT_ACTION_MAP).length,
    );
  });
});

