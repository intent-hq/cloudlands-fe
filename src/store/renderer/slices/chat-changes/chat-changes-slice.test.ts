import {
  describe,
  expect,
  it,
} from "vitest";
import { chatChangesReducer, initialState } from "./chat-changes-slice";

describe("chatChangesReducer", () => {
  it("returns the initial state", () => {
    expect(chatChangesReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });
});