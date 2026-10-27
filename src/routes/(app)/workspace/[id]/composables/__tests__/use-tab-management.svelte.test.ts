import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { take, type SagaGenerator } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import {
  openWorkspaceTab,
  workspaceTabsHydrated,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { useTabManagement } from '../use-tab-management.svelte';

const route = vi.hoisted(() => ({ state: {} as App.PageState }));
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: { state: App.PageState }) => void) => {
      run(route);
      return () => {};
    },
  },
}));
let dispose: () => void;
let cleanup: () => void;
let cancel: () => void;
let actions: ReturnType<typeof openWorkspaceTab>[];
beforeEach(() => {
  dispose = store.init();
  route.state = {};
  actions = [];
  cancel = store.runSaga(function* (): SagaGenerator<void> {
    while (true) actions.push(yield* take(openWorkspaceTab));
  });
});
afterEach(() => {
  cleanup?.();
  cancel();
  dispose();
});
describe('workspace route ownership', () => {
  it.each([undefined, 'follow-request'])(
    'projects the current route request %s without tagging later user selections',
    (requestId) => {
      route.state = requestId ? { presenceFollowRequestId: requestId } : {};
      store.dispatch(
        connectionsListReceived({
          connections: [],
          activeId: 'browser-websocket',
          windowBackendId: 'browser-websocket',
        }),
      );
      store.dispatch(workspaceTabsHydrated('browser-websocket'));
      cleanup = $effect.root(() =>
        useTabManagement({
          workspaceId: 'destination',
          tabsHydrated: true,
          workspaceState: null,
          // Model the settled route; a permanently stale previous ID repeatedly
          // triggers the composable's existing transition cleanup.
          previousWorkspaceId: 'destination',
        }),
      );
      flushSync();
      expect(actions).toEqual([openWorkspaceTab('destination', requestId)]);
      expect(store.state.tabState.currentTabId).toBe('destination');
      store.dispatch(openWorkspaceTab('destination'));
      expect(actions.at(-1)).toEqual(openWorkspaceTab('destination'));
      expect(actions.at(-1)?.payload[1]).toBeUndefined();
    },
  );

  it('opens the direct route only after initial backend restoration has settled', () => {
    let tabsHydrated = $state(false);
    store.dispatch(workspaceTabsHydrated('local'));
    cleanup = $effect.root(() =>
      useTabManagement({
        workspaceId: 'destination',
        get tabsHydrated() {
          return tabsHydrated;
        },
        workspaceState: null,
        previousWorkspaceId: 'destination',
      }),
    );
    flushSync();
    expect(actions).toEqual([]);

    store.dispatch(
      connectionsListReceived({
        connections: [],
        activeId: 'browser-websocket',
        windowBackendId: 'browser-websocket',
      }),
    );
    flushSync();
    expect(actions).toEqual([]);

    store.dispatch(workspaceTabsHydrated('browser-websocket'));
    tabsHydrated = true;
    flushSync();
    expect(actions).toEqual([openWorkspaceTab('destination', undefined)]);
    expect(store.state.tabState.currentTabId).toBe('destination');
  });
});
