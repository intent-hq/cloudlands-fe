import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import {
  clearHomePageInitializerRequest,
  clearPendingDeepLinkAction,
  deepLinkError,
  deepLinkProcessingComplete,
  deepLinkReceived,
  deepLinksReducer,
  initialState,
  requestHomePageInitializer,
} from "./deep-links-slice";
import {
  selectDeepLinkError,
  selectDeepLinkProcessing,
  selectHomePageInitializerRequest,
  selectPendingDeepLinkAction,
} from "./deep-links-selectors";

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

  it("sets pending action and processing on deepLinkReceived", () => {
    const action = { type: "open" as const, params: { id: "ws-123" } };
    const state = deepLinksReducer(initialState, deepLinkReceived(action));
    expect(state.pendingAction).toEqual(action);
    expect(state.processing).toBe(true);
    expect(state.error).toBeNull();
  });

  it("clears pending action on deepLinkProcessingComplete", () => {
    const withPending = deepLinksReducer(
      initialState,
      deepLinkReceived({ type: "open", params: { id: "ws-123" } })
    );
    const state = deepLinksReducer(withPending, deepLinkProcessingComplete());
    expect(state.pendingAction).toBeNull();
    expect(state.processing).toBe(false);
  });

  it("sets error on deepLinkError", () => {
    const withPending = deepLinksReducer(
      initialState,
      deepLinkReceived({ type: "open", params: { id: "ws-123" } })
    );
    const state = deepLinksReducer(withPending, deepLinkError("Not found"));
    expect(state.error).toBe("Not found");
    expect(state.processing).toBe(false);
  });

  it("clears pending action only on clearPendingDeepLinkAction", () => {
    const withPending = deepLinksReducer(
      initialState,
      deepLinkReceived({ type: "create", params: { repo: "/repo" } })
    );
    const state = deepLinksReducer(withPending, clearPendingDeepLinkAction());
    expect(state.pendingAction).toBeNull();
  });

  it("exposes deep link state through selectors", () => {
    const action = { type: "clone" as const, params: { repo: "https://github.com/test" } };
    const storeState = {
      deepLinks: deepLinksReducer(initialState, deepLinkReceived(action)),
    } as StoreState;

    expect(selectPendingDeepLinkAction.select(storeState)).toEqual(action);
    expect(selectDeepLinkProcessing.select(storeState)).toBe(true);
    expect(selectDeepLinkError.select(storeState)).toBeNull();
  });
});