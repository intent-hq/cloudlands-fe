import { describe, expect, it } from "vitest";
import {
  APP_EVENT_ACTION_MAP,
  APP_EVENT_TYPES,
} from "../app-events-slice";

describe("app-events-slice", () => {
  it("has an action for log:events-updated", () => {
    expect(APP_EVENT_ACTION_MAP["log:events-updated"]).toBeDefined();
  });

  it("APP_EVENT_TYPES matches the action map size", () => {
    expect(APP_EVENT_TYPES.length).toBe(
      Object.keys(APP_EVENT_ACTION_MAP).length,
    );
  });
});

