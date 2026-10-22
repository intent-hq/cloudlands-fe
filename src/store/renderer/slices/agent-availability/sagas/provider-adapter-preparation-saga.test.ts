import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), invoke: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$features/providers/provider-adapter-preparation.client', () => ({
  prepareOnboardingAdapters: mocks.prepare,
}));
import { store } from '../../../store';
import {
  admitLegacyPrincipal,
  withHostPrincipal,
} from '../../../../../test/fixtures/principal-state';
import { providerAdapterPreparationSaga } from './provider-adapter-preparation-saga';
import { providerAvailabilitySaga } from './provider-availability-saga';
import { setOnboardingActive } from '../../sidebar-nav/sidebar-nav-slice';
import {
  providerSetupHydrated,
  setHasCompletedProviderSetup,
} from '../../user-preferences/user-preferences-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  prepareOnboardingAdaptersRequested,
  checkAllProvidersRequested,
  checkSingleProviderRequested,
} from '../agent-availability-slice';
import { selectOnboardingAdapterPreparationContext } from '../agent-availability-selectors';

const settle = async () => {
  for (let n = 0; n < 10; n++) await Promise.resolve();
};

describe('first-time onboarding preparation lifecycle', () => {
  let dispose: () => void;
  let cancel: () => void;
  beforeEach(() => {
    mocks.prepare.mockReset().mockResolvedValue(undefined);
    mocks.invoke.mockReset().mockImplementation(() => new Promise(() => {}));
    dispose = store.init();
    admitLegacyPrincipal();
    store.dispatch(providerSetupHydrated(store.state.connections.windowBackendId, false));
    cancel = store.runSaga(providerAdapterPreparationSaga);
  });
  afterEach(() => {
    cancel();
    dispose();
  });

  it('starts on entry, ignores repeated renders and refreshes without awaiting auth or preparation', async () => {
    mocks.prepare.mockImplementation(() => new Promise(() => {}));
    store.dispatch(setOnboardingActive(true));
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const context = selectOnboardingAdapterPreparationContext.select(store.state);
    expect(mocks.prepare).toHaveBeenCalledWith(context);
    store.dispatch(setOnboardingActive(true));
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    store.dispatch(prepareOnboardingAdaptersRequested());
    store.dispatch(prepareOnboardingAdaptersRequested());
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(3);
    expect(store.state.sidebarNav.onboardingActive).toBe(true);
  });

  it('routes bulk and single provider refreshes to preparation while authentication remains pending', async () => {
    store.dispatch(setOnboardingActive(true));
    await settle();
    mocks.prepare.mockClear();
    const cancelAvailability = store.runSaga(providerAvailabilitySaga);
    try {
      store.dispatch(checkAllProvidersRequested());
      await settle();
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
      expect(mocks.invoke).toHaveBeenCalledWith('providers:check-single', 'claude-code');
      expect(store.state.agentAvailability.providerLoadingMap['claude-code']).toBe(true);
      store.dispatch(checkSingleProviderRequested('pi'));
      await settle();
      expect(mocks.prepare).toHaveBeenCalledTimes(2);
    } finally {
      cancelAvailability();
    }
  });

  it('never prepares during ordinary discovery, after leaving onboarding or after completion even with no workspaces', async () => {
    store.dispatch(prepareOnboardingAdaptersRequested());
    await settle();
    expect(mocks.prepare).not.toHaveBeenCalled();
    store.dispatch(setOnboardingActive(true));
    await settle();
    store.dispatch(setOnboardingActive(false));
    store.dispatch(prepareOnboardingAdaptersRequested());
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    store.dispatch(setHasCompletedProviderSetup(true));
    store.dispatch(setOnboardingActive(true));
    store.dispatch(prepareOnboardingAdaptersRequested());
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it('waits for completion hydration on a new host and resumes after an admitted reconnect', async () => {
    store.dispatch(setOnboardingActive(true));
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'other', windowBackendId: 'other' }),
    );
    admitLegacyPrincipal();
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    store.dispatch(providerSetupHydrated('other', false));
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.prepare.mock.calls[1][0]).not.toBe(mocks.prepare.mock.calls[0][0]);
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    store.dispatch(prepareOnboardingAdaptersRequested());
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    store.dispatch(daemonEventsSubscribed());
    admitLegacyPrincipal();
    await settle();
    expect(mocks.prepare).toHaveBeenCalledTimes(3);
    expect(mocks.prepare.mock.calls[2][0]).not.toBe(mocks.prepare.mock.calls[1][0]);
  });

  it('does not inherit incomplete setup from another host while completed setup is hydrating', async () => {
    store.dispatch(
      connectionsListReceived({
        connections: [],
        activeId: 'complete',
        windowBackendId: 'complete',
      }),
    );
    admitLegacyPrincipal();
    store.dispatch(setOnboardingActive(true));
    store.dispatch(prepareOnboardingAdaptersRequested());
    await settle();
    expect(mocks.prepare).not.toHaveBeenCalled();
    store.dispatch(providerSetupHydrated('complete', true));
    store.dispatch(prepareOnboardingAdaptersRequested());
    await settle();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('does not authorize host preparation for member or guest onboarding', () => {
    store.dispatch(setOnboardingActive(true));
    for (const role of ['member', 'guest'] as const) {
      expect(
        selectOnboardingAdapterPreparationContext.select(withHostPrincipal(store.state, role)),
      ).toBeNull();
    }
  });
});
