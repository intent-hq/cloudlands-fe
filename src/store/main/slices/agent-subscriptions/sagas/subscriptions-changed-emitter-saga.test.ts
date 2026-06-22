/**
 * Tests for subscriptions-changed-emitter-saga.
 *
 * Uses a real Redux store + saga middleware so the selector channel and
 * lifecycle watcher behave authentically. `dispatchWorkspaceEvent` is mocked
 * so we can count emissions.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  applyMiddleware,
  combineReducers,
  legacy_createStore as createStore,
} from "redux";
import createSagaMiddleware from "redux-saga";
import type { Task } from "redux-saga";

vi.mock("./ipc-bridge-saga", async () => {
  const actual = await vi.importActual<typeof import("./ipc-bridge-saga")>(
    "./ipc-bridge-saga",
  );
  return {
    ...actual,
    dispatchWorkspaceEvent: vi.fn(() => Promise.resolve()),
  };
});

import {
  agentSubscriptionsReducer,
  addSubscription,
  appendDelegationGroupEvent,
  clearAgentQueue,
  clearWorkspace,
  enqueueEvent,
  markDelegationAgentCompleted,
  recordDeliveryFailure,
  recordDroppedEvents,
  recordDeliverySuccess,
  recordDeliveryTimeout,
  removeSubscription,
  setAgentStatus,
  setDelegationGroup,
  subscribeToDelegationGroup,
  type AgentSubscriptionRecord,
  type DelegationGroupTrackerRecord,
  type QueuedEventRecord,
} from "../agent-subscriptions-slice";

import {
  _resetMainStoreBridge,
  initMainStoreBridge,
} from "../../../redux-store-bridge";
import type { MainStore, MainStoreState } from "../../../types";
import { dispatchWorkspaceEvent } from "./ipc-bridge-saga";
import {
  __resetSubscriptionVersionCountersForTests,
  subscriptionsChangedEmitterSaga,
} from "./subscriptions-changed-emitter-saga";

const mockedDispatchEvent = dispatchWorkspaceEvent as unknown as ReturnType<
  typeof vi.fn
>;

const WS = "ws-1";
const WS2 = "ws-2";
const AGENT = "agent-1";
const PARENT = "agent-parent";
const CHILD = "agent-child";
const GROUP = "group-1";

function makeSub(id: string, agentId = AGENT): AgentSubscriptionRecord {
  return {
    id,
    agentId,
    agentName: agentId,
    workspaceId: WS,
    filter: { eventTypes: ["file:changed"] },
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

function makeDelegationSeed(subId: string, childId: string): AgentSubscriptionRecord {
  return {
    id: subId,
    agentId: PARENT,
    agentName: "Parent",
    workspaceId: WS,
    filter: {
      eventTypes: ["agent:idle"],
      actorIds: [childId],
      delegationGroup: {
        groupId: GROUP,
        awaitMode: "any",
        expectedAgentIds: [childId],
      },
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

function makeTracker(overrides: Partial<DelegationGroupTrackerRecord> = {}): DelegationGroupTrackerRecord {
  return {
    groupId: GROUP,
    parentAgentId: PARENT,
    parentAgentName: "Parent",
    awaitMode: "any",
    expectedAgentIds: [CHILD],
    completedAgentIds: [],
    deletedAgentIds: [],
    events: [],
    subscriptionId: "sub-1",
    delivered: false,
    ...overrides,
  };
}

function makeQueuedEvent(id: string): QueuedEventRecord {
  return {
    event: { id, type: "file:changed", data: {}, timestamp: "t" } as never,
    priority: "normal",
    queuedAt: "t",
    oneShot: false,
  };
}

function setup() {
  const rootReducer = combineReducers({
    agentSubscriptions: agentSubscriptionsReducer,
  });
  const sagaMiddleware = createSagaMiddleware();
  const store = createStore(rootReducer, applyMiddleware(sagaMiddleware));
  const bridgeStore = {
    get state() {
      return store.getState() as MainStoreState;
    },
    dispatch: store.dispatch,
  } as unknown as MainStore;
  initMainStoreBridge(bridgeStore);
  sagaMiddleware.setContext({
    reduxStore: store,
  });
  const task: Task = sagaMiddleware.run(subscriptionsChangedEmitterSaga);
  return { store, task };
}

async function flushAsync(): Promise<void> {
  // Yield to the microtask queue several times so delay(0) + flush() + any
  // queued call(...) promise-resolve cycles all complete before assertions.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function emissionsFor(wsId: string): Array<{ subscriptionVersion: number; reason: string }> {
  return mockedDispatchEvent.mock.calls
    .filter((args) => args[0] === "agent:subscriptions-changed" && args[1] === wsId)
    .map((args) => args[3] as { subscriptionVersion: number; reason: string });
}

let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  mockedDispatchEvent.mockClear();
  __resetSubscriptionVersionCountersForTests();
  ctx = setup();
});

afterEach(() => {
  ctx.task.cancel();
  _resetMainStoreBridge();
});

describe("subscriptionsChangedEmitterSaga — per-action emissions", () => {
  it("addSubscription → exactly one emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
    expect(emissionsFor(WS)[0]).toEqual({
      subscriptionVersion: 1,
      reason: "subscriptions-updated",
    });
  });

  it("removeSubscription → exactly one emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(removeSubscription(WS, "s1"));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
  });

  it("subscribeToDelegationGroup → at least one emission", async () => {
    ctx.store.dispatch(subscribeToDelegationGroup(WS, makeDelegationSeed("dg-sub", CHILD)));
    await flushAsync();
    expect(emissionsFor(WS).length).toBeGreaterThanOrEqual(1);
  });

  it("recordDeliverySuccess → exactly one emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(recordDeliverySuccess(WS, "2026-06-19T15:20:00.000Z"));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
  });

  it("recordDeliveryTimeout → exactly one emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(recordDeliveryTimeout(WS, "2026-06-19T15:21:00.000Z"));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
  });

  it("recordDeliveryFailure → exactly one emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(recordDeliveryFailure(WS, "2026-06-19T15:22:00.000Z"));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
  });

  it("recordDroppedEvents → exactly one emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(recordDroppedEvents(WS, 2));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
  });

  it("coalesces a synchronous deliveryStats burst into one emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();

    ctx.store.dispatch(recordDeliverySuccess(WS, "2026-06-19T15:23:00.000Z"));
    ctx.store.dispatch(recordDeliveryFailure(WS, "2026-06-19T15:23:01.000Z"));
    ctx.store.dispatch(recordDeliveryTimeout(WS, "2026-06-19T15:23:02.000Z"));
    ctx.store.dispatch(recordDroppedEvents(WS, 3));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);

    ctx.store.dispatch(recordDeliverySuccess(WS, "2026-06-19T15:23:03.000Z"));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(2);
  });

  it("markDelegationAgentCompleted → exactly one emission (completedAgentIds only)", async () => {
    ctx.store.dispatch(setDelegationGroup(WS, makeTracker()));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(markDelegationAgentCompleted(WS, GROUP, CHILD));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
  });

  it("setAgentStatus → exactly one emission (agentStatuses is in signature)", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(setAgentStatus(WS, AGENT, "responding"));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(1);
  });

  it("every emitted payload has reason='subscriptions-updated'", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    ctx.store.dispatch(recordDeliverySuccess(WS, "2026-06-19T15:22:00.000Z"));
    await flushAsync();
    ctx.store.dispatch(setAgentStatus(WS, AGENT, "responding"));
    await flushAsync();
    const emissions = emissionsFor(WS);
    expect(emissions.length).toBeGreaterThanOrEqual(3);
    for (const e of emissions) {
      expect(e.reason).toBe("subscriptions-updated");
    }
  });
});

describe("subscriptionsChangedEmitterSaga — excluded actions produce NO emission", () => {
  it("appendDelegationGroupEvent → NO emission (only events array changes)", async () => {
    ctx.store.dispatch(setDelegationGroup(WS, makeTracker()));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(
      appendDelegationGroupEvent(WS, GROUP, {
        id: "e1",
        type: "file:changed",
        data: {},
        timestamp: "t",
      } as never),
    );
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(0);
  });

  it("enqueueEvent → NO emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(enqueueEvent(WS, AGENT, makeQueuedEvent("e1")));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(0);
  });

  it("clearAgentQueue → NO emission", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    ctx.store.dispatch(enqueueEvent(WS, AGENT, makeQueuedEvent("e1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(clearAgentQueue(WS, AGENT));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(0);
  });

  it("clearWorkspace → NO emission (workspace removal)", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    mockedDispatchEvent.mockClear();
    ctx.store.dispatch(clearWorkspace(WS));
    await flushAsync();
    expect(emissionsFor(WS)).toHaveLength(0);
  });
});

describe("subscriptionsChangedEmitterSaga — per-workspace counter independence", () => {
  it("maintains independent monotonic counters for distinct workspaces", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("ws1-s1")));
    await flushAsync();
    ctx.store.dispatch(addSubscription(WS2, { ...makeSub("ws2-s1"), workspaceId: WS2 }));
    await flushAsync();
    ctx.store.dispatch(addSubscription(WS, makeSub("ws1-s2")));
    await flushAsync();
    ctx.store.dispatch(addSubscription(WS2, { ...makeSub("ws2-s2"), workspaceId: WS2 }));
    await flushAsync();

    const ws1 = emissionsFor(WS).map((e) => e.subscriptionVersion);
    const ws2 = emissionsFor(WS2).map((e) => e.subscriptionVersion);
    expect(ws1).toEqual([1, 2]);
    expect(ws2).toEqual([1, 2]);
  });

  it("resets a workspace counter after workspace cleanup", async () => {
    ctx.store.dispatch(addSubscription(WS, makeSub("s1")));
    await flushAsync();
    expect(emissionsFor(WS).map((e) => e.subscriptionVersion)).toEqual([1]);

    ctx.store.dispatch(clearWorkspace(WS));
    await flushAsync();
    mockedDispatchEvent.mockClear();

    ctx.store.dispatch(addSubscription(WS, makeSub("s2")));
    await flushAsync();
    expect(emissionsFor(WS).map((e) => e.subscriptionVersion)).toEqual([1]);
  });
});

