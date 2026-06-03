import {
  describe,
  expect,
  it,
} from "vitest";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import {
  agentFileChangeReceived,
  agentFileRefreshTriggered,
  chatChangesReducer,
  emptyChatChangesWorkspaceState,
  initialState,
} from "./chat-changes-slice";

const WS_ID = "ws-1";
const PATH = "src/app.ts";

describe("chatChangesReducer", () => {
  it("returns the initial state", () => {
    expect(chatChangesReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("does not change state for agent file change receive trigger actions", () => {
    expect(chatChangesReducer(initialState, agentFileChangeReceived(WS_ID, PATH))).toBe(initialState);
  });

  it("creates and increments per-file refresh versions", () => {
    const firstState = chatChangesReducer(initialState, agentFileRefreshTriggered(WS_ID, PATH));
    expect(firstState.byWorkspaceId[WS_ID].refreshes.map[PATH]).toEqual({ path: PATH, version: 1 });

    const secondState = chatChangesReducer(firstState, agentFileRefreshTriggered(WS_ID, PATH));
    expect(secondState.byWorkspaceId[WS_ID].refreshes.map[PATH]).toEqual({ path: PATH, version: 2 });
  });

  it("clears workspace state on workspace unmount", () => {
    const state = chatChangesReducer(initialState, agentFileRefreshTriggered(WS_ID, PATH));

    expect(chatChangesReducer(state, workspaceUnmounted(WS_ID)).byWorkspaceId[WS_ID]).toBeUndefined();
    expect(chatChangesReducer(initialState, workspaceUnmounted(WS_ID))).toBe(initialState);
    expect(emptyChatChangesWorkspaceState.refreshes.ids).toEqual([]);
  });
});