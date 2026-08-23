import { describe, expect, it } from "vitest";
import {
  applyNativePlanCleared,
  applyNativePlanUpdated,
  initialNativePlansState,
  nativePlansReducer,
} from "./native-plans-slice";
import type { NativePlanEntry } from "./native-plans-types";

const entry = (id: string, status: NativePlanEntry["status"]): NativePlanEntry => ({
  id,
  title: `Entry ${id}`,
  status,
});

describe("nativePlansReducer", () => {
  it("starts empty", () => {
    expect(initialNativePlansState).toEqual({ bySessionId: {} });
  });

  it("applyNativePlanUpdated stores entries keyed by session id", () => {
    const state = nativePlansReducer(
      initialNativePlansState,
      applyNativePlanUpdated("acp-1", [entry("e1", "pending")]),
    );

    expect(state.bySessionId["acp-1"]).toEqual({ entries: [entry("e1", "pending")] });
  });

  it("applyNativePlanUpdated replaces prior entries for the session", () => {
    let state = nativePlansReducer(
      initialNativePlansState,
      applyNativePlanUpdated("acp-1", [entry("e1", "pending")]),
    );
    state = nativePlansReducer(
      state,
      applyNativePlanUpdated("acp-1", [entry("e1", "completed"), entry("e2", "in_progress")]),
    );

    expect(state.bySessionId["acp-1"].entries.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(state.bySessionId["acp-1"].entries[0].status).toBe("completed");
  });

  it("keeps other sessions independent", () => {
    let state = nativePlansReducer(
      initialNativePlansState,
      applyNativePlanUpdated("acp-1", [entry("e1", "pending")]),
    );
    state = nativePlansReducer(state, applyNativePlanUpdated("acp-2", [entry("x1", "pending")]));
    state = nativePlansReducer(state, applyNativePlanCleared("acp-1"));

    expect(state.bySessionId["acp-1"]).toBeUndefined();
    expect(state.bySessionId["acp-2"]).toBeDefined();
  });

  it("applyNativePlanCleared is a no-op for unknown sessions", () => {
    const state = nativePlansReducer(initialNativePlansState, applyNativePlanCleared("nope"));
    expect(state).toBe(initialNativePlansState);
  });
});
