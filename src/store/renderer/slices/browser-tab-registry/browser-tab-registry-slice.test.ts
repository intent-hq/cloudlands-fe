import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import type { BrowserTabInput } from '$shared/types/browser-clients';
import type { StoreState } from '../../types';
import { browserTabClosed } from '../browser-clients/browser-clients-slice';
import { clearPanelLayout } from '../panel-layout/panel-layout-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectBrowserTabRegistryWorkspace,
  selectBrowserTabsClosing,
} from './browser-tab-registry-selectors';
import {
  browserTabRegistryReducer,
  initialState,
  registryApplied,
  registryLoading,
  registryRemovalAcknowledged,
  registryRemovalsPending,
  registryReset,
  registrySnapshotAcknowledged,
  registryTabForgotten,
  registryTabReported,
  registryUnmounted,
} from './browser-tab-registry-slice';
import type { BrowserTabRegistryState } from './browser-tab-registry-slice';

const WS = 'ws-1';

function input(tabId: string, url = 'http://a.test/'): BrowserTabInput {
  return {
    tabId,
    workspaceId: WS,
    url,
    requestedUrl: null,
    title: null,
    ownerAgentId: null,
    ownerAgentName: null,
    visibility: 'visible',
    emulatedSize: null,
  };
}

function reduce(...actions: Parameters<typeof browserTabRegistryReducer>[1][]) {
  return actions.reduce(browserTabRegistryReducer, initialState);
}

const ws = (state: BrowserTabRegistryState, wsId = WS) => state.byWorkspaceId[wsId];
const applied = () => reduce(registryLoading(WS), registryApplied(WS, 1, { b1: input('b1') }));

