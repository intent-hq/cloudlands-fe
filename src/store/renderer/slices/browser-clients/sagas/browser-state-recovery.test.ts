import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import type { AdmittedEventObserver } from '$features/events/event-recovery-coordinator';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import type { LiveClient } from '$shared/types/browser-clients';

const rpc = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: rpc.request,
  observeBackendNodeCapabilities: async () => ({ clientId: 'desktop' }),
  onBackendReconnected: () => () => {},
}));
vi.mock('$lib/client', async () => {
  const { LiveClientsClient } = await import('$lib/client/live/live-clients-client');
  const { LiveBrowserClient } = await import('$lib/client/live/live-browser-client');
  const { LiveWorkspacesClient } = await import('$lib/client/live/live-workspaces-client');
  return {
    appClient: {
      browser: new LiveBrowserClient(),
      clients: new LiveClientsClient(),
      workspaces: new LiveWorkspacesClient(),
    },
  };
});
import { store } from '../../../store';
import { __resetOwnClientIdForTesting } from '$lib/client/live/live-clients-client';
import { browserTabRegistrySaga } from '../../panel-layout/sagas/browser-tab-registry-saga';
import { initializeLayout, setRestoreStatus } from '../../panel-layout/panel-layout-slice';
import { ownClientIdReceived } from '../browser-clients-slice';
import { collectBrowserTabs } from '../../panel-layout/panel-layout-selectors';
import type { BrowserTabListing } from '$shared/types/browser-clients';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
import { browserClientsSaga } from './browser-clients-saga';
import { selectLiveClients, selectWorkspaceDrivingClient } from '../browser-clients-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  browserClientsConsumerMounted,
  fetchWorkspaceBrowserClientRequested,
  setWorkspaceBrowserClientRequested,
} from '../browser-clients-slice';

const WS = 'browser-recovery';
const client: LiveClient = {
  clientId: 'desktop',
  capabilities: { browserExec: true },
  connections: 1,
  transports: ['wss'],
  connectedAt: '2026-10-13',
};
const settle = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
let dispose: () => void;
let cancel: () => void;
let clients = [client];
let pin: string | null = null;
let receive: (event: RecoveryNotification) => void;
let scope: ReturnType<typeof rendererEventRecovery.attach>;
let seq = 0;
const view = () => selectWorkspaceDrivingClient.select(store.state, WS);
const lose = (generation = '1', id = 'browser-1') =>
  receive({
    method: 'events.lost',
    params: { subscriptionId: id, generation, scope: { workspaceId: null } },
  });
const calls = (method: string) => rpc.request.mock.calls.filter(([name]) => name === method);

async function attach(supported = true, admitted?: AdmittedEventObserver) {
  scope = rendererEventRecovery.attach(
    createEventRecoverySession({
      supported,
      isCurrent: () => true,
      onRetired: () => () => {},
      dispose: () => {},
      onNotification: (handler) => {
        receive = handler;
        return () => {};
      },
      request: async (method, params, observe) => {
        const value = await rpc.request(method, params);
        observe?.(value);
        return value;
      },
    }),
    admitted,
  );
  await scope.subscribe(
    { eventTypes: ['client:*', 'workspace:updated', 'settings:changed'] },
    { recover: true },
  );
}
beforeEach(async () => {
  vi.useFakeTimers();
  seq = 0;
  clients = [client];
  pin = null;
  rpc.request
    .mockReset()
    .mockImplementation(async (method: string, params?: { lossRecovery?: number }) => {
      if (method === 'client.list') return { clients };
      if (method === 'workspace.getBrowserClient')
        return {
          browserClient: pin
            ? { source: 'workspace', clientId: pin, resolved: null }
            : { source: 'default', resolved: { clientId: client.clientId } },
        };
      if (method === 'events.subscribe')
        return {
          subscriptionId: `browser-${++seq}`,
          ...(params?.lossRecovery ? { lossRecovery: 1 } : {}),
        };
      if (method === 'events.fence' || method === 'events.unsubscribe') return params;
      throw new Error(`Unexpected command ${method}`);
    });
  dispose = store.init();
  cancel = store.runSaga(browserClientsSaga);
});
afterEach(() => {
  cancel();
  rendererEventRecovery.dispose();
  dispose();
  __resetOwnClientIdForTesting();
  vi.useRealTimers();
});

describe('browser clients generic-loss recovery', () => {
  it('restores a lost final roster and pin with one snapshot and no browser commands', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    expect(view().eligibleClients).toHaveLength(1);
    rpc.request.mockClear();
    clients = [];
    pin = 'offline-host';
    lose();
    await settle();
    expect(view().eligibleClients).toEqual([]);
    expect(view().pinnedClientId).toBe('offline-host');
    expect(calls('client.list')).toHaveLength(1);
    expect(calls('workspace.getBrowserClient')).toHaveLength(1);
    expect(calls('events.fence')).toHaveLength(2);
    expect(rpc.request.mock.calls.map(([m]) => m)).toEqual([
      'events.fence',
      'client.list',
      'workspace.getBrowserClient',
      'events.fence',
    ]);
  });
  it('rejects an ordinary read started before loss after the recovery snapshot commits', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    const old = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementationOnce(() => old.promise);
    store.dispatch(fetchWorkspaceBrowserClientRequested(WS));
    await settle();
    pin = 'current';
    lose();
    await settle();
    old.resolve({ browserClient: { source: 'workspace', clientId: 'obsolete', resolved: null } });
    await settle();
    expect(view().pinnedClientId).toBe('current');
    rpc.request.mockImplementation(normal);
  });
  it('does not resurrect a removed workspace from held recovery, including remount ABA', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    const held = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'workspace.getBrowserClient' ? held.promise : normal(method, params),
    );
    lose();
    await settle();
    store.dispatch(workspaceUnmounted(WS));
    rpc.request.mockImplementation(normal);
    pin = 'new-mount';
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    held.resolve({ browserClient: { source: 'workspace', clientId: 'old-mount', resolved: null } });
    await settle();
    expect(view().pinnedClientId).toBe('new-mount');
  });
  it('reconciles a pin mutation settling after loss without applying its stale echo', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    const held = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'workspace.setBrowserClient' ? held.promise : normal(method, params),
    );
    store.dispatch(setWorkspaceBrowserClientRequested(WS, 'requested'));
    await settle();
    lose();
    await settle();
    pin = 'canonical';
    held.resolve({
      browserClient: { source: 'workspace', clientId: 'stale-echo', resolved: null },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(view().pinnedClientId).toBe('canonical');
    expect(calls('workspace.setBrowserClient')).toHaveLength(1);
  });
  it('does not add ordinary reads or fences for a legacy lease', async () => {
    await attach(false);
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    expect(calls('client.list')).toHaveLength(1);
    expect(calls('workspace.getBrowserClient')).toHaveLength(1);
    expect(calls('events.fence')).toHaveLength(0);
  });
});

