import { afterEach, describe, expect, it, vi } from "vitest";
import { runSaga, stdChannel, END, type Task, type EventChannel } from "redux-saga";
import { take } from "typed-redux-saga";
import { createStore } from "redux";

import type { MainReduxStore, MainStoreState } from "../types";
import {
  _resetMainStoreBridge,
  initMainStoreBridge,
} from "../redux-store-bridge";
import { createSelector } from "./create-selector";
import {
  createChannelFromSelector,
  takeEveryFromSelector,
  type SelectorChannelPayload,
} from "./selector-channel-effects";

type CounterState = {
  counter: { value: number; meta: { label: string } };
};

type Action =
  | { type: "SET_VALUE"; value: number }
  | { type: "SET_LABEL"; label: string };

const reducer = (
  state: CounterState = { counter: { value: 0, meta: { label: "init" } } },
  action: Action,
): CounterState => {
  switch (action.type) {
    case "SET_VALUE":
      return { ...state, counter: { ...state.counter, value: action.value } };
    case "SET_LABEL":
      return {
        ...state,
        counter: { ...state.counter, meta: { ...state.counter.meta, label: action.label } },
      };
    default:
      return state;
  }
};

function setupStore() {
  const store = createStore(reducer as never) as unknown as MainReduxStore;
  const trackedUnsubscribes: Array<ReturnType<typeof vi.fn>> = [];
  const originalSubscribe = store.subscribe.bind(store);
  const patchedSubscribe = (listener: () => void) => {
    const inner = originalSubscribe(listener);
    const tracked = vi.fn(() => inner());
    trackedUnsubscribes.push(tracked);
    return tracked;
  };
  (store as unknown as { subscribe: typeof patchedSubscribe }).subscribe = patchedSubscribe;

  initMainStoreBridge(store);

  return {
    store: store as unknown as MainReduxStore & { dispatch: (a: Action) => Action },
    trackedUnsubscribes,
  };
}

function takeOne<T>(channel: EventChannel<T>): Promise<T | END> {
  return new Promise((resolve) => channel.take((v) => resolve(v as T | END)));
}

afterEach(() => {
  _resetMainStoreBridge();
  vi.restoreAllMocks();
});

describe("createChannelFromSelector (main)", () => {
  it("emits when the selector value changes (default shallow comparer)", async () => {
    const { store } = setupStore();
    const selectValue = createSelector(
      (state: MainStoreState) => (state as unknown as CounterState).counter.value,
    );

    const channel = createChannelFromSelector(selectValue);
    try {
      const firstPromise = takeOne<SelectorChannelPayload<number>>(channel);
      store.dispatch({ type: "SET_VALUE", value: 1 });
      const first = (await firstPromise) as SelectorChannelPayload<number>;

      const secondPromise = takeOne<SelectorChannelPayload<number>>(channel);
      store.dispatch({ type: "SET_VALUE", value: 2 });
      const second = (await secondPromise) as SelectorChannelPayload<number>;

      expect(first.payload).toBe(1);
      expect(first.prevPayload).toBe(0);
      expect(second.payload).toBe(2);
      expect(second.prevPayload).toBe(1);
    } finally {
      channel.close();
    }
  });

  it("emits when the custom comparer reports a change", async () => {
    const { store } = setupStore();
    const selectMeta = createSelector(
      (state: MainStoreState) => (state as unknown as CounterState).counter.meta,
    );
    const isEqual = vi.fn(
      (prev: { label: string } | null | undefined, next: { label: string }) =>
        (prev?.label ?? null) === next.label,
    );

    const channel = createChannelFromSelector(selectMeta, { isEqual });
    try {
      const firstPromise = takeOne<SelectorChannelPayload<{ label: string }>>(channel);
      store.dispatch({ type: "SET_LABEL", label: "one" });
      const first = (await firstPromise) as SelectorChannelPayload<{ label: string }>;

      expect(first.payload.label).toBe("one");
      expect(isEqual).toHaveBeenCalled();
    } finally {
      channel.close();
    }
  });

  it("does NOT emit when the custom comparer reports equal", async () => {
    const { store } = setupStore();
    const selectValue = createSelector(
      (state: MainStoreState) => (state as unknown as CounterState).counter.value,
    );
    const alwaysEqual = vi.fn(() => true);

    const channel = createChannelFromSelector(selectValue, { isEqual: alwaysEqual });
    const received: unknown[] = [];
    const register = () =>
      channel.take((v) => {
        received.push(v);
        if (v !== END) register();
      });
    register();

    try {
      store.dispatch({ type: "SET_VALUE", value: 42 });
      store.dispatch({ type: "SET_VALUE", value: 43 });
      await new Promise((r) => setTimeout(r, 10));

      expect(received).toEqual([]);
      expect(alwaysEqual).toHaveBeenCalled();
    } finally {
      channel.close();
    }
  });

  it("unsubscribes from the store when the channel is closed (no leak)", () => {
    const { trackedUnsubscribes } = setupStore();
    const selectValue = createSelector(
      (state: MainStoreState) => (state as unknown as CounterState).counter.value,
    );

    const channel = createChannelFromSelector(selectValue);
    expect(trackedUnsubscribes).toHaveLength(1);
    expect(trackedUnsubscribes[0]).not.toHaveBeenCalled();

    channel.close();
    expect(trackedUnsubscribes[0]).toHaveBeenCalledTimes(1);
  });

  it("closes the channel when the saga is cancelled (no leak)", async () => {
    const { store, trackedUnsubscribes } = setupStore();
    const selectValue = createSelector(
      (state: MainStoreState) => (state as unknown as CounterState).counter.value,
    );
    const worker = vi.fn(function* () {});

    const task: Task = runSaga(
      {
        channel: stdChannel(),
        dispatch: store.dispatch as never,
        getState: store.getState,
      },
      function* () {
        yield* takeEveryFromSelector(selectValue, worker);
        yield* take("__NEVER__" as never);
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(trackedUnsubscribes.length).toBeGreaterThan(0);
    expect(trackedUnsubscribes[0]).not.toHaveBeenCalled();

    task.cancel();
    await task.toPromise().catch(() => {});

    expect(trackedUnsubscribes[0]).toHaveBeenCalledTimes(1);
  });
});

