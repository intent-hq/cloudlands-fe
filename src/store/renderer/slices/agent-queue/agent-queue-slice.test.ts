import type { QueuedMessage } from "$shared/types";
import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import {
  getItem,
  getItems,
} from "$lib/store-shim/utils/collections/collection-utils";
import {
  agentQueueReducer,
  clearAgentQueue,
  hydrateAgentQueueRequested,
  initialState,
  removeQueuedMessageFromAgentQueue,
  removeQueuedMessageRequested,
  replaceAgentQueue,
  restoreRecentlyRemovedMessageId,
  setAgentQueueError,
  setAgentQueueHydrating,
} from "./agent-queue-slice";
import { selectAgentQueueMessages } from "./agent-queue-selectors";
import type { AgentQueueState } from "./agent-queue-types";

const AGENT_ID = "agent-1";

function message(id: string, position: number): QueuedMessage {
  return {
    id,
    content: `Message ${id}`,
    queuedAt: `2026-05-06T00:00:0${position}.000Z`,
    position,
  };
}

function storeWith(agentQueue: AgentQueueState): StoreState {
  return { agentQueue } as StoreState;
}

describe("agentQueueReducer", () => {
  it("returns initial state", () => {
    expect(agentQueueReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("marks an agent queue as hydrating on hydrate request", () => {
    const state = agentQueueReducer(initialState, hydrateAgentQueueRequested(AGENT_ID));
    expect(state.byAgentId[AGENT_ID].isHydrating).toBe(true);
    expect(state.byAgentId[AGENT_ID].error).toBeNull();
  });

  it("replaces an agent queue with a Collection and preserves message order", () => {
    const messages = [message("second", 1), message("first", 0)];
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, messages));

    expect(getItems(state.byAgentId[AGENT_ID].messages)).toEqual(messages);
    expect(state.byAgentId[AGENT_ID].messages.ids).toEqual(["second", "first"]);
    expect(getItem(state.byAgentId[AGENT_ID].messages, "first")).toEqual(messages[1]);
    expect(state.byAgentId[AGENT_ID].isHydrating).toBe(false);
    expect(state.byAgentId[AGENT_ID].error).toBeNull();
  });

  it("clears an agent queue and returns same ref for unknown agents", () => {
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [message("m1", 0)]));
    const cleared = agentQueueReducer(state, clearAgentQueue(AGENT_ID));
    const unchanged = agentQueueReducer(cleared, clearAgentQueue("unknown"));

    expect(cleared.byAgentId[AGENT_ID]).toBeUndefined();
    expect(unchanged).toBe(cleared);
  });

  it("removes one queued message and repositions remaining messages", () => {
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [
      message("m1", 0),
      message("m2", 1),
      message("m3", 2),
    ]));
    const next = agentQueueReducer(state, removeQueuedMessageFromAgentQueue(AGENT_ID, "m2"));
    const unchanged = agentQueueReducer(next, removeQueuedMessageFromAgentQueue(AGENT_ID, "m2"));

    expect(getItems(next.byAgentId[AGENT_ID].messages).map((item) => [item.id, item.position])).toEqual([
      ["m1", 0],
      ["m3", 1],
    ]);
    expect(getItem(next.byAgentId[AGENT_ID].messages, "m2")).toBeUndefined();
    expect(unchanged).toBe(next);
  });

  it("records removal tombstones without a local queued message and suppresses stale snapshots", () => {
    const removedBeforeHydration = agentQueueReducer(
      initialState,
      removeQueuedMessageFromAgentQueue(AGENT_ID, "sent-before-hydration"),
    );
    const staleAfterMissingEntry = agentQueueReducer(
      removedBeforeHydration,
      replaceAgentQueue(AGENT_ID, [
        message("sent-before-hydration", 0),
        message("still-queued", 1),
      ]),
    );
    const hydrated = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message("still-local", 0)]),
    );
    const removedMissingMessage = agentQueueReducer(
      hydrated,
      removeQueuedMessageFromAgentQueue(AGENT_ID, "sent-missing-locally"),
    );
    const staleAfterMissingMessage = agentQueueReducer(
      removedMissingMessage,
      replaceAgentQueue(AGENT_ID, [
        message("sent-missing-locally", 0),
        message("still-local", 1),
      ]),
    );

    expect(removedBeforeHydration.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual([
      "sent-before-hydration",
    ]);
    expect(getItems(staleAfterMissingEntry.byAgentId[AGENT_ID].messages).map((item) => [
      item.id,
      item.position,
    ])).toEqual([["still-queued", 0]]);
    expect(removedMissingMessage.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual([
      "sent-missing-locally",
    ]);
    expect(getItems(staleAfterMissingMessage.byAgentId[AGENT_ID].messages).map((item) => [
      item.id,
      item.position,
    ])).toEqual([["still-local", 0]]);
  });

  it("does not reintroduce a removed queued message from a stale queue snapshot", () => {
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [
      message("sent-now", 0),
      message("still-queued", 1),
    ]));
    const removed = agentQueueReducer(
      state,
      removeQueuedMessageFromAgentQueue(AGENT_ID, "sent-now"),
    );
    const staleReplacement = agentQueueReducer(
      removed,
      replaceAgentQueue(AGENT_ID, [
        message("sent-now", 0),
        message("still-queued", 1),
        message("newer", 2),
      ]),
    );

    expect(getItems(staleReplacement.byAgentId[AGENT_ID].messages).map((item) => [
      item.id,
      item.position,
    ])).toEqual([
      ["still-queued", 0],
      ["newer", 1],
    ]);
    expect(getItem(staleReplacement.byAgentId[AGENT_ID].messages, "sent-now")).toBeUndefined();
    expect(JSON.parse(JSON.stringify(staleReplacement))).toEqual(staleReplacement);
  });

  it("restores a recently-removed ID so a later snapshot can bring the message back", () => {
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [
      message("m1", 0),
      message("m2", 1),
    ]));
    const removed = agentQueueReducer(
      state,
      removeQueuedMessageFromAgentQueue(AGENT_ID, "m1"),
    );
    const restored = agentQueueReducer(
      removed,
      restoreRecentlyRemovedMessageId(AGENT_ID, "m1"),
    );
    const rehydrated = agentQueueReducer(
      restored,
      replaceAgentQueue(AGENT_ID, [message("m1", 0), message("m2", 1)]),
    );

    expect(removed.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual(["m1"]);
    expect(restored.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual([]);
    expect(getItems(rehydrated.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("returns same state when restoring unknown agents or IDs that are not marked removed", () => {
    const state = agentQueueReducer(
      initialState,
      removeQueuedMessageFromAgentQueue(AGENT_ID, "m1"),
    );

    expect(agentQueueReducer(state, restoreRecentlyRemovedMessageId("unknown", "m1"))).toBe(
      state,
    );
    expect(agentQueueReducer(state, restoreRecentlyRemovedMessageId(AGENT_ID, "other"))).toBe(
      state,
    );
  });

  it("does not change state for the removeQueuedMessageRequested saga trigger", () => {
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [message("m1", 0)]));
    const next = agentQueueReducer(state, removeQueuedMessageRequested(AGENT_ID, "m1"));

    expect(next).toBe(state);
  });

  it("keeps stale suppression bounded so old removed IDs can appear in future snapshots", () => {
    let state = initialState;
    for (let index = 0; index < 101; index++) {
      state = agentQueueReducer(
        state,
        replaceAgentQueue(AGENT_ID, [message(`removed-${index}`, 0)]),
      );
      state = agentQueueReducer(
        state,
        removeQueuedMessageFromAgentQueue(AGENT_ID, `removed-${index}`),
      );
    }

    const next = agentQueueReducer(
      state,
      replaceAgentQueue(AGENT_ID, [
        message("removed-0", 0),
        message("removed-100", 1),
        message("unrelated", 2),
      ]),
    );

    expect(getItems(next.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual([
      "removed-0",
      "unrelated",
    ]);
  });

  it("sets and clears hydration without creating an idle unknown queue", () => {
    const unchanged = agentQueueReducer(initialState, setAgentQueueHydrating("unknown", false));
    const hydrating = agentQueueReducer(initialState, setAgentQueueHydrating(AGENT_ID, true));
    const idle = agentQueueReducer(hydrating, setAgentQueueHydrating(AGENT_ID, false));

    expect(unchanged).toBe(initialState);
    expect(hydrating.byAgentId[AGENT_ID].isHydrating).toBe(true);
    expect(idle.byAgentId[AGENT_ID].isHydrating).toBe(false);
  });

  it("sets error and stops hydrating", () => {
    const hydrating = agentQueueReducer(initialState, hydrateAgentQueueRequested(AGENT_ID));
    const errored = agentQueueReducer(hydrating, setAgentQueueError(AGENT_ID, "failed"));

    expect(errored.byAgentId[AGENT_ID].isHydrating).toBe(false);
    expect(errored.byAgentId[AGENT_ID].error).toBe("failed");
  });

  it("does not mutate previous state when replacing the queue", () => {
    const previous = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [message("m1", 0)]));
    const next = agentQueueReducer(previous, replaceAgentQueue(AGENT_ID, [message("m2", 1)]));

    expect(next).not.toBe(previous);
    expect(getItems(previous.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual(["m1"]);
    expect(getItems(next.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual(["m2"]);
  });
});

describe("agent queue selectors", () => {
  it("returns default values for unknown agents", () => {
    const state = storeWith(initialState);

    expect(selectAgentQueueMessages.select(state, "unknown")).toEqual([]);
  });

  it("selects ordered messages", () => {
    const queueState = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [
      message("queued-2", 2),
      message("queued-1", 1),
    ]));
    const state = storeWith(queueState);

    expect(selectAgentQueueMessages.select(state, AGENT_ID).map((item) => item.id)).toEqual([
      "queued-2",
      "queued-1",
    ]);
  });
});
