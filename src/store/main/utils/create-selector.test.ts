import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";

import type { StoreState } from "$lib/store/types";

import type { MainStoreState } from "../types";
import { createSelector } from "./create-selector";

type TestMainState = MainStoreState & {
  foo: { value: number; nested: { label: string } };
  bar: { untouched: boolean };
};

const createState = (overrides?: Partial<TestMainState>): TestMainState =>
  ({
    foo: { value: 1, nested: { label: "one" } },
    bar: { untouched: false },
    ...overrides,
  }) as TestMainState;

describe("main createSelector", () => {
  it("keeps MainStoreState first across selector APIs", () => {
    const selector = createSelector((state: MainStoreState, id: string) => ({ id, state }));

    expectTypeOf<Parameters<typeof selector.select>>().toEqualTypeOf<[MainStoreState, string]>();
    expectTypeOf<Parameters<typeof selector.effect>>().toEqualTypeOf<[string]>();

    // @ts-expect-error renderer StoreState must not be accepted by main selectors
    const invalidSelectCall = (rendererState: StoreState) => selector.select(rendererState, "id");

    void invalidSelectCall;
  });

  it("returns cached references when state and args are unchanged", () => {
    const state = createState();
    const computeFn = vi.fn((input: MainStoreState, id: string) => {
      const typedState = input as TestMainState;
      return { id, label: typedState.foo.nested.label };
    });
    const selector = createSelector(computeFn);

    const result1 = selector.select(state, "item-1");
    const result2 = selector.select(state, "item-1");

    expect(result1).toBe(result2);
    expect(computeFn).toHaveBeenCalledTimes(1);
  });

  it("recomputes when a tracked state path changes", () => {
    const computeFn = vi.fn((input: MainStoreState) => {
      const typedState = input as TestMainState;
      return { value: typedState.foo.value };
    });
    const selector = createSelector(computeFn);

    const result1 = selector.select(createState());
    const result2 = selector.select(createState({ foo: { value: 2, nested: { label: "one" } } }));

    expect(result2).not.toBe(result1);
    expect(result2).toEqual({ value: 2 });
    expect(computeFn).toHaveBeenCalledTimes(2);
  });

  it("does not recompute when only unrelated state changes", () => {
    const computeFn = vi.fn((input: MainStoreState) => {
      const typedState = input as TestMainState;
      return { value: typedState.foo.value };
    });
    const selector = createSelector(computeFn);

    const state1 = createState();
    const state2 = { ...state1, bar: { untouched: true } } as TestMainState;
    const result1 = selector.select(state1);
    const result2 = selector.select(state2);

    expect(result2).toBe(result1);
    expect(computeFn).toHaveBeenCalledTimes(1);
  });

  it("guard is skipped in test environments (VITEST=true)", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      const selector = createSelector((state: MainStoreState) => state);
      // In vitest the guard is intentionally skipped so main-process
      // selectors can be unit-tested without mocking window away.
      expect(() => selector.select(createState())).not.toThrow();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("creates a typed saga select effect", async () => {
    const selector = createSelector((input: MainStoreState, id: string) => {
      const typedState = input as TestMainState;
      return { id, label: typedState.foo.nested.label };
    });
    const state = createState();

    function* testSaga() {
      return yield* selector.effect("item-1");
    }

    const result = await expectSaga(testSaga)
      .withState(state)
      .provide([[matchers.select.selector(selector.select), { id: "item-1", label: "one" }]])
      .run();

    expect(result.returnValue).toEqual({ id: "item-1", label: "one" });
  });
});