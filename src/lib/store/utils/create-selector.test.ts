// We use expectSaga, which works as expect, but eslint does not like it

import {
  describe,
  it,
  expect,
  expectTypeOf,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import {
  get,
  type Readable,
} from "svelte/store";
import {
  take,
  type SagaGenerator,
} from "typed-redux-saga";
import { createSelector } from "./create-selector";
import { createChannelFromSelector } from "./selector-channel-effects";
import { init } from "../init";
import type { StoreState } from "../types";
import {
  lockUpdates,
  unlockUpdates,
} from "../slices/store-utility/store-utility-slice";
import { saveScrollPosition } from "../slices/tab-state/tab-state-slice";
import {
  getDispatch,
  getStoreContext,
} from "./svelte-context";

describe("createSelector", () => {
  describe("Basic selector functionality", () => {
    it("should compute and return values with no arguments", () => {
      const { store } = init();
      const selector = createSelector((state) => state.storeUtility);

      const result = selector.select(store.getState());

      expect(result).toBeDefined();
      expect(result).toBe(store.getState().storeUtility);
    });

    it("should compute and return values with single argument", () => {
      const { store } = init();

      const selector = createSelector((state, _id: string) => {
        return state.storeUtility;
      });

      const result = selector.select(store.getState(), "test-id");

      expect(result).toEqual(store.getState().storeUtility);
    });

    it("should compute and return values with multiple arguments", () => {
      const { store } = init();
      const selector = createSelector((state, id: string, count: number) => {
        return { id, count, hasUtility: !!state.storeUtility };
      });

      const result = selector.select(store.getState(), "test-id", 42);

      expect(result).toEqual({ id: "test-id", count: 42, hasUtility: true });
    });

    it("should access nested state properties", () => {
      const { store } = init();
      const selector = createSelector((state) => {
        return state.storeUtility.updatesLocked;
      });

      const result = selector.select(store.getState());

      expect(result).toBe(false);
    });
  });

  describe("Typing contract", () => {
    it("should keep StoreState first across selector APIs with no extra arguments", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { store } = init();

      expectTypeOf<Parameters<typeof selector.select>>().toEqualTypeOf<[StoreState]>();
      expectTypeOf<ReturnType<typeof selector.select>>().toEqualTypeOf<boolean>();
      expectTypeOf<Parameters<typeof selector.effect>>().toEqualTypeOf<[]>();
      expectTypeOf<ReturnType<typeof selector.effect>>().toEqualTypeOf<SagaGenerator<boolean>>();
      expectTypeOf<Parameters<typeof selector>>().toEqualTypeOf<[]>();
      expectTypeOf<ReturnType<typeof selector>>().toEqualTypeOf<Readable<boolean>>();
      expectTypeOf<Parameters<typeof withStoreSelector>>().toEqualTypeOf<[]>();
      expectTypeOf<ReturnType<typeof withStoreSelector>>().toEqualTypeOf<Readable<boolean>>();
    });

    it("should type extra arguments without leaking StoreState into effect or readable APIs", () => {
      const { store } = init();
      type SelectorResult = { id: string; count: number; locked: boolean };

      const selector = createSelector(
        (state: StoreState, id: string, count: number): SelectorResult => ({
          id,
          count,
          locked: state.storeUtility.updatesLocked,
        })
      );
      const withStoreSelector = selector.withStore(store);

      expectTypeOf<Parameters<typeof selector.select>>().toEqualTypeOf<[
        StoreState,
        string,
        number,
      ]>();
      expectTypeOf<ReturnType<typeof selector.select>>().toEqualTypeOf<SelectorResult>();
      expectTypeOf<Parameters<typeof selector.effect>>().toEqualTypeOf<[string, number]>();
      expectTypeOf<ReturnType<typeof selector.effect>>().toEqualTypeOf<
        SagaGenerator<SelectorResult>
      >();
      expectTypeOf<Parameters<typeof selector>>().toEqualTypeOf<[
        string | Readable<string>,
        number | Readable<number>,
      ]>();
      expectTypeOf<ReturnType<typeof selector>>().toEqualTypeOf<Readable<SelectorResult>>();
      expectTypeOf<Parameters<typeof withStoreSelector>>().toEqualTypeOf<[
        string | Readable<string>,
        number | Readable<number>,
      ]>();
      expectTypeOf<ReturnType<typeof withStoreSelector>>().toEqualTypeOf<
        Readable<SelectorResult>
      >();

      const result = selector.select(store.getState(), "test-id", 42);
      expect(result).toEqual({ id: "test-id", count: 42, locked: false });

      // @ts-expect-error StoreState must remain the first callback parameter to createSelector
      const invalidSelector = createSelector((id: string, state: StoreState) => ({
        id,
        locked: state.storeUtility.updatesLocked,
      }));
      // @ts-expect-error .select requires StoreState as the first argument
      const invalidSelectCall = () => selector.select("test-id", 42);
      // @ts-expect-error .effect only accepts the selector's extra arguments
      const invalidEffectCall = () => selector.effect(store.getState(), "test-id", 42);
      // @ts-expect-error the readable selector surface accepts only extra args / readables, never StoreState
      const invalidReadableCall = () => withStoreSelector(store.getState(), 42);

      void invalidSelector;
      void invalidSelectCall;
      void invalidEffectCall;
      void invalidReadableCall;
    });
  });

  describe("Lifecycle error messages", () => {
    it("should throw a helpful error when readable selectors are called outside component init", () => {
      const selector = createSelector((state: StoreState) => state.storeUtility.updatesLocked);

      expect(() => selector()).toThrowError(
        "Selector called outside component initialization. The readable form of selectors (e.g., selectFoo()) can only be called during component init (top-level <script> block). For event handlers, callbacks, or async functions, use selector.select(getReduxStore().getState(), ...args) instead."
      );
    });

    it("should throw a helpful error when getDispatch is called outside component init", () => {
      expect(() => getDispatch()).toThrowError(
        "getDispatch() called outside component initialization. Call getDispatch() during component init (top-level <script> block) and store the returned dispatch function for event handlers, callbacks, or async functions."
      );
    });

    it("should throw a helpful error when getStoreContext is called outside component init", () => {
      expect(() => getStoreContext()).toThrowError(
        "Store context accessed outside component initialization. Store context helpers can only be called during component init (top-level <script> block)."
      );
    });
  });

  describe("Reactivity and memoization", () => {
    it("should return cached value when called with same arguments and unchanged state", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState, id: string) => ({
        id,
        value: state.storeUtility,
      }));
      const selector = createSelector(computeFn);
      const readable = selector.withStore(store);

      // Create a single readable store instance and read from it multiple times
      const readableInstance = readable("test-id");
      const result1 = get(readableInstance);
      const result2 = get(readableInstance);
      const result3 = get(readableInstance);
      const result4 = get(readableInstance);
      const result5 = get(readableInstance);

      // All results should have the same content
      expect(result1).toStrictEqual(result2);
      expect(result2).toStrictEqual(result3);
      expect(result3).toStrictEqual(result4);
      expect(result4).toStrictEqual(result5);

      // Function should be called only once due to caching within the derived store
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it("should recompute when arguments change", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState, id: string) => ({
        id,
        value: state.storeUtility,
      }));
      const selector = createSelector(computeFn);

      const result1 = selector.select(store.getState(), "id-1");
      const result2 = selector.select(store.getState(), "id-2");

      expect(computeFn).toHaveBeenCalledTimes(2);
      expect(result1).not.toBe(result2);
      expect(result1.id).toBe("id-1");
      expect(result2.id).toBe("id-2");
    });

    it("should recompute when accessed state fields change", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState) => state.storeUtility.updatesLocked);
      const selector = createSelector(computeFn);

      // First call
      const result1 = selector.select(store.getState());
      expect(result1).toBe(false);
      expect(computeFn).toHaveBeenCalledTimes(1);

      // Change the accessed field
      store.dispatch(lockUpdates());

      // Should recompute
      const result2 = selector.select(store.getState());
      expect(result2).toBe(true);
      expect(computeFn).toHaveBeenCalledTimes(2);
    });

    it("should NOT recompute when unrelated state fields change", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState) => state.storeUtility.updatesLocked);
      const selector = createSelector(computeFn);
      const readable = selector.withStore(store);

      // Create a single readable instance and establish tracking
      const readableInstance = readable();
      const initialResult = get(readableInstance);
      const callCountAfterInit = computeFn.mock.calls.length;

      // Change an unrelated field (tabState.scrollPositions, not storeUtility.updatesLocked)
      store.dispatch(saveScrollPosition("tab-1", 100));

      // Should NOT recompute because we only track storeUtility.updatesLocked
      const result1 = get(readableInstance);
      const result2 = get(readableInstance);

      // Results should be the same
      expect(result1).toBe(initialResult);
      expect(result2).toBe(initialResult);
      // Should not have called the function many more times
      expect(computeFn.mock.calls.length).toBeLessThanOrEqual(callCountAfterInit + 1);
    });

    it("should track nested property access", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState) => {
        // Access nested property
        return state.tabState.scrollPositions;
      });
      const selector = createSelector(computeFn);
      const readable = selector.withStore(store);

      // Create a single readable instance
      const readableInstance = readable();
      const initialResult = get(readableInstance);
      const callCountAfterInit = computeFn.mock.calls.length;

      // Change unrelated field (storeUtility, not tabState)
      store.dispatch(lockUpdates());
      store.dispatch(unlockUpdates());

      // Should not recompute - result should be same reference
      const resultAfterUnrelatedChange = get(readableInstance);
      expect(resultAfterUnrelatedChange).toBe(initialResult);
      expect(computeFn.mock.calls.length).toBeLessThanOrEqual(callCountAfterInit + 1);

      // Change the tracked property
      store.dispatch(saveScrollPosition("tab-1", 100));

      // Should recompute - result should be different
      const resultAfterTrackedChange = get(readableInstance);
      expect(resultAfterTrackedChange).not.toBe(initialResult);
      expect(computeFn.mock.calls.length).toBeGreaterThan(callCountAfterInit);
    });

    it("should handle multiple state accesses", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState) => ({
        locked: state.storeUtility.updatesLocked,
        positions: state.tabState.scrollPositions,
      }));
      const selector = createSelector(computeFn);

      selector.select(store.getState());
      expect(computeFn).toHaveBeenCalledTimes(1);

      // Change one of the tracked fields
      store.dispatch(lockUpdates());

      selector.select(store.getState());
      expect(computeFn).toHaveBeenCalledTimes(2);

      // Change the other tracked field
      store.dispatch(saveScrollPosition("tab-1", 100));

      selector.select(store.getState());
      expect(computeFn).toHaveBeenCalledTimes(3);
    });

    it("should work with readable store (Svelte store integration)", () => {
      const { store } = init();
      const selector = createSelector((state: StoreState) => state.tabState.scrollPositions);

      const readable = selector.withStore(store)();
      const value1 = get(readable);
      expect(value1).toEqual({});

      // Change state
      store.dispatch(saveScrollPosition("tab-1", 200));

      const value2 = get(readable);
      expect(value2).toEqual({ "tab-1": 200 });
    });

    it("should handle object return values from state", () => {
      const { store } = init();

      // Create a selector that accesses an object property
      const selector = createSelector((state: StoreState) => {
        // Access positions object
        const positions = state.tabState.scrollPositions;
        return Object.keys(positions).length;
      });

      const result = selector.select(store.getState());
      expect(typeof result).toBe("number");
    });
  });

  describe("selectEffect method", () => {
    it("should return a saga effect that can be used with select", async () => {
      const selector = createSelector((state: StoreState) => state.storeUtility.updatesLocked);

      function* testSaga() {
        const value = yield* selector.effect();
        return value;
      }

      const result = await expectSaga(testSaga)
        .provide([[matchers.select.selector(selector.select), false]])
        .run();

      expect(result.returnValue).toBe(false);
    });

    it("should work with arguments in selectEffect", async () => {
      const selector = createSelector((state: StoreState, id: string) => ({
        id,
        locked: state.storeUtility.updatesLocked,
      }));

      function* testSaga() {
        const value = yield* selector.effect("test-id");
        return value;
      }

      const result = await expectSaga(testSaga)
        .provide([[matchers.select.selector(selector.select), { id: "test-id", locked: false }]])
        .run();

      expect(result.returnValue).toEqual({ id: "test-id", locked: false });
    });

    it("should integrate with real Redux state in saga", async () => {
      const { store } = init();
      const selector = createSelector((state: StoreState) => state.storeUtility.updatesLocked);

      function* testSaga() {
        const value = yield* selector.effect();
        return value;
      }

      const result = await expectSaga(testSaga).withState(store.getState()).run();

      expect(result.returnValue).toBe(false);
    });
  });

  describe("createChannelFromSelector", () => {
    it("should create an event channel that emits on value changes", async () => {
      const { store, storeState } = init();
      const selector = createSelector((state: StoreState) => state.tabState.scrollPositions);

      function* testSaga() {
        const channel = yield* createChannelFromSelector(selector);
        const event = yield* take(channel);
        return event;
      }

      const sagaPromise = expectSaga(testSaga)
        .provide([[matchers.getContext("readableStoreState"), storeState]])
        .run({ timeout: 1000 });

      // Give the saga time to set up the channel
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Dispatch action to change state
      store.dispatch(saveScrollPosition("tab-1", 100));

      const result = await sagaPromise;

      expect(result.returnValue).toBeDefined();
      expect(result.returnValue.payload).toEqual({ "tab-1": 100 });
      expect(result.returnValue.prevPayload).toEqual({});
    });

    it("should include prevPayload in channel emissions", async () => {
      const { store, storeState } = init();
      const selector = createSelector((state: StoreState) => state.tabState.scrollPositions);

      function* testSaga() {
        const channel = yield* createChannelFromSelector(selector);
        const event1 = yield* take(channel);
        const event2 = yield* take(channel);
        return { event1, event2 };
      }

      const sagaPromise = expectSaga(testSaga)
        .provide([[matchers.getContext("readableStoreState"), storeState]])
        .run({ timeout: 1000 });

      await new Promise((resolve) => setTimeout(resolve, 50));

      store.dispatch(saveScrollPosition("tab-1", 100));
      await new Promise((resolve) => setTimeout(resolve, 50));

      store.dispatch(saveScrollPosition("tab-2", 200));

      const result = await sagaPromise;

      console.log(result);

      expect(result.returnValue.event1.payload).toEqual({ "tab-1": 100 });
      expect(result.returnValue.event1.prevPayload).toEqual({});
      expect(result.returnValue.event2.payload).toEqual({ "tab-1": 100, "tab-2": 200 });
      expect(result.returnValue.event2.prevPayload).toEqual({ "tab-1": 100 });
    });

    it("should handle channel with arguments", () => {
      const selector = createSelector((state: StoreState, multiplier: number) => ({
        value: state.storeUtility.updatesLocked ? multiplier : 0,
      }));

      // Test that createChannelFromSelector returns a generator function
      const channelGenerator = createChannelFromSelector(selector, 10);
      expect(typeof channelGenerator).toBe("object");
      expect(typeof channelGenerator.next).toBe("function");

      // This verifies createChannelFromSelector accepts arguments correctly
      // The actual channel emission behavior is tested in other channel tests
    });
  });

  describe("Edge cases", () => {
    it("should respect updatesLocked flag for lockable selectors", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState) => state.tabState.scrollPositions);
      const selector = createSelector(computeFn);

      // Create a readable (lockable) selector
      const readable = selector.withStore(store)();

      // First read
      const value1 = get(readable);
      expect(value1).toEqual({});
      expect(computeFn).toHaveBeenCalledTimes(1);

      // Lock updates
      store.dispatch(lockUpdates());

      // While locked, if state hasn't changed, readable should return cached value
      const value2 = get(readable);
      expect(value2).toEqual({});
      expect(computeFn).toHaveBeenCalledTimes(1);
      // The selector returns the cached value because the tracked state (tabState.scrollPositions) hasn't changed
      // Note: This is a performance optimization for batch updates

      // Unlock updates
      store.dispatch(unlockUpdates());

      // State still hasn't changed, so should still use cached value
      const value3 = get(readable);
      expect(value3).toEqual({});
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it("should handle null and undefined values", () => {
      const { store } = init();
      const selector = createSelector((_state: StoreState, value: string | null | undefined) => {
        return { value, hasValue: value != null };
      });

      const result1 = selector.select(store.getState(), null);
      expect(result1).toEqual({ value: null, hasValue: false });

      const result2 = selector.select(store.getState(), undefined);
      expect(result2).toEqual({ value: undefined, hasValue: false });

      const result3 = selector.select(store.getState(), "test");
      expect(result3).toEqual({ value: "test", hasValue: true });
    });

    it("should handle primitive return values", () => {
      const { store } = init();


      const stringSelector = createSelector((_state: StoreState) => "constant");
      expect(stringSelector.select(store.getState())).toBe("constant");


      const numberSelector = createSelector((_state: StoreState) => 42);
      expect(numberSelector.select(store.getState())).toBe(42);


      const booleanSelector = createSelector((_state: StoreState) => true);
      expect(booleanSelector.select(store.getState())).toBe(true);
    });

    it("should handle array return values", () => {
      const { store } = init();

      const selector = createSelector((_state: StoreState) => {
        return Object.keys(store.getState().tabState.scrollPositions);
      });

      const result = selector.select(store.getState());
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle selector composition (selector calling another selector)", () => {
      const { store } = init();

      const baseSelector = createSelector((state: StoreState) => state.storeUtility.updatesLocked);

      const composedSelector = createSelector((state: StoreState) => {
        const locked = baseSelector.select(state);
        return { locked, inverted: !locked };
      });

      const result = composedSelector.select(store.getState());
      expect(result).toEqual({ locked: false, inverted: true });
    });

    it("should not create proxy from proxy (getRawValue)", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState) => state.storeUtility);

      const selector1 = createSelector(computeFn);
      const selector2 = createSelector((state: StoreState) => {
        // This selector calls another selector, passing potentially proxied state
        return selector1.select(state);
      });

      const result = selector2.select(store.getState());
      expect(result).toBeDefined();
      expect(result.updatesLocked).toBe(false);
    });

    it("should handle empty state access (no properties accessed)", () => {
      const { store } = init();

      const computeFn = vi.fn((_state: StoreState) => {
        // Don't access any state properties
        return "constant";
      });
      const selector = createSelector(computeFn);
      const readable = selector.withStore(store);

      // Create a single readable instance
      const readableInstance = readable();
      const _result1 = get(readableInstance);
      expect(_result1).toBe("constant");
      const callCountAfterInit = computeFn.mock.calls.length;

      const result2 = get(readableInstance);
      expect(result2).toBe("constant");

      // Change state
      store.dispatch(lockUpdates());

      // Should not recompute since no state was accessed
      const result3 = get(readableInstance);
      expect(result3).toBe("constant");
      // Should not have called many more times since no state was accessed
      expect(computeFn.mock.calls.length).toBeLessThanOrEqual(callCountAfterInit + 1);
    });

    it("should handle deeply nested state access", () => {
      const { store } = init();
      const selector = createSelector((state: StoreState) => {
        // Access deeply nested state
        return {
          locked: state.storeUtility.updatesLocked,
          positions: state.tabState.scrollPositions,
        };
      });

      const result = selector.select(store.getState());
      expect(result).toBeDefined();
      expect(typeof result.locked).toBe("boolean");
      expect(typeof result.positions).toBe("object");
    });

    it("should handle withStore method", () => {
      const { store } = init();
      const selector = createSelector((state: StoreState) => state.storeUtility.updatesLocked);

      const readable = selector.withStore(store)();
      const value = get(readable);

      expect(value).toBe(false);
    });

    it("should handle withStore with arguments", () => {
      const { store } = init();
      const selector = createSelector((state: StoreState, id: string) => ({
        id,
        locked: state.storeUtility.updatesLocked,
      }));

      const readable = selector.withStore(store)("test-id");
      const value = get(readable);

      expect(value).toEqual({ id: "test-id", locked: false });
    });

    it("should handle rapid state changes", () => {
      const { store } = init();
      const computeFn = vi.fn((state: StoreState) => state.storeUtility.updatesLocked);
      const selector = createSelector(computeFn);

      // Initial call
      selector.select(store.getState());
      expect(computeFn).toHaveBeenCalledTimes(1);

      // Rapid changes
      store.dispatch(lockUpdates());
      selector.select(store.getState());
      expect(computeFn).toHaveBeenCalledTimes(2);

      store.dispatch(unlockUpdates());
      selector.select(store.getState());
      expect(computeFn).toHaveBeenCalledTimes(3);

      store.dispatch(lockUpdates());
      selector.select(store.getState());
      expect(computeFn).toHaveBeenCalledTimes(4);
    });
  });
});
