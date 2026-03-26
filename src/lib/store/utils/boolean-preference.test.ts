import { describe, expect, test } from "vitest";
import { createReducer } from "./create-reducer";
import { createAction } from "./create-action";
import { createBooleanPreference } from "./boolean-preference";

type TestState = {
  enabled: boolean;
  hidden: boolean;
  count: number;
};

describe("createBooleanPreference", () => {
  test("creates set/toggle actions with the expected action type strings", () => {
    const preference = createBooleanPreference<TestState>({
      sliceName: "testSlice",
      field: "enabled",
      setActionName: "setEnabled",
      toggleActionName: "toggleEnabled",
    });

    expect(preference.setAction.type).toBe("testSlice/setEnabled");
    expect(preference.toggleAction.type).toBe("testSlice/toggleEnabled");
    expect(preference.setAction(true)).toEqual({
      type: "testSlice/setEnabled",
      payload: [true],
    });
    expect(preference.toggleAction().type).toBe("testSlice/toggleEnabled");
  });

  test("registers reducer handlers for set and toggle without touching other fields", () => {
    const initialState: TestState = { enabled: false, hidden: true, count: 3 };
    const preference = createBooleanPreference<TestState>({
      sliceName: "testSlice",
      field: "enabled",
      setActionName: "setEnabled",
      toggleActionName: "toggleEnabled",
    });

    const reducer = preference.register(createReducer(initialState));

    expect(reducer(initialState, preference.setAction(true))).toEqual({
      enabled: true,
      hidden: true,
      count: 3,
    });
    expect(reducer({ ...initialState, enabled: true }, preference.toggleAction())).toEqual({
      enabled: false,
      hidden: true,
      count: 3,
    });
  });

  test("returns a builder that can continue chaining reducer handlers", () => {
    const initialState: TestState = { enabled: false, hidden: false, count: 1 };
    const preference = createBooleanPreference<TestState>({
      sliceName: "testSlice",
      field: "hidden",
      setActionName: "setHidden",
      toggleActionName: "toggleHidden",
    });
    const setCount = createAction<[value: number]>("testSlice/setCount");

    const reducer = preference.register(createReducer(initialState)).with(
      setCount,
      (state, { payload: [value] }) => ({ ...state, count: value })
    );

    expect(reducer(initialState, preference.toggleAction())).toEqual({
      enabled: false,
      hidden: true,
      count: 1,
    });
    expect(reducer(initialState, setCount(4))).toEqual({
      enabled: false,
      hidden: false,
      count: 4,
    });
  });
});