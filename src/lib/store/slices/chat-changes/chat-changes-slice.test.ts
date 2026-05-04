import { describe, expect, it } from "vitest";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import {
  agentFileChangeReceived,
  agentFileRefreshTriggered,
  chatChangesReducer,
  emptyChatChangesWorkspaceState,
  initialState,
} from "./chat-changes-slice";
import { selectAgentFileRefreshes, selectAgentFileRefreshVersion } from "./chat-changes-selectors";

const WS_ID = "ws-1";
const OTHER_WS_ID = "ws-2";
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

  it("tracks refresh versions independently per workspace", () => {
    const state = chatChangesReducer(
      chatChangesReducer(initialState, agentFileRefreshTriggered(WS_ID, PATH)),
      agentFileRefreshTriggered(OTHER_WS_ID, PATH),
    );

    expect(selectAgentFileRefreshVersion.select({ chatChanges: state } as any, WS_ID, PATH)).toBe(1);
    expect(selectAgentFileRefreshVersion.select({ chatChanges: state } as any, OTHER_WS_ID, PATH)).toBe(1);
    expect(selectAgentFileRefreshes.select({ chatChanges: state } as any, WS_ID)).toEqual([{ path: PATH, version: 1 }]);
  });

  it("tracks refresh versions independently per path within a workspace", () => {
    const firstPathState = chatChangesReducer(initialState, agentFileRefreshTriggered(WS_ID, "src/a.ts"));
    const firstSecondPathState = chatChangesReducer(firstPathState, agentFileRefreshTriggered(WS_ID, "src/b.ts"));
    const state = chatChangesReducer(firstSecondPathState, agentFileRefreshTriggered(WS_ID, "src/b.ts"));

    expect(selectAgentFileRefreshVersion.select({ chatChanges: state } as any, WS_ID, "src/a.ts")).toBe(1);
    expect(selectAgentFileRefreshVersion.select({ chatChanges: state } as any, WS_ID, "src/b.ts")).toBe(2);
  });

  it("returns empty selector defaults for missing workspace or path", () => {
    expect(selectAgentFileRefreshes.select({ chatChanges: initialState } as any, WS_ID)).toEqual([]);
    expect(selectAgentFileRefreshVersion.select({ chatChanges: initialState } as any, WS_ID, PATH)).toBe(0);
    expect(selectAgentFileRefreshVersion.select({ chatChanges: initialState } as any, WS_ID, null)).toBe(0);
  });

  it("clears workspace state on workspace unmount", () => {
    const state = chatChangesReducer(initialState, agentFileRefreshTriggered(WS_ID, PATH));

    expect(chatChangesReducer(state, workspaceUnmounted(WS_ID)).byWorkspaceId[WS_ID]).toBeUndefined();
    expect(chatChangesReducer(initialState, workspaceUnmounted(WS_ID))).toBe(initialState);
    expect(emptyChatChangesWorkspaceState.refreshes.ids).toEqual([]);
  });
});