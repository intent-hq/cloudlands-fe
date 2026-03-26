import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import {
  clearHomePageInitializerRequest,
  deepLinksReducer,
  initialState,
  requestHomePageInitializer,
} from "./deep-links-slice";
import { selectHomePageInitializerRequest } from "./deep-links-selectors";

describe("deepLinksReducer", () => {
  it("returns the initial state", () => {
    expect(deepLinksReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores initializer requests with incrementing nonces", () => {
    const firstState = deepLinksReducer(initialState, requestHomePageInitializer({ focus: true }));
    expect(firstState.homePageInitializerRequest).toEqual({
      nonce: 1,
      applyPrefill: false,
      focus: true,
    });

    const secondState = deepLinksReducer(
      firstState,
      requestHomePageInitializer({ applyPrefill: true })
    );
    expect(secondState.homePageInitializerRequest).toEqual({
      nonce: 2,
      applyPrefill: true,
      focus: false,
    });
  });

  it("clears the initializer request", () => {
    const state = deepLinksReducer(initialState, requestHomePageInitializer({ focus: true }));
    expect(deepLinksReducer(state, clearHomePageInitializerRequest()).homePageInitializerRequest).toBeNull();
  });

  it("exposes the initializer request through the selector", () => {
    const state = {
      deepLinks: deepLinksReducer(initialState, requestHomePageInitializer({ applyPrefill: true })),
    } as StoreState;

    expect(selectHomePageInitializerRequest.select(state)).toEqual({
      nonce: 1,
      applyPrefill: true,
      focus: false,
    });
  });
});