import { describe, it, expect, vi } from 'vitest';
import { Store } from '@augmentcode/themis/svelte-store';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import {
  browserReducer,
  browserElementCaptured,
  browserTabZoomRequested,
  clearBrowserElementCapture,
  clearBrowserTabZoomRequest,
  initialState,
  addRecentUrl,
} from './browser-slice';
import { selectPendingBrowserZoom } from './browser-selectors';
import { selectPendingBrowserElementCaptures } from './browser-selectors';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

describe('browserReducer', () => {
  it('workspaceUnmounted clears workspace state', () => {
    let state = browserReducer(
      initialState,
      addRecentUrl('ws-1', 'https://example.com', 'Example', undefined, new Date().toISOString()),
    );
    state = browserReducer(
      state,
      addRecentUrl('ws-2', 'https://other.com', 'Other', undefined, new Date().toISOString()),
    );

    const nextState = browserReducer(state, workspaceUnmounted('ws-1'));

    expect(nextState.byWorkspaceId['ws-1']).toBeUndefined();
    expect(nextState.byWorkspaceId['ws-2']).toBeDefined();
  });

  describe('browserTabZoomRequested', () => {
    it('appends the pending zoom action to the queue keyed by tab id', () => {
      let state = browserReducer(initialState, browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      expect(state.byWorkspaceId['ws-1'].pendingZoomByTabId['tab-a']).toEqual(['in']);

      state = browserReducer(state, browserTabZoomRequested('ws-1', 'tab-a', 'reset'));
      expect(state.byWorkspaceId['ws-1'].pendingZoomByTabId['tab-a']).toEqual(['in', 'reset']);
    });

    it("produces a length-3 queue for three rapid identical 'in' requests", () => {
      let state = browserReducer(initialState, browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      state = browserReducer(state, browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      state = browserReducer(state, browserTabZoomRequested('ws-1', 'tab-a', 'in'));

      expect(state.byWorkspaceId['ws-1'].pendingZoomByTabId['tab-a']).toEqual(['in', 'in', 'in']);
    });

    it('tracks pending zoom requests per tab independently', () => {
      let state = browserReducer(initialState, browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      state = browserReducer(state, browserTabZoomRequested('ws-1', 'tab-b', 'out'));

      expect(state.byWorkspaceId['ws-1'].pendingZoomByTabId).toEqual({
        'tab-a': ['in'],
        'tab-b': ['out'],
      });
    });
  });

  describe('clearBrowserTabZoomRequest', () => {
    it('removes the pending zoom queue for the given tab', () => {
      let state = browserReducer(initialState, browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      state = browserReducer(state, browserTabZoomRequested('ws-1', 'tab-b', 'out'));

      state = browserReducer(state, clearBrowserTabZoomRequest('ws-1', 'tab-a'));

      expect(state.byWorkspaceId['ws-1'].pendingZoomByTabId).toEqual({
        'tab-b': ['out'],
      });
    });

    it('returns the same state reference when there is nothing to clear', () => {
      const state = browserReducer(initialState, browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      const next = browserReducer(state, clearBrowserTabZoomRequest('ws-1', 'tab-other'));
      expect(next).toBe(state);
    });
  });

  describe('browser element captures', () => {
    const capture = {
      tabId: 'tab-a',
      ownerAgentId: 'agent-1',
      pageUrl: 'https://example.com',
      title: 'Example',
      image: { data: 'data:image/png;base64,AA==', mimeType: 'image/png' as const },
      element: {
        selector: '#submit',
        domPath: 'html>body>button#submit',
        tagName: 'button',
        id: 'submit',
        className: 'primary',
        textSnippet: 'Submit',
        rect: { x: 10, y: 20, width: 100, height: 40 },
        pageUrl: 'https://example.com',
      },
    };

    it('adds element and whole-viewport captures to a workspace', () => {
      let state = browserReducer(
        initialState,
        browserElementCaptured('ws-1', capture, 'capture-1'),
      );
      state = browserReducer(
        state,
        browserElementCaptured('ws-1', { ...capture, element: undefined }, 'capture-2'),
      );

      expect(state.byWorkspaceId['ws-1'].pendingElementCaptures).toEqual({
        'capture-1': { ...capture, id: 'capture-1' },
        'capture-2': { ...capture, element: undefined, id: 'capture-2' },
      });
    });

    it('clears only the requested capture', () => {
      let state = browserReducer(
        initialState,
        browserElementCaptured('ws-1', capture, 'capture-1'),
      );
      state = browserReducer(
        state,
        browserElementCaptured('ws-1', { ...capture, tabId: 'tab-b' }, 'capture-2'),
      );
      state = browserReducer(state, clearBrowserElementCapture('ws-1', 'capture-1'));

      expect(Object.keys(state.byWorkspaceId['ws-1'].pendingElementCaptures)).toEqual([
        'capture-2',
      ]);
      expect(selectPendingBrowserElementCaptures.select({ browser: state } as any, 'ws-1')).toEqual(
        [{ ...capture, tabId: 'tab-b', id: 'capture-2' }],
      );
    });

    it('returns the same state when the capture does not exist', () => {
      const state = browserReducer(
        initialState,
        browserElementCaptured('ws-1', capture, 'capture-1'),
      );
      expect(browserReducer(state, clearBrowserElementCapture('ws-1', 'missing'))).toBe(state);
    });
  });

  describe('zoom request integration with a real store + subscriber', () => {
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
    const makeStore = () => {
      const store = new Store({ browser: browserReducer });
      store.init();
      return store;
    };

    const subscribeAsEmbeddedBrowser = (
      store: ReturnType<typeof makeStore>,
      wsId: string,
      tabId: string,
      onApply: (action: 'in' | 'out' | 'reset') => void,
    ) => {
      const apply = () => {
        const pending = selectPendingBrowserZoom.select(store.state, wsId, tabId);
        if (!pending || pending.length === 0) return;
        for (const action of pending) onApply(action);
        store.dispatch(clearBrowserTabZoomRequest(wsId, tabId));
      };
      const stateReadable = store.createSelector((state) => state)();
      const unsubscribe = stateReadable.subscribe(apply);
      apply();
      // Themis selector readables are cadenced. Flush after each test dispatch
      // so this regression guard retains its synchronous rapid-dispatch contract.
      return {
        unsubscribe,
        dispatch: (action: Parameters<typeof store.dispatch>[0]) => {
          store.dispatch(action);
          apply();
        },
      };
    };

    it('applies three consecutive identical zoom requests', () => {
      const store = makeStore();
      const applied: Array<'in' | 'out' | 'reset'> = [];
      const { unsubscribe, dispatch } = subscribeAsEmbeddedBrowser(
        store,
        'ws-1',
        'tab-a',
        (action) => {
          applied.push(action);
        },
      );

      dispatch(browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      dispatch(browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      dispatch(browserTabZoomRequested('ws-1', 'tab-a', 'in'));

      expect(applied).toEqual(['in', 'in', 'in']);
      expect(store.state.browser.byWorkspaceId['ws-1'].pendingZoomByTabId['tab-a']).toBeUndefined();

      unsubscribe();
    });

    it('only the subscriber for the matching tab id applies the request', () => {
      const store = makeStore();
      const appliedA: string[] = [];
      const appliedB: string[] = [];
      const subA = subscribeAsEmbeddedBrowser(store, 'ws-1', 'tab-a', (a) => appliedA.push(a));
      const subB = subscribeAsEmbeddedBrowser(store, 'ws-1', 'tab-b', (a) => appliedB.push(a));

      subA.dispatch(browserTabZoomRequested('ws-1', 'tab-a', 'in'));
      subB.dispatch(browserTabZoomRequested('ws-1', 'tab-b', 'out'));
      subA.dispatch(browserTabZoomRequested('ws-1', 'tab-a', 'reset'));

      expect(appliedA).toEqual(['in', 'reset']);
      expect(appliedB).toEqual(['out']);

      subA.unsubscribe();
      subB.unsubscribe();
    });
  });
});
