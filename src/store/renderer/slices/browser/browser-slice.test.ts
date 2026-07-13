import {
  describe,
  it,
  expect,
} from "vitest";
import {
  combineReducers,
  createStoreCore as createStore,
} from "$lib/store-shim/internal/store-core";
import {
  browserReducer,
  browserTabZoomRequested,
  clearBrowserTabZoomRequest,
  initialState,
  addRecentUrl,
} from "./browser-slice";
import { selectPendingBrowserZoom } from "./browser-selectors";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";

describe("browserReducer", () => {
  it("workspaceUnmounted clears workspace state", () => {
    let state = browserReducer(
      initialState,
      addRecentUrl("ws-1", "https://example.com", "Example", undefined, new Date().toISOString()),
    );
    state = browserReducer(
      state,
      addRecentUrl("ws-2", "https://other.com", "Other", undefined, new Date().toISOString()),
    );

    const nextState = browserReducer(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });

  describe("browserTabZoomRequested", () => {
    it("appends the pending zoom action to the queue keyed by tab id", () => {
      let state = browserReducer(initialState, browserTabZoomRequested("ws-1", "tab-a", "in"));
      expect(state.byWorkspaceId["ws-1"].pendingZoomByTabId["tab-a"]).toEqual(["in"]);

      state = browserReducer(state, browserTabZoomRequested("ws-1", "tab-a", "reset"));
      expect(state.byWorkspaceId["ws-1"].pendingZoomByTabId["tab-a"]).toEqual(["in", "reset"]);
    });

    it("produces a length-3 queue for three rapid identical 'in' requests", () => {
      let state = browserReducer(initialState, browserTabZoomRequested("ws-1", "tab-a", "in"));
      state = browserReducer(state, browserTabZoomRequested("ws-1", "tab-a", "in"));
      state = browserReducer(state, browserTabZoomRequested("ws-1", "tab-a", "in"));

      expect(state.byWorkspaceId["ws-1"].pendingZoomByTabId["tab-a"]).toEqual(["in", "in", "in"]);
    });

    it("tracks pending zoom requests per tab independently", () => {
      let state = browserReducer(initialState, browserTabZoomRequested("ws-1", "tab-a", "in"));
      state = browserReducer(state, browserTabZoomRequested("ws-1", "tab-b", "out"));

      expect(state.byWorkspaceId["ws-1"].pendingZoomByTabId).toEqual({
        "tab-a": ["in"],
        "tab-b": ["out"],
      });
    });
  });

  describe("clearBrowserTabZoomRequest", () => {
    it("removes the pending zoom queue for the given tab", () => {
      let state = browserReducer(initialState, browserTabZoomRequested("ws-1", "tab-a", "in"));
      state = browserReducer(state, browserTabZoomRequested("ws-1", "tab-b", "out"));

      state = browserReducer(state, clearBrowserTabZoomRequest("ws-1", "tab-a"));

      expect(state.byWorkspaceId["ws-1"].pendingZoomByTabId).toEqual({
        "tab-b": ["out"],
      });
    });

    it("returns the same state reference when there is nothing to clear", () => {
      const state = browserReducer(initialState, browserTabZoomRequested("ws-1", "tab-a", "in"));
      const next = browserReducer(state, clearBrowserTabZoomRequest("ws-1", "tab-other"));
      expect(next).toBe(state);
    });
  });

  describe("zoom request integration with a real store + subscriber", () => {
    /**
     * Reducer-level integration test that mirrors EmbeddedBrowser's apply
     * contract — Redux is the single source of truth: the selector
     * yields a queue of pending actions, the subscriber drains the queue
     * in order and dispatches a single clear. The component itself uses
     * a reactive selector + $effect; here a plain `store.subscribe`
     * mirrors the contract without needing a Svelte runtime. This is the
     * regression guard for the bug where three consecutive identical zoom
     * requests only produced one apply (when the slot held a single
     * action and rapid dispatches in the same microtask collapsed).
     */
    const makeStore = () => createStore(combineReducers({ browser: browserReducer }));

    const subscribeAsEmbeddedBrowser = (
      store: ReturnType<typeof makeStore>,
      wsId: string,
      tabId: string,
      onApply: (action: "in" | "out" | "reset") => void,
    ) => {
      const apply = () => {
        const pending = selectPendingBrowserZoom.select(store.getState(), wsId, tabId);
        if (!pending || pending.length === 0) return;
        for (const action of pending) onApply(action);
        store.dispatch(clearBrowserTabZoomRequest(wsId, tabId));
      };
      const unsubscribe = store.subscribe(apply);
      apply();
      return unsubscribe;
    };

    it("applies three consecutive identical zoom requests", () => {
      const store = makeStore();
      const applied: Array<"in" | "out" | "reset"> = [];
      const unsubscribe = subscribeAsEmbeddedBrowser(store, "ws-1", "tab-a", (action) => {
        applied.push(action);
      });

      store.dispatch(browserTabZoomRequested("ws-1", "tab-a", "in"));
      store.dispatch(browserTabZoomRequested("ws-1", "tab-a", "in"));
      store.dispatch(browserTabZoomRequested("ws-1", "tab-a", "in"));

      expect(applied).toEqual(["in", "in", "in"]);
      expect(
        store.getState().browser.byWorkspaceId["ws-1"].pendingZoomByTabId["tab-a"],
      ).toBeUndefined();

      unsubscribe();
    });

    it("only the subscriber for the matching tab id applies the request", () => {
      const store = makeStore();
      const appliedA: string[] = [];
      const appliedB: string[] = [];
      const unsubA = subscribeAsEmbeddedBrowser(store, "ws-1", "tab-a", (a) => appliedA.push(a));
      const unsubB = subscribeAsEmbeddedBrowser(store, "ws-1", "tab-b", (a) => appliedB.push(a));

      store.dispatch(browserTabZoomRequested("ws-1", "tab-a", "in"));
      store.dispatch(browserTabZoomRequested("ws-1", "tab-b", "out"));
      store.dispatch(browserTabZoomRequested("ws-1", "tab-a", "reset"));

      expect(appliedA).toEqual(["in", "reset"]);
      expect(appliedB).toEqual(["out"]);

      unsubA();
      unsubB();
    });
  });
});