const row = (tabId: string, url = 'https://old.test/'): BrowserTabListing => ({
  tabId,
  url,
  workspaceId: WS,
  hostClientId: 'remote',
  visibility: 'visible',
  hostConnected: true,
  createdAt: '2026-10-13',
  updatedAt: '2026-10-13',
});
const tabs = () =>
  collectBrowserTabs(store.state.panelLayout.byWorkspaceId[WS]).map(({ tab }) => tab);
async function startTabs(rows: BrowserTabListing[]) {
  cancel();
  const normal = rpc.request.getMockImplementation()!;
  rpc.request.mockImplementation((method, params) =>
    method === 'browser.listTabs' ? Promise.resolve({ tabs: rows }) : normal(method, params),
  );
  store.dispatch(ownClientIdReceived('desktop'));
  store.dispatch(
    initializeLayout(WS, {
      root: { type: 'panel', panelId: 'p' },
      panels: {
        p: {
          id: 'p',
          tabs: rows.map((r) => ({
            id: r.tabId,
            type: 'browser',
            title: '',
            closable: true,
            browserUrl: r.url,
            hostClientId: r.hostClientId,
          })),
          activeTabId: rows[0]?.tabId ?? null,
        },
      },
      focusedPanelId: 'p',
    }),
  );
  cancel = store.runSaga(browserTabRegistrySaga);
  await attach();
  await scope.subscribe({ workspaceId: WS, eventTypes: ['browser:tab-*'] }, { recover: true });
  store.dispatch(setRestoreStatus(WS, 'restored'));
  await settle();
}
const loseTabs = () =>
  receive({
    method: 'events.lost',
    params: { subscriptionId: 'browser-2', generation: '1', scope: { workspaceId: WS } },
  });
describe('browser tab snapshot recovery', () => {
  it('replaces stale tab state and removes a lost final closed tab without sending commands', async () => {
    await startTabs([row('old'), row('keep')]);
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'browser.listTabs'
        ? Promise.resolve({ tabs: [row('keep', 'https://current.test/'), row('added')] })
        : normal(method, params),
    );
    rpc.request.mockClear();
    loseTabs();
    await settle();
    expect(tabs().map((t) => [t.id, t.browserUrl])).toEqual([
      ['keep', 'https://current.test/'],
      ['added', 'https://old.test/'],
    ]);
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(rpc.request.mock.calls.map(([m]) => m)).toEqual([
      'events.fence',
      'browser.listTabs',
      'events.fence',
    ]);
  });
});

describe('browser recovery authority and bounded reads', () => {
  it('reads no inactive workspace and rehydrates it only after remount', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    store.dispatch(workspaceUnmounted(WS));
    rpc.request.mockClear();
    lose();
    await settle();
    expect(calls('client.list')).toHaveLength(0);
    expect(calls('workspace.getBrowserClient')).toHaveLength(0);
    pin = 'remounted';
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    expect(view().pinnedClientId).toBe('remounted');
    expect(calls('workspace.getBrowserClient')).toHaveLength(1);
  });
  it('coalesces a loss storm during a held read to one bounded trailing snapshot', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    rpc.request.mockClear();
    const held = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    let once = true;
    rpc.request.mockImplementation((method, params) => {
      if (method === 'workspace.getBrowserClient' && once) {
        once = false;
        return held.promise;
      }
      return normal(method, params);
    });
    lose();
    await settle();
    for (let i = 2; i < 50; i++) lose(String(i));
    await settle();
    expect(calls('workspace.getBrowserClient')).toHaveLength(1);
    pin = 'latest';
    held.resolve({
      browserClient: { source: 'workspace', clientId: 'before-storm', resolved: null },
    });
    await settle();
    expect(view().pinnedClientId).not.toBe('before-storm');
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(view().pinnedClientId).toBe('latest');
    expect(calls('workspace.getBrowserClient')).toHaveLength(2);
  });
  it('rejects unversioned old pushes after recovery and refreshes from authority', async () => {
    const { browserClientRecoveryKey } = await import('./browser-client-recovery');
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    pin = 'current';
    lose();
    await settle();
    rpc.request.mockClear();
    expect(rendererEventRecovery.push(browserClientRecoveryKey(WS))).toBe(false);
    pin = 'newer';
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(view().pinnedClientId).toBe('newer');
    expect(calls('workspace.getBrowserClient')).toHaveLength(1);
  });
  it('retires old session reads across backend/principal replacement and restores current state', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    const held = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    let once = true;
    rpc.request.mockImplementation((method, params) => {
      if (method === 'workspace.getBrowserClient' && once) {
        once = false;
        return held.promise;
      }
      return normal(method, params);
    });
    store.dispatch(fetchWorkspaceBrowserClientRequested(WS));
    await settle();
    pin = 'replacement';
    await attach();
    await settle();
    held.resolve({ browserClient: { source: 'workspace', clientId: 'retired', resolved: null } });
    await settle();
    expect(view().pinnedClientId).toBe('replacement');
  });
  it('does not let an old lease complete recovery after subscription replacement', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    const held = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    let once = true;
    rpc.request.mockImplementation((method, params) => {
      if (method === 'workspace.getBrowserClient' && once) {
        once = false;
        return held.promise;
      }
      return normal(method, params);
    });
    lose();
    await settle();
    await scope.unsubscribe('browser-1');
    await scope.subscribe(
      { eventTypes: ['client:*', 'workspace:updated', 'settings:changed'] },
      { recover: true },
    );
    pin = 'new-lease';
    held.resolve({ browserClient: { source: 'workspace', clientId: 'old-lease', resolved: null } });
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(view().pinnedClientId).toBe('new-lease');
  });
  it('bounds repeated read failures and clears state on an authorization denial', async () => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    rpc.request.mockClear();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'workspace.getBrowserClient'
        ? Promise.reject(new Error('offline'))
        : normal(method, params),
    );
    lose();
    await settle();
    await vi.advanceTimersByTimeAsync(6000);
    await settle();
    expect(calls('workspace.getBrowserClient')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls('workspace.getBrowserClient')).toHaveLength(3);
    await attach();
    rpc.request.mockImplementation((method, params) =>
      method === 'workspace.getBrowserClient'
        ? Promise.reject(Object.assign(new Error('denied'), { rpcCode: -32003 }))
        : normal(method, params),
    );
    await settle();
    expect(store.state.browserClients.byWorkspaceId[WS]).toBeUndefined();
  });
});

