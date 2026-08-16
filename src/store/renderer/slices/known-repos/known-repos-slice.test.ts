import {
  describe,
  expect,
  it,
} from "vitest";
import { initialState, knownReposReducer } from "./known-repos-slice";

describe("knownReposReducer", () => {
  it("returns the initial state", () => {
    expect(knownReposReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });
});