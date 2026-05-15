import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import * as sagaEffects from "redux-saga/effects";

// ⚠️ MUST come before importing any saga module
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

import {
  workspaceCreated,
  workspaceUpdated,
  workspaceDeleting,
  workspaceDeleted,
  workspaceArchived,
  WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP,
  WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS,
  WORKSPACE_LIFECYCLE_EVENT_TYPES,
} from "../workspace-lifecycle-events-slice";
import {
  broadcastDomainEvent,
  broadcastDomainEventToStdio,
} from "../../../utils/domain-event-broadcast";
import { cleanupWorkspace } from "../../workspace-events/workspace-events-slice";
import { clearWorkspace } from "../../agent-subscriptions/agent-subscriptions-slice";

// We need to test the handleBroadcast function — it's not exported,
// but we can test it via the root saga or test the slice's structure.

// ---------------------------------------------------------------------------
// Slice structure tests
// ---------------------------------------------------------------------------

describe("workspace-lifecycle-events-slice", () => {
  it("has an action for every workspace lifecycle event type", () => {
    const expectedEvents = [
      "workspace:created",
      "workspace:updated",
      "workspace:deleting",
      "workspace:deleted",
      "workspace:archived",
      "workspace:file-changes",
    ];

    for (const event of expectedEvents) {
      expect(WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP[event as keyof typeof WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP]).toBeDefined();
    }
  });

  it("WORKSPACE_LIFECYCLE_EVENT_TYPES matches the action map size", () => {
    expect(WORKSPACE_LIFECYCLE_EVENT_TYPES.length).toBe(
      Object.keys(WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP).length,
    );
  });

  it("marks all workspace lifecycle events as global", () => {
    expect(WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(workspaceCreated.type)).toBe(true);
    expect(WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(workspaceUpdated.type)).toBe(true);
    expect(WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(workspaceDeleting.type)).toBe(true);
    expect(WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(workspaceDeleted.type)).toBe(true);
    expect(WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS.has(workspaceArchived.type)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Saga tests
// ---------------------------------------------------------------------------

import { workspaceLifecycleEventsSaga } from "./workspace-lifecycle-events-saga";

describe("workspaceLifecycleEventsSaga - workspace deleted cleanup", () => {
  it("dispatches cleanupWorkspace and clearWorkspace on workspaceDeleted", async () => {
    const wsId = "ws-test-123";
    await expectSaga(workspaceLifecycleEventsSaga)
      .provide([
        [matchers.call.fn(broadcastDomainEvent), undefined],
        [matchers.call.fn(broadcastDomainEventToStdio), undefined],
        // Stub all other async call effects to prevent real side effects
        [matchers.call.like({}), undefined],
      ])
      .dispatch(workspaceDeleted({ workspaceId: wsId }))
      .put(cleanupWorkspace(wsId))
      .put(clearWorkspace(wsId))
      .silentRun(0);
  });
});