describe('browser tab lifetime and side-effect boundaries', () => {
  it('does not revive a removed layout from a held snapshot', async () => {
    const { clearPanelLayout } = await import('../../panel-layout/panel-layout-slice');
    await startTabs([row('old')]);
    const held = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'browser.listTabs' ? held.promise : normal(method, params),
    );
    loseTabs();
    await settle();
    store.dispatch(clearPanelLayout(WS));
    held.resolve({ tabs: [row('retired')] });
    await settle();
    expect(store.state.panelLayout.byWorkspaceId[WS]).toBeUndefined();
  });
  it('keeps host navigation local while accepting current tab ownership and dropping tombstones', async () => {
    const hosted = { ...row('hosted'), hostClientId: 'desktop' };
    await startTabs([hosted, row('removed')]);
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'browser.listTabs'
        ? Promise.resolve({
            tabs: [{ ...hosted, url: 'https://stale-echo.test/', ownerAgentId: 'agent-new' }],
          })
        : normal(method, params),
    );
    rpc.request.mockClear();
    loseTabs();
    await settle();
    expect(tabs()).toMatchObject([
      { id: 'hosted', browserUrl: 'https://old.test/', ownerAgentId: 'agent-new' },
    ]);
    expect(store.state.panelLayout.byWorkspaceId[WS].recentlyClosed).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls('browser.upsertTab')).toHaveLength(0);
    expect(calls('browser.removeTab')).toHaveLength(0);
  });
  it('rejects a delayed old tab push after recovery without admitting it twice', async () => {
    const { browserTabRecoveryKey } = await import('../../panel-layout/sagas/browser-tab-recovery');
    const { browserTabUpserted } = await import('../browser-clients-slice');
    const { dispatchBrowserTabEvent } =
      await import('../../panel-layout/sagas/browser-tab-event-receipt');
    await startTabs([row('keep')]);
    const token = rendererEventRecovery.capture(browserTabRecoveryKey(WS));
    loseTabs();
    await settle();
    await dispatchBrowserTabEvent(browserTabUpserted(WS, row('stale')), token);
    expect(tabs().map((t) => t.id)).toEqual(['keep']);
  });
  it('event receipt waits for actual routing placement before resolving', async () => {
    const { browserTabRecoveryKey } = await import('../../panel-layout/sagas/browser-tab-recovery');
    const { browserTabUpserted } = await import('../browser-clients-slice');
    const { registryLoading, registryApplied } =
      await import('../../browser-tab-registry/browser-tab-registry-slice');
    const { openTabInRightmostColumnRequested, openTabInRightmostColumn } =
      await import('../../panel-layout/panel-layout-slice');
    const { take, put } = await import('typed-redux-saga');
    const { getRecoveryLifetime, withRecoveryLifetime } =
      await import('../../../middlewares/event-recovery');
    const { dispatchBrowserTabEvent } =
      await import('../../panel-layout/sagas/browser-tab-event-receipt');
    await startTabs([row('keep')]);
    store.dispatch(registryLoading(WS));
    store.dispatch(
      registryApplied(WS, store.state.browserTabRegistry.byWorkspaceId[WS].generation, {}),
    );
    let placed!: () => void;
    const hold = new Promise<void>((resolve) => {
      placed = resolve;
    });
    const { call } = await import('typed-redux-saga');
    const stopRouter = store.runSaga(function* () {
      const action = yield* take(openTabInRightmostColumnRequested);
      yield* call(() => hold);
      yield* put(
        withRecoveryLifetime(
          openTabInRightmostColumn(WS, action.payload.tab, {
            newTabId: action.payload.newTabId,
            allowDuplicate: action.payload.allowDuplicate,
          }),
          getRecoveryLifetime(action)!,
        ),
      );
    });
    const done = vi.fn();
    expect(rendererEventRecovery.push(browserTabRecoveryKey(WS))).toBe(true);
    const receipt = dispatchBrowserTabEvent(
      browserTabUpserted(WS, row('placed')),
      rendererEventRecovery.capture(browserTabRecoveryKey(WS)),
    ).then(done);
    await settle();
    expect(done).not.toHaveBeenCalled();
    expect(tabs().map((t) => t.id)).toEqual(['keep']);
    placed();
    await receipt;
    expect(tabs().map((t) => t.id)).toEqual(['keep', 'placed']);
    stopRouter();
  });
});

