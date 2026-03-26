import { describe, expect, it } from "vitest";
import { initialState, uiNotificationsReducer, type UiNotificationsState } from "./ui-notifications-slice";

describe("uiNotificationsReducer", () => {
  it("returns the initial state", () => {
    expect(uiNotificationsReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("ignores unknown actions", () => {
    const state: UiNotificationsState = {};
    expect(uiNotificationsReducer(state, { type: "uiNotifications/unknown" })).toBe(state);
  });
});