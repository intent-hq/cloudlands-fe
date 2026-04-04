import { describe, it, expect } from "vitest";
import {
  browserReducer,
  initialState,
  addRecentUrl,
} from "./browser-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";

describe("browserReducer", () => {
  it("workspaceUnmounted clears workspace state", () => {
    let state = browserReducer(
      initialState,
      addRecentUrl("ws-1", "https://example.com", "Example", undefined, new Date().toISOString()),
    );
    state = browserReducer(
      state,
      addRecentUrl("ws-2", "https://other.com", "Other", undefined, new Date().toISOString()),
    );

    const nextState = browserReducer(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });
});