it('client event receipts cover both async reads and settle superseded burst triggers', async () => {
  const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
  const { browserClientRecoveryKey } = await import('./browser-client-recovery');
  await attach();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  rpc.request.mockClear();
  const roster = deferred<unknown>(),
    selection = deferred<unknown>();
  const normal = rpc.request.getMockImplementation()!;
  let firstRoster = true,
    firstSelection = true;
  rpc.request.mockImplementation((method, params) => {
    if (method === 'client.list' && firstRoster) {
      firstRoster = false;
      return roster.promise;
    }
    if (method === 'workspace.getBrowserClient' && firstSelection) {
      firstSelection = false;
      return selection.promise;
    }
    return normal(method, params);
  });
  const done = vi.fn();
  rendererEventRecovery.push(browserClientRecoveryKey(WS));
  const first = dispatchBrowserClientEvent(
    WS,
    rendererEventRecovery.capture(browserClientRecoveryKey(WS)),
  ).then(done);
  await settle();
  expect(done).not.toHaveBeenCalled();
  const pending = [];
  for (let i = 0; i < 5; i++) {
    rendererEventRecovery.push(browserClientRecoveryKey(WS));
    pending.push(
      dispatchBrowserClientEvent(WS, rendererEventRecovery.capture(browserClientRecoveryKey(WS))),
    );
  }
  roster.resolve({ clients: [] });
  await settle();
  expect(done).not.toHaveBeenCalled();
  pin = 'final-event';
  selection.resolve({ browserClient: { source: 'default', resolved: null } });
  await Promise.all([first, ...pending]);
  expect(view().pinnedClientId).toBe('final-event');
  expect(calls('client.list')).toHaveLength(2);
  expect(calls('workspace.getBrowserClient')).toHaveLength(2);
});

it('drops an ordinary tab listing that completes after the recovered snapshot', async () => {
  const { connectionStatusChanged } = await import('../../daemon-health/daemon-health-slice');
  await startTabs([row('old')]);
  store.dispatch(connectionStatusChanged('connected'));
  const held = deferred<unknown>();
  const normal = rpc.request.getMockImplementation()!;
  let first = true;
  rpc.request.mockImplementation((method, params) => {
    if (method === 'browser.listTabs') {
      if (first) {
        first = false;
        return held.promise;
      }
      return Promise.resolve({ tabs: [row('current')] });
    }
    return normal(method, params);
  });
  store.dispatch(setRestoreStatus(WS, 'restored'));
  await settle();
  loseTabs();
  await settle();
  held.resolve({ tabs: [row('obsolete')] });
  await settle();
  expect(tabs().map((tab) => tab.id)).toEqual(['current']);
});

it('still reports a user navigation after recovery without replaying it', async () => {
  const { connectionStatusChanged } = await import('../../daemon-health/daemon-health-slice');
  const { updateTabBrowserUrl } = await import('../../panel-layout/panel-layout-slice');
  let server = { ...row('hosted'), hostClientId: 'desktop', displayed: true };
  await startTabs([server]);
  store.dispatch(connectionStatusChanged('connected'));
  await settle();
  loseTabs();
  await settle();
  const normal = rpc.request.getMockImplementation()!;
  rpc.request.mockImplementation((method, params) => {
    if (method === 'browser.listTabs') return Promise.resolve({ tabs: [server] });
    if (method === 'browser.upsertTab') {
      server = { ...server, ...params.tab };
      return Promise.resolve({ tab: server });
    }
    return normal(method, params);
  });
  rpc.request.mockClear();
  store.dispatch(updateTabBrowserUrl(WS, 'hosted', 'https://user.test/'));
  await vi.advanceTimersByTimeAsync(300);
  await settle();
  expect(tabs()[0].browserUrl).toBe('https://user.test/');
  expect(server.url).toBe('https://user.test/');
  expect(calls('browser.upsertTab')).toHaveLength(1);
  expect(calls('browser.navigateTab')).toHaveLength(0);
  expect(calls('browser.closeTab')).toHaveLength(0);
});

it('rejects a read across principal invalidation even when the same principal is readmitted', async () => {
  const { admitLegacyPrincipal } = await import('../../../../../test/fixtures/principal-state');
  const { principalIdentityChanged, principalReceived } =
    await import('../../principal/principal-slice');
  admitLegacyPrincipal();
  await attach();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  const before = store.state.principal;
  if (!before.snapshot || !before.context || !before.boundPrincipalId)
    throw new Error('Expected admitted fixture');
  const held = deferred<unknown>();
  const normal = rpc.request.getMockImplementation()!;
  let first = true;
  rpc.request.mockImplementation((method, params) => {
    if (method === 'workspace.getBrowserClient' && first) {
      first = false;
      return held.promise;
    }
    return normal(method, params);
  });
  store.dispatch(fetchWorkspaceBrowserClientRequested(WS));
  await settle();
  store.dispatch(principalIdentityChanged(before.boundPrincipalId));
  pin = 'readmitted';
  rpc.request.mockClear();
  const readmission = principalReceived(
    {
      context: before.context,
      invalidation: store.state.principal.invalidation,
      presentationVersion: store.state.principal.presentationVersion,
    },
    before.snapshot,
  );
  store.dispatch(readmission);
  held.resolve({
    browserClient: { source: 'workspace', clientId: 'old-authority', resolved: null },
  });
  await settle();
  expect(view().pinnedClientId).toBe('readmitted');
  expect(view().eligibleClients).toHaveLength(1);
  expect(calls('client.list')).toHaveLength(1);
  expect(calls('workspace.getBrowserClient')).toHaveLength(1);
  rpc.request.mockClear();
  store.dispatch(readmission);
  await settle();
  expect(rpc.request.mock.calls).toEqual([]);
  expect(view().pinnedClientId).toBe('readmitted');
});

