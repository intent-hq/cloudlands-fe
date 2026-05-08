import { describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";
import type { StoreState } from "../../../types";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeEvery(pattern, saga);
  },
}));

import {
  clearAgentsUnread,
  clearWorkspaceUnread,
  hydrateUnreadTracking,
  unreadTrackingReducer,
} from "../unread-tracking-slice";
import {
  initialState as workspaceAgentsInitialState,
  setAgents,
  workspaceAgentsReducer,
} from "../../workspace-agents/workspace-agents-slice";
import { clearWorkspaceUnreadSaga } from "./unread-tracking-saga";

function mockState(unreadAgentIds: string[]): StoreState {
  return {
    unreadTracking: {
      unreadAgentIds,
      currentlyViewedAgentId: null,
    },
    workspaceAgents: {
      byWorkspaceId: {
        "ws-1": { agentIds: ["agent-1", "agent-2"] },
        "ws-2": { agentIds: ["agent-3"] },
      },
    },
  } as StoreState;
}

describe("clearWorkspaceUnreadSaga", () => {
  it("derives workspace unread agents from workspace agentIds", async () => {
    const dispatched: unknown[] = [];

    await runSaga(
      {
        dispatch: (action) => dispatched.push(action),
        getState: () => mockState(["agent-2", "agent-1", "agent-3"]),
      },
      clearWorkspaceUnreadSaga,
      clearWorkspaceUnread("ws-1"),
    ).toPromise();

    expect(dispatched).toEqual([clearAgentsUnread(["agent-1", "agent-2"])]);
  });

  it("does not dispatch when the workspace has no unread agents", async () => {
    const dispatched: unknown[] = [];

    await runSaga(
      {
        dispatch: (action) => dispatched.push(action),
        getState: () => mockState(["agent-3"]),
      },
      clearWorkspaceUnreadSaga,
      clearWorkspaceUnread("ws-1"),
    ).toPromise();

    expect(dispatched).toEqual([]);
  });

  it("clears hydrated unread after workspace mount no-ops before agents load", async () => {
    let state = {
      unreadTracking: unreadTrackingReducer(
        undefined,
        hydrateUnreadTracking({ unreadAgentIds: ["agent-1", "agent-other"] }),
      ),
      workspaceAgents: workspaceAgentsInitialState,
    } as StoreState;

    const mountDispatched: unknown[] = [];
    await runSaga(
      {
        dispatch: (action) => mountDispatched.push(action),
        getState: () => state,
      },
      clearWorkspaceUnreadSaga,
      clearWorkspaceUnread("ws-1"),
    ).toPromise();

    expect(mountDispatched).toEqual([]);

    state = {
      ...state,
      workspaceAgents: workspaceAgentsReducer(
        state.workspaceAgents,
        setAgents("ws-1", [{ id: "agent-1", workspaceId: "ws-1" } as any]),
      ),
    } as StoreState;

    const loadDispatched: ReturnType<typeof clearAgentsUnread>[] = [];
    await runSaga(
      {
        dispatch: (action) => loadDispatched.push(action),
        getState: () => state,
      },
      clearWorkspaceUnreadSaga,
      clearWorkspaceUnread("ws-1"),
    ).toPromise();

    expect(loadDispatched).toEqual([clearAgentsUnread(["agent-1"])]);
    expect(unreadTrackingReducer(state.unreadTracking, loadDispatched[0]).unreadAgentIds).toEqual([
      "agent-other",
    ]);
  });
});