describe('browserTabRegistryReducer', () => {
  it('starts with no workspaces and nothing closing', () => {
    expect(initialState).toEqual({ byWorkspaceId: {}, closing: {} });
  });

  it('starts a load in a new generation and keeps the previous report map', () => {
    const state = reduce(registryLoading(WS));
    expect(ws(state)).toEqual({ generation: 1, phase: 'loading', reported: {} });
    const again = browserTabRegistryReducer(applied(), registryLoading(WS));
    expect(ws(again)).toEqual({ generation: 2, phase: 'loading', reported: { b1: input('b1') } });
  });

  it('applies rows under the current generation only', () => {
    expect(ws(applied())).toEqual({
      generation: 1,
      phase: 'applied',
      reported: { b1: input('b1') },
    });
    const stale = browserTabRegistryReducer(
      reduce(registryLoading(WS)),
      registryApplied(WS, 0, {}),
    );
    expect(ws(stale).phase).toBe('loading');
    const torn = reduce(registryLoading(WS), workspaceUnmounted(WS), registryApplied(WS, 2, {}));
    expect(ws(torn).phase).toBe('unmounted');
  });

  it('records a report only for an applied workspace of the same generation', () => {
    const reported = browserTabRegistryReducer(
      applied(),
      registryTabReported(WS, 1, 'b2', input('b2')),
    );
    expect(ws(reported)).toMatchObject({
      phase: 'reporting',
      reported: { b1: input('b1'), b2: input('b2') },
    });
    expect(
      ws(browserTabRegistryReducer(applied(), registryTabReported(WS, 0, 'b2', input('b2')))),
    ).toEqual(ws(applied()));
    const loading = reduce(registryLoading(WS));
    expect(browserTabRegistryReducer(loading, registryTabReported(WS, 1, 'b2', input('b2')))).toBe(
      loading,
    );
  });

  it('forgets a tab without touching the generation or phase', () => {
    const state = browserTabRegistryReducer(applied(), registryTabForgotten(WS, 'b1'));
    expect(ws(state)).toEqual({ generation: 1, phase: 'applied', reported: {} });
    expect(browserTabRegistryReducer(state, registryTabForgotten(WS, 'b1'))).toBe(state);
  });

  it('tracks a removal from pending through acknowledgement to the closed echo', () => {
    let state = browserTabRegistryReducer(applied(), registryRemovalsPending(WS, ['b1']));
    expect(ws(state).reported).toEqual({});
    expect(state.closing).toEqual({ b1: 'pending' });
    state = browserTabRegistryReducer(state, registryRemovalAcknowledged('b1'));
    expect(state.closing).toEqual({ b1: 'acknowledged' });
    expect(browserTabRegistryReducer(state, registryRemovalAcknowledged('other'))).toBe(state);
    state = browserTabRegistryReducer(state, browserTabClosed(WS, 'b1'));
    expect(state.closing).toEqual({});
    const untouched = applied();
    expect(browserTabRegistryReducer(untouched, registryRemovalsPending(WS, []))).toBe(untouched);
  });

  it('drops the omitted pending removals and the dropped tabs once a snapshot is acknowledged', () => {
    const before = reduce(
      registryLoading(WS),
      registryApplied(WS, 1, { b1: input('b1'), b2: input('b2') }),
      registryRemovalsPending(WS, ['b1']),
      registryRemovalsPending(WS, ['gone']),
      registryRemovalAcknowledged('gone'),
    );
    const state = browserTabRegistryReducer(before, registrySnapshotAcknowledged(['b1'], ['b2']));
    expect(state.closing).toEqual({ gone: 'acknowledged' });
    expect(ws(state).reported).toEqual({});
    expect(browserTabRegistryReducer(state, registrySnapshotAcknowledged([], []))).toBe(state);
  });

  it('tears down on delete, forgetting the reported tabs', () => {
    const state = browserTabRegistryReducer(applied(), workspaceDeleted(WS));
    expect(ws(state)).toEqual({ generation: 2, phase: 'unmounted', reported: {} });
  });

  it('tears down on unmount keeping the reported tabs until the saga has diffed them', () => {
    const unmounted = browserTabRegistryReducer(applied(), workspaceUnmounted(WS));
    expect(ws(unmounted)).toEqual({
      generation: 2,
      phase: 'unmounted',
      reported: { b1: input('b1') },
    });
    const diffed = browserTabRegistryReducer(unmounted, registryUnmounted(WS, ['b1']));
    expect(ws(diffed)).toEqual({ generation: 2, phase: 'unmounted', reported: {} });
    expect(diffed.closing).toEqual({ b1: 'pending' });
    expect(browserTabRegistryReducer(diffed, registryUnmounted(WS, []))).toBe(diffed);
  });

  it('records the closes of an unmount diff even once the workspace loads again', () => {
    const reloaded = reduce(registryLoading(WS), registryApplied(WS, 1, { b1: input('b1') }));
    const state = browserTabRegistryReducer(reloaded, registryUnmounted(WS, ['b2']));
    expect(state.closing).toEqual({ b2: 'pending' });
    expect(ws(state).reported).toEqual({ b1: input('b1') });
  });

  it('tears down on a cleared layout but keeps the reported tabs and pending removals', () => {
    const before = browserTabRegistryReducer(applied(), registryRemovalsPending(WS, ['b2']));
    const state = browserTabRegistryReducer(before, clearPanelLayout(WS));
    expect(ws(state)).toEqual({ generation: 2, phase: 'unmounted', reported: { b1: input('b1') } });
    expect(state.closing).toEqual({ b2: 'pending' });
  });

  it('tears every workspace down into a new generation for a new backend', () => {
    const before = browserTabRegistryReducer(applied(), registryRemovalsPending(WS, ['b2']));
    const state = browserTabRegistryReducer(before, registryReset());
    expect(ws(state)).toEqual({ generation: 2, phase: 'unmounted', reported: {} });
    expect(state.closing).toEqual({});
    // The counter never restarts: the next load cannot reuse a generation
    // a step started under the old backend still holds.
    expect(ws(browserTabRegistryReducer(state, registryLoading(WS)))).toMatchObject({
      generation: 3,
    });
  });
});

describe('browserTabRegistry selectors', () => {
  const asStore = (browserTabRegistry: BrowserTabRegistryState) =>
    ({ browserTabRegistry }) as unknown as StoreState;

  it('falls back to an unmounted, empty record for unknown workspaces and stores', () => {
    const fallback = { generation: 0, phase: 'unmounted', reported: {} };
    expect(selectBrowserTabRegistryWorkspace.select(asStore(initialState), WS)).toEqual(fallback);
    expect(selectBrowserTabRegistryWorkspace.select({} as StoreState, WS)).toEqual(fallback);
    expect(selectBrowserTabsClosing.select({} as StoreState)).toEqual({});
  });

  it('reads the workspace record and the closing map', () => {
    const state = browserTabRegistryReducer(applied(), registryRemovalsPending(WS, ['b1']));
    expect(selectBrowserTabRegistryWorkspace.select(asStore(state), WS)).toEqual(ws(state));
    expect(selectBrowserTabsClosing.select(asStore(state))).toEqual({ b1: 'pending' });
  });
});