it('a failed selection waits for a held sibling roster before retrying', async () => {
  await attach();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  const roster = deferred<unknown>();
  const normal = rpc.request.getMockImplementation()!;
  let active = 0,
    peak = 0;
  rpc.request.mockClear();
  rpc.request.mockImplementation((method, params) => {
    if (method === 'client.list') {
      active++;
      peak = Math.max(peak, active);
      return roster.promise.finally(() => active--);
    }
    if (method === 'workspace.getBrowserClient') return Promise.reject(new Error('transient'));
    return normal(method, params);
  });
  lose();
  await settle();
  await vi.advanceTimersByTimeAsync(6000);
  await settle();
  const observed = { active, peak, reads: calls('client.list').length };
  roster.resolve({ clients: [] });
  await settle();
  expect(observed).toEqual({ active: 1, peak: 1, reads: 1 });
  await vi.advanceTimersByTimeAsync(12000);
  await settle();
  expect({ active, peak, reads: calls('client.list').length }).toEqual({
    active: 0,
    peak: 1,
    reads: 3,
  });
});

it.each([false, true])(
  'user close with recovery pending=%s stays closed and sends one removal',
  async (pending) => {
    const { connectionStatusChanged } = await import('../../daemon-health/daemon-health-slice');
    const { closeTab } = await import('../../panel-layout/panel-layout-slice');
    let server = [{ ...row('hosted'), hostClientId: 'desktop', displayed: true }];
    const held = deferred<{ tabs: BrowserTabListing[] }>();
    let holdNext = pending;
    const beforeClose = [...server];
    await startTabs(server);
    store.dispatch(connectionStatusChanged('connected'));
    await settle();
    loseTabs();
    await settle();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) => {
      if (method === 'browser.listTabs') {
        if (holdNext) {
          holdNext = false;
          return held.promise;
        }
        return Promise.resolve({ tabs: server });
      }
      if (method === 'browser.removeTab') {
        server = [];
        return Promise.resolve({ ok: true });
      }
      return normal(method, params);
    });
    rpc.request.mockClear();
    if (pending) {
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'browser-2', generation: '2', scope: { workspaceId: WS } },
      });
      await vi.advanceTimersByTimeAsync(250);
      await settle();
    }
    store.dispatch(closeTab(WS, 'hosted', undefined, undefined, { destroy: true }));
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    if (pending) {
      held.resolve({ tabs: beforeClose });
      await vi.advanceTimersByTimeAsync(300);
      await settle();
    }
    expect({ tabs: tabs().map((t) => t.id), removes: calls('browser.removeTab').length }).toEqual({
      tabs: [],
      removes: 1,
    });
  },
);

it('prefers a denied selection over a transient roster failure after both settle', async () => {
  await attach();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  const normal = rpc.request.getMockImplementation()!;
  rpc.request.mockClear();
  rpc.request.mockImplementation((method, params) => {
    if (method === 'client.list') return Promise.reject(new Error('transient'));
    if (method === 'workspace.getBrowserClient') return Promise.reject({ rpcCode: -32003 });
    return normal(method, params);
  });
  lose();
  await settle();
  await vi.advanceTimersByTimeAsync(12000);
  await settle();
  expect(calls('client.list')).toHaveLength(1);
  expect(calls('workspace.getBrowserClient')).toHaveLength(1);
  expect(view().eligibleClients).toEqual([]);
});

it('cancelled old placement cannot delete the recovered row with the same id', async () => {
  const { browserTabRecoveryKey } = await import('../../panel-layout/sagas/browser-tab-recovery');
  const { browserTabUpserted } = await import('../browser-clients-slice');
  const { registryLoading, registryApplied } =
    await import('../../browser-tab-registry/browser-tab-registry-slice');
  const { openTabInRightmostColumnRequested, openTabInRightmostColumn, closeTab } =
    await import('../../panel-layout/panel-layout-slice');
  const { getRecoveryLifetime, withRecoveryLifetime } =
    await import('../../../middlewares/event-recovery');
  const { dispatchBrowserTabEvent } =
    await import('../../panel-layout/sagas/browser-tab-event-receipt');
  const { take, put, call } = await import('typed-redux-saga');
  await startTabs([row('keep')]);
  store.dispatch(registryLoading(WS));
  store.dispatch(
    registryApplied(WS, store.state.browserTabRegistry.byWorkspaceId[WS].generation, {}),
  );
  const hold = deferred<void>();
  let placementStarted = false;
  const stopRouter = store.runSaga(function* () {
    const action = yield* take(openTabInRightmostColumnRequested);
    placementStarted = true;
    yield* call(() => hold.promise);
    yield* put(
      withRecoveryLifetime(
        openTabInRightmostColumn(WS, action.payload.tab, {
          newTabId: action.payload.newTabId,
          allowDuplicate: true,
        }),
        getRecoveryLifetime(action)!,
      ),
    );
  });
  try {
    rendererEventRecovery.push(browserTabRecoveryKey(WS));
    const done = dispatchBrowserTabEvent(
      browserTabUpserted(WS, row('placed', 'https://obsolete.test/')),
      rendererEventRecovery.capture(browserTabRecoveryKey(WS)),
    );
    await settle();
    expect(placementStarted).toBe(true);
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'browser.listTabs'
        ? Promise.resolve({ tabs: [row('keep'), row('placed', 'https://current.test/')] })
        : normal(method, params),
    );
    loseTabs();
    await settle();
    expect(tabs().find((t) => t.id === 'placed')?.browserUrl).toBe('https://current.test/');
    const closes: unknown[] = [];
    const stopCloseObserver = store.runSaga(function* () {
      while (true) closes.push(yield* take(closeTab));
    });
    hold.resolve();
    await vi.advanceTimersByTimeAsync(5500);
    await settle();
    await done;
    stopCloseObserver();
    expect(closes).toEqual([]);
    expect(tabs().find((t) => t.id === 'placed')?.browserUrl).toBe('https://current.test/');
  } finally {
    stopRouter();
  }
});

