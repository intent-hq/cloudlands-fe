import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { take, type SagaGenerator } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
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
      cleanup = $effect.root(() =>
        useTabManagement({
          workspaceId: 'destination',
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
});
