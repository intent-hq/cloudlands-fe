import { describe, expect, it } from "vitest";
import { appLayoutReducer, initialState } from "./app-layout-slice";

describe("appLayoutReducer", () => {
  it("returns the initial state", () => {
    expect(appLayoutReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });
});