it.each<BrowserTabViewport>([
  { mode: 'fit' },
  { mode: 'custom', width: 390, height: 844 },
  { mode: 'preset', presetId: 'mobile', width: 390, height: 844 },
])(
  'preserves a live host viewport $mode while recovering canonical mirrors and rehomes',
  async (viewport) => {
    const { updateTabViewport, setTabOwnerAgent } =
      await import('../../panel-layout/panel-layout-slice');
    const canonicalSize = { width: 1280, height: 800 };
    await startTabs([
      { ...row('hosted'), hostClientId: 'desktop', emulatedSize: canonicalSize },
      { ...row('mirror'), hostClientId: 'remote', emulatedSize: canonicalSize },
      { ...row('rehome'), hostClientId: 'remote', emulatedSize: canonicalSize },
    ]);
    for (const id of ['hosted', 'mirror', 'rehome'])
      store.dispatch(updateTabViewport(WS, id, viewport));
    const retainedSize = { width: 600, height: 480 };
    store.dispatch(setTabOwnerAgent(WS, 'hosted', 'agent', retainedSize, undefined, viewport));
    await settle();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'browser.listTabs'
        ? Promise.resolve({
            tabs: [
              { ...row('hosted'), hostClientId: 'desktop', emulatedSize: canonicalSize },
              { ...row('mirror'), hostClientId: 'remote', emulatedSize: canonicalSize },
              { ...row('rehome'), hostClientId: 'desktop', emulatedSize: canonicalSize },
            ],
          })
        : normal(method, params),
    );
    rpc.request.mockClear();
    loseTabs();
    await settle();
    expect(tabs().find((tab) => tab.id === 'hosted')).toMatchObject({
      viewport,
      emulatedSize: retainedSize,
    });
    for (const id of ['mirror', 'rehome'])
      expect(tabs().find((tab) => tab.id === id)).toMatchObject({
        viewport: { mode: 'custom', ...canonicalSize },
        emulatedSize: canonicalSize,
      });
    expect(calls('browser.listTabs')).toHaveLength(1);
    expect(rpc.request.mock.calls.map(([method]) => method)).toEqual([
      'events.fence',
      'browser.listTabs',
      'events.fence',
    ]);
  },
);

it('global client event receipt settles without an unscoped roster read', async () => {
  const { hydrateBrowserClientsRequested } = await import('../browser-clients-slice');
  const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
  const { browserClientRecoveryKey } = await import('./browser-client-recovery');
  await attach();
  store.dispatch(hydrateBrowserClientsRequested());
  await settle();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  rpc.request.mockClear();
  // Consumer workspaces receive their own receipts; the global one owns no read.
  rendererEventRecovery.push(browserClientRecoveryKey());
  await dispatchBrowserClientEvent(
    undefined,
    rendererEventRecovery.capture(browserClientRecoveryKey()),
  );
  await settle();
  expect(rpc.request.mock.calls).toEqual([]);
  expect(view().eligibleClients).toHaveLength(1);
});

it('admits client updated once and waits for both browser client read lanes', async () => {
  const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
  const { browserClientRecoveryKey } = await import('./browser-client-recovery');
  let admitted = false;
  let complete = false;
  await attach(true, async (_event, lifetimes) => {
    const token = lifetimes.get(browserClientRecoveryKey(WS));
    if (!token) return;
    admitted = true;
    await dispatchBrowserClientEvent(WS, token);
    complete = true;
  });
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  clients = [];
  pin = 'updated-host';
  rpc.request.mockClear();
  receive({
    method: 'events.event',
    params: {
      subscriptionId: 'browser-1',
      event: {
        type: 'client:updated',
        data: { clientId: 'desktop', capabilities: { browserExec: true } },
      },
    },
  });
  await settle();
  expect(admitted).toBe(true);
  expect(complete).toBe(true);
  expect(view().eligibleClients).toEqual([]);
  expect(view().pinnedClientId).toBe('updated-host');
  expect(calls('client.list')).toHaveLength(1);
  expect(calls('workspace.getBrowserClient')).toHaveLength(1);
  expect(calls('events.fence')).toHaveLength(0);
});

it('rejects a superseded global client admission without starting any read', async () => {
  const { hydrateBrowserClientsRequested } = await import('../browser-clients-slice');
  const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
  const { browserClientRecoveryKey } = await import('./browser-client-recovery');
  await attach();
  store.dispatch(hydrateBrowserClientsRequested());
  await settle();
  const old = rendererEventRecovery.capture(browserClientRecoveryKey());
  rendererEventRecovery.push(browserClientRecoveryKey());
  rpc.request.mockClear();
  await dispatchBrowserClientEvent(undefined, old);
  await settle();
  expect(rpc.request.mock.calls).toEqual([]);
});

it('client updated loss recovers the registered workspace client owner', async () => {
  const { hydrateBrowserClientsRequested } = await import('../browser-clients-slice');
  await attach();
  store.dispatch(hydrateBrowserClientsRequested());
  await settle();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  await scope.subscribe({ eventTypes: ['client:updated'] }, { recover: true });
  clients = [];
  pin = 'recovered-from-update';
  rpc.request.mockClear();
  lose('1', 'browser-2');
  await settle();
  expect(view().eligibleClients).toEqual([]);
  expect(view().pinnedClientId).toBe('recovered-from-update');
  // No consumer reads the unscoped roster, so only the workspace owner recovers.
  expect(calls('client.list').map(([, params]) => params)).toEqual([{ workspaceId: WS }]);
  expect(calls('workspace.getBrowserClient')).toHaveLength(1);
});

it('legacy broad refresh still fans out into mounted workspace reads', async () => {
  const { refreshLiveClientsRequested } = await import('../browser-clients-slice');
  await attach(false);
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  clients = [];
  pin = 'legacy-refresh';
  rpc.request.mockClear();
  store.dispatch(refreshLiveClientsRequested());
  await settle();
  expect(view().eligibleClients).toEqual([]);
  expect(view().pinnedClientId).toBe('legacy-refresh');
  expect(rpc.request.mock.calls.map(([method, params]) => [method, params])).toEqual([
    ['client.list', { workspaceId: WS }],
    ['workspace.getBrowserClient', { workspaceId: WS }],
  ]);
});

