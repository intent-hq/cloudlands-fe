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
} from "../../utils/collection-utils";
import {
  agentQueueReducer,
  clearAgentQueue,
  hydrateAgentQueueRequested,
  initialState,
  replaceAgentQueue,
  setAgentQueueError,
  setAgentQueueHydrating,
} from "./agent-queue-slice";
import {
  selectAgentQueueCount,
  selectAgentQueueError,
  selectAgentQueueHasQueued,
  selectAgentQueueIsHydrating,
  selectAgentQueueMessageById,
  selectAgentQueueMessages,
  selectAgentQueueState,
} from "./agent-queue-selectors";
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

    expect(selectAgentQueueState.select(state, "unknown").isHydrating).toBe(false);
    expect(selectAgentQueueMessages.select(state, "unknown")).toEqual([]);
    expect(selectAgentQueueMessageById.select(state, "unknown", "missing")).toBeUndefined();
    expect(selectAgentQueueCount.select(state, "unknown")).toBe(0);
    expect(selectAgentQueueHasQueued.select(state, "unknown")).toBe(false);
    expect(selectAgentQueueIsHydrating.select(state, "unknown")).toBe(false);
    expect(selectAgentQueueError.select(state, "unknown")).toBeNull();
  });

  it("selects ordered messages, item by ID, count, queued flag, hydration, and error", () => {
    let queueState = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [
      message("queued-2", 2),
      message("queued-1", 1),
    ]));
    queueState = agentQueueReducer(queueState, setAgentQueueHydrating(AGENT_ID, true));
    queueState = agentQueueReducer(queueState, setAgentQueueError(AGENT_ID, "boom"));
    const state = storeWith(queueState);

    expect(selectAgentQueueMessages.select(state, AGENT_ID).map((item) => item.id)).toEqual([
      "queued-2",
      "queued-1",
    ]);
    expect(selectAgentQueueMessageById.select(state, AGENT_ID, "queued-1")?.content).toBe(
      "Message queued-1",
    );
    expect(selectAgentQueueCount.select(state, AGENT_ID)).toBe(2);
    expect(selectAgentQueueHasQueued.select(state, AGENT_ID)).toBe(true);
    expect(selectAgentQueueIsHydrating.select(state, AGENT_ID)).toBe(false);
    expect(selectAgentQueueError.select(state, AGENT_ID)).toBe("boom");
  });
});
