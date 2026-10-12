import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import { getContext } from 'typed-redux-saga';
import { runSaga, type EffectMiddleware } from 'redux-saga';
import type { StoreDispatch } from '@themislib/themis/types';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createAdmittedLegacyPrincipal } from '../../../../../test/fixtures/admitted-legacy-principal';
import { connectionsReducer } from '../../connections/connections-slice';
import { daemonHealthReducer } from '../../daemon-health/daemon-health-slice';
import { workspaceEventsReducer } from '../../workspace-events/workspace-events-slice';
import { principalIdentityChanged, principalReducer } from '../../principal/principal-slice';
import { getPrincipalActionContext } from '../../principal/principal-projections';
import { userPreferencesReducer } from '../../user-preferences/user-preferences-slice';
import { openTab, openHiddenTab, panelLayoutReducer } from '../../panel-layout/panel-layout-slice';
import type { AgentReadScope } from './agent-read-admission';
import { createDeletedAgentCleanup } from './deleted-agent-cleanup-factory';

const logs = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => logs, logger: logs }));
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.clearAllMocks();
});

function fixture() {
  const reducers = {
    connections: connectionsReducer,
    daemonHealth: daemonHealthReducer,
    workspaceEvents: workspaceEventsReducer,
    principal: principalReducer,
    userPreferences: userPreferencesReducer,
    panelLayout: panelLayoutReducer,
  };
  const isolated = new ReactStore(reducers);
  disposers.push(
    isolated.init({
      ...createAdmittedLegacyPrincipal(),
      userPreferences: userPreferencesReducer.initialState,
      panelLayout: panelLayoutReducer.initialState,
    }),
  );
  type TestReduxStore = {
    getState: () => typeof isolated.state;
    dispatch: StoreDispatch;
    subscribe: (listener: () => void) => () => void;
  };
  let store!: TestReduxStore;
  const releaseContext = isolated.runSaga(function* captureCleanupTestReduxContext() {
    store = yield* getContext<TestReduxStore>('reduxStore');
  });
  releaseContext();
  store.dispatch(
    openTab(
      'ws',
      { type: 'agent', closable: true, title: 'Deleted', agentId: 'agent' },
      undefined,
      'agent-tab',
    ),
  );
  store.dispatch(
    openHiddenTab(
      'ws',
      { type: 'browser', closable: true, title: 'Owned', ownerAgentId: 'agent' },
      'owned',
    ),
  );
  const context = getPrincipalActionContext(store.getState());
  expect(context).not.toBeNull();
  const scope: AgentReadScope = {
    kind: 'principal',
    context: context!,
    readCurrentContext: () => getPrincipalActionContext(store.getState()),
    dispatch: isolated.dispatch,
  };
  const invoke = vi.fn().mockResolvedValue({ success: true, tabIds: ['owned'] });
  const cleanup = createDeletedAgentCleanup({ invoke });
  return {
    store,
    scope,
    invoke,
    run: (admitted?: AgentReadScope, effectMiddlewares: EffectMiddleware[] = []) =>
      runSaga(
        { dispatch: store.dispatch, getState: store.getState, effectMiddlewares },
        cleanup,
        'ws',
        'agent',
        admitted,
      ).toPromise(),
    revoke: () => store.dispatch(principalIdentityChanged('principal')),
  };
}

describe('canonical cleanup scope', () => {
  it('rejects an already-stale scope before any canonical state change or IPC', async () => {
    const f = fixture();
    f.revoke();
    const layout = f.store.getState().panelLayout;
    await f.run(f.scope);
    expect(f.store.getState().panelLayout).toBe(layout);
    expect(f.invoke).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('checks authority inside the native callable, after the effect has been yielded', async () => {
    const f = fixture();
    let intercepted = false;
    // This is the public saga interpreter boundary, not a replacement for the
    // invoke or authority check. Canonical state has completed all three
    // cleanup transitions, then authority changes just before CALL executes.
    const beforeNativeCall: EffectMiddleware = (next) => (effect) => {
      const layout = f.store.getState().panelLayout.byWorkspaceId.ws;
      const agentVisible = Object.values(layout.panels).some((panel) =>
        panel.tabs.some((tab) => tab.agentId === 'agent'),
      );
      if (
        !intercepted &&
        effect?.type === 'CALL' &&
        !agentVisible &&
        getItems(layout.hiddenTabs).length === 0 &&
        layout.recentlyClosed.length === 0
      ) {
        intercepted = true;
        f.revoke();
      }
      next(effect);
    };
    await f.run(f.scope, [beforeNativeCall]);
    expect(intercepted).toBe(true);
    expect(getPrincipalActionContext(f.store.getState())).toBeNull();
    expect(getItems(f.store.getState().panelLayout.byWorkspaceId.ws.hiddenTabs)).toEqual([]);
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it('retains source cleanup without an authority scope or saga Redux context', async () => {
    const f = fixture();
    f.revoke();
    await f.run();
    const layout = f.store.getState().panelLayout.byWorkspaceId.ws;
    expect(getItems(layout.hiddenTabs)).toEqual([]);
    expect(layout.recentlyClosed).toEqual([]);
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, {
      agentId: 'agent',
    });
  });

  it('logs a real invoke rejection after the admitted canonical cleanup', async () => {
    const f = fixture();
    const error = new Error('Host unavailable');
    f.invoke.mockRejectedValue(error);
    await f.run(f.scope);
    expect(getItems(f.store.getState().panelLayout.byWorkspaceId.ws.hiddenTabs)).toEqual([]);
    expect(logs.warn).toHaveBeenCalledWith(
      'Failed to clear main-process registrations for deleted agent tabs',
      { agentId: 'agent', error },
    );
  });

  it('does not claim to roll back an invoke authorized before revocation', async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.invoke.mockImplementation(() => {
      f.revoke();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const result = f.run(f.scope);
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(getPrincipalActionContext(f.store.getState())).toBeNull();
    finish({ success: true, tabIds: ['owned'] });
    await result;
    expect(getItems(f.store.getState().panelLayout.byWorkspaceId.ws.hiddenTabs)).toEqual([]);
  });
});