it.each([
  { type: 'settings:changed', data: { key: 'appearance.theme' } },
  {
    type: 'workspace:updated',
    workspaceId: 'other',
    data: { changes: { browserClientId: 'other-host' } },
  },
  { type: 'workspace:updated', workspaceId: WS, data: { changes: { title: 'Renamed' } } },
  { type: 'workspace:updated', workspaceId: WS, data: { changes: { browserClientId: false } } },
])(
  'keeps a held browser read current across unrelated event $type $workspaceId $data',
  async (event) => {
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    const held = deferred<unknown>();
    rpc.request.mockClear();
    rpc.request.mockImplementationOnce(() => held.promise);
    store.dispatch(fetchWorkspaceBrowserClientRequested(WS));
    await settle();
    receive({ method: 'events.event', params: { subscriptionId: 'browser-1', event } });
    await settle();
    held.resolve({
      browserClient: { source: 'workspace', clientId: 'held-current', resolved: null },
    });
    await settle();
    expect(view().pinnedClientId).toBe('held-current');
    expect(rpc.request.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ['workspace.getBrowserClient', { workspaceId: WS }],
    ]);
  },
);

it.each(['new-pin', null])(
  'admits a browser pin update only for its workspace: %s',
  async (browserClientId) => {
    const { hydrateBrowserClientsRequested } = await import('../browser-clients-slice');
    const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
    const { browserClientRecoveryKey } = await import('./browser-client-recovery');
    const admittedKeys: string[] = [];
    await attach(true, async (_event, lifetimes) => {
      await Promise.all(
        [undefined, WS, 'other'].map(async (workspaceId) => {
          const key = browserClientRecoveryKey(workspaceId);
          const token = lifetimes.get(key);
          if (!token) return;
          admittedKeys.push(key);
          await dispatchBrowserClientEvent(workspaceId, token, false);
        }),
      );
    });
    pin = 'original';
    store.dispatch(hydrateBrowserClientsRequested());
    await settle();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    store.dispatch(browserClientsConsumerMounted('other', 'test-browser'));
    await settle();
    pin = browserClientId;
    rpc.request.mockClear();
    receive({
      method: 'events.event',
      params: {
        subscriptionId: 'browser-1',
        event: {
          type: 'workspace:updated',
          workspaceId: WS,
          data: { changes: { browserClientId } },
        },
      },
    });
    await settle();
    expect(admittedKeys).toEqual([browserClientRecoveryKey(WS)]);
    expect(view().pinnedClientId).toBe(browserClientId);
    expect(selectWorkspaceDrivingClient.select(store.state, 'other').pinnedClientId).toBe(
      'original',
    );
    expect(rpc.request.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ['workspace.getBrowserClient', { workspaceId: WS }],
    ]);
  },
);

it('a recovered pin leaves its resolution read to the original receipt', async () => {
  const { workspaceBrowserClientPinReceived } = await import('../browser-clients-slice');
  const { withRecoveryLifetime } = await import('../../../middlewares/event-recovery');
  const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
  const { browserClientRecoveryKey } = await import('./browser-client-recovery');
  await attach();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  pin = 'recovered-pin';
  rpc.request.mockClear();
  const key = browserClientRecoveryKey(WS);
  rendererEventRecovery.push(key);
  const receipt = rendererEventRecovery.capture(key);
  // The bridge applies an admitted pin with its receipt, then requests the read.
  store.dispatch(
    withRecoveryLifetime(workspaceBrowserClientPinReceived(WS, 'recovered-pin'), receipt),
  );
  await dispatchBrowserClientEvent(WS, receipt, false);
  await settle();
  expect(view().pinnedClientId).toBe('recovered-pin');
  expect(calls('workspace.getBrowserClient')).toHaveLength(1);
  expect(receipt.commit(() => undefined)).toBe(true);
});

it('does not recover browser state for a settings-only loss', async () => {
  await attach();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const previous = view();
  rpc.request.mockClear();
  lose('1', 'browser-2');
  await settle();
  expect(view()).toEqual(previous);
  expect(rpc.request.mock.calls).toEqual([]);
});

it('an unconsumed global refresh reads nothing before or after principal readmission', async () => {
  const { admitLegacyPrincipal } = await import('../../../../../test/fixtures/principal-state');
  const { principalIdentityChanged, principalReceived } =
    await import('../../principal/principal-slice');
  const { refreshLiveClientsRequested } = await import('../browser-clients-slice');
  admitLegacyPrincipal();
  await attach();
  rpc.request.mockClear();
  store.dispatch(refreshLiveClientsRequested());
  await settle();
  expect(rpc.request.mock.calls).toEqual([]);
  const before = store.state.principal;
  if (!before.snapshot || !before.context || !before.boundPrincipalId)
    throw new Error('Fixture not admitted');
  store.dispatch(principalIdentityChanged(before.boundPrincipalId));
  store.dispatch(
    principalReceived(
      {
        context: before.context,
        invalidation: store.state.principal.invalidation,
        presentationVersion: store.state.principal.presentationVersion,
      },
      before.snapshot,
    ),
  );
  await settle();
  store.dispatch(refreshLiveClientsRequested());
  await settle();
  expect(rpc.request.mock.calls).toEqual([]);
  expect(selectLiveClients.select(store.state)).toEqual([]);
});

it.each([WS])(
  'settles an event receipt displaced by an ordinary read for %s',
  async (workspaceId) => {
    const { hydrateBrowserClientsRequested, refreshLiveClientsRequested } =
      await import('../browser-clients-slice');
    const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
    const { browserClientRecoveryKey } = await import('./browser-client-recovery');
    await attach();
    if (workspaceId) store.dispatch(browserClientsConsumerMounted(workspaceId, 'test-browser'));
    else store.dispatch(hydrateBrowserClientsRequested());
    await settle();
    const roster = deferred<unknown>(),
      selection = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    let firstRoster = true,
      firstSelection = true;
    rpc.request.mockImplementation((method, params) => {
      if (method === 'client.list' && firstRoster) {
        firstRoster = false;
        return roster.promise;
      }
      if (method === 'workspace.getBrowserClient' && firstSelection) {
        firstSelection = false;
        return selection.promise;
      }
      return normal(method, params);
    });
    rpc.request.mockClear();
    const key = browserClientRecoveryKey(workspaceId);
    rendererEventRecovery.push(key);
    const activeDone = vi.fn();
    const active = dispatchBrowserClientEvent(workspaceId, rendererEventRecovery.capture(key)).then(
      activeDone,
    );
    await settle();
    rendererEventRecovery.push(key);
    const queuedDone = vi.fn();
    const queued = dispatchBrowserClientEvent(workspaceId, rendererEventRecovery.capture(key)).then(
      queuedDone,
    );
    store.dispatch(refreshLiveClientsRequested(workspaceId));
    if (workspaceId) store.dispatch(fetchWorkspaceBrowserClientRequested(workspaceId));
    await settle();
    expect(queuedDone).toHaveBeenCalledOnce();
    expect(activeDone).not.toHaveBeenCalled();
    expect(calls('client.list')).toHaveLength(1);
    expect(calls('workspace.getBrowserClient')).toHaveLength(workspaceId ? 1 : 0);
    clients = [];
    pin = 'ordinary-current';
    roster.resolve({ clients: [client] });
    selection.resolve({ browserClient: { source: 'default', resolved: null } });
    await Promise.all([active, queued]);
    await settle();
    expect(calls('client.list')).toHaveLength(2);
    // Ordinary roster completion also refreshes resolution, preserving its existing follow-up.
    expect(calls('workspace.getBrowserClient')).toHaveLength(workspaceId ? 3 : 0);
    if (workspaceId) {
      expect(view().eligibleClients).toEqual([]);
      expect(view().pinnedClientId).toBe('ordinary-current');
    } else expect(selectLiveClients.select(store.state)).toEqual([]);
  },
);

it.each(['unmount', 'dispose'])(
  'settles active and queued receipts on %s without starting a trailing read',
  async (ending) => {
    const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
    const { browserClientRecoveryKey } = await import('./browser-client-recovery');
    await attach();
    store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
    await settle();
    const roster = deferred<unknown>(),
      selection = deferred<unknown>();
    const normal = rpc.request.getMockImplementation()!;
    rpc.request.mockImplementation((method, params) =>
      method === 'client.list'
        ? roster.promise
        : method === 'workspace.getBrowserClient'
          ? selection.promise
          : normal(method, params),
    );
    rpc.request.mockClear();
    const key = browserClientRecoveryKey(WS);
    rendererEventRecovery.push(key);
    const activeDone = vi.fn();
    const active = dispatchBrowserClientEvent(WS, rendererEventRecovery.capture(key)).then(
      activeDone,
    );
    await settle();
    rendererEventRecovery.push(key);
    const queuedDone = vi.fn();
    const queued = dispatchBrowserClientEvent(WS, rendererEventRecovery.capture(key)).then(
      queuedDone,
    );
    await settle();
    expect(activeDone).not.toHaveBeenCalled();
    expect(queuedDone).not.toHaveBeenCalled();
    if (ending === 'unmount') store.dispatch(workspaceUnmounted(WS));
    else cancel();
    await settle();
    expect(activeDone).toHaveBeenCalledOnce();
    expect(queuedDone).toHaveBeenCalledOnce();
    expect(calls('client.list')).toHaveLength(1);
    expect(calls('workspace.getBrowserClient')).toHaveLength(1);
    const afterRetirement = JSON.stringify(store.state.browserClients);
    roster.resolve({ clients: [{ ...client, clientId: 'obsolete-client' }] });
    selection.resolve({
      browserClient: { source: 'workspace', clientId: 'obsolete-pin', resolved: null },
    });
    await Promise.all([active, queued]);
    await settle();
    expect(JSON.stringify(store.state.browserClients)).toBe(afterRetirement);
    expect(calls('client.list')).toHaveLength(1);
    expect(calls('workspace.getBrowserClient')).toHaveLength(1);
  },
);

it('keeps a removed workspace inactive after queued reads and a later loss', async () => {
  const { dispatchBrowserClientEvent } = await import('./browser-client-event-receipt');
  const { browserClientRecoveryKey } = await import('./browser-client-recovery');
  await attach();
  store.dispatch(browserClientsConsumerMounted(WS, 'test-browser'));
  await settle();
  const roster = deferred<unknown>(),
    selection = deferred<unknown>();
  const normal = rpc.request.getMockImplementation()!;
  rpc.request.mockImplementation((method, params) =>
    method === 'client.list'
      ? roster.promise
      : method === 'workspace.getBrowserClient'
        ? selection.promise
        : normal(method, params),
  );
  rpc.request.mockClear();
  const key = browserClientRecoveryKey(WS);
  rendererEventRecovery.push(key);
  const active = dispatchBrowserClientEvent(WS, rendererEventRecovery.capture(key));
  await settle();
  rendererEventRecovery.push(key);
  const queued = dispatchBrowserClientEvent(WS, rendererEventRecovery.capture(key));
  await settle();
  store.dispatch(workspaceUnmounted(WS));
  await settle();
  expect.soft(calls('client.list')).toHaveLength(1);
  roster.resolve({ clients: [client] });
  selection.resolve({ browserClient: { source: 'default', resolved: null } });
  await Promise.all([active, queued]);
  await settle();
  expect.soft(store.state.browserClients.byWorkspaceId[WS]).toBeUndefined();
  expect.soft(rendererEventRecovery.capture(key).isCurrent()).toBe(false);
  rpc.request.mockImplementation(normal);
  rpc.request.mockClear();
  pin = 'after-removal';
  lose();
  await settle();
  expect.soft(rpc.request.mock.calls).toEqual([]);
  expect.soft(calls('client.list')).toHaveLength(0);
  expect.soft(calls('workspace.getBrowserClient')).toHaveLength(0);
  expect.soft(store.state.browserClients.byWorkspaceId[WS]).toBeUndefined();
  expect.soft(rendererEventRecovery.capture(key).isCurrent()).toBe(false);
});
