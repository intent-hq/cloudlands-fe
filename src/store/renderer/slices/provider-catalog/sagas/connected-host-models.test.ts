import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveProvidersClient } = await import('$lib/client/live/live-providers-client');
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return {
    appClient: { providers: new LiveProvidersClient(), settings: new LiveSettingsClient() },
  };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { MOCK_PROVIDER_CATALOG } from '../../../../../test/fixtures/provider-catalog.fixture';
import { principalReceived, principalContextChanged } from '../../principal/principal-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { hostExecutionInvalidated } from '../../host-execution/host-execution-slice';
import { hostExecutionSaga } from '../../host-execution/sagas/host-execution-saga';
import { settingsHydrationSaga } from '../../settings-events/sagas/settings-hydration-saga';
import {
  selectActiveProviderId,
  selectEnabledProviderIds,
} from '../../provider-settings/provider-settings-selectors';
import { selectSelectedModel } from '../../model/model-selectors';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import {
  __resetSettingsReadCacheForTests,
  readSetting,
} from '$lib/client/live/live-settings-client';

const request = vi.mocked(backendRequest);
const policy = {
  provider: 'github',
  protocol: 'https',
  host: 'github.com',
  managedHelperEnabled: false,
  setting: 'sourceControl.github.exposeGitCredentialToChildren',
};
let dispose: () => void;
const stop: (() => void)[] = [];

function admitMember(backendId: string) {
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: backendId, windowBackendId: backendId }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  store.dispatch(
    principalReceived(
      { context, invalidation: 0, presentationVersion: 0 },
      {
        principal: {
          id: 'member',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: false,
          hostRole: 'member',
          hostMembershipRevision: 1,
        },
        capabilities: {
          hostMembership: true,
          personalPairing: false,
          authenticatedDevices: false,
          collaborationIdentity: false,
        },
      },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSettingsReadCacheForTests();
  dispose = store.init();
  admitLegacyPrincipal();
  applySettingsChanges([
    { path: 'model.defaultProvider', value: 'auggie' },
    { path: 'model.providerDefaults', value: { auggie: 'local-model' } },
  ]);
  request.mockImplementation(async (method) => {
    if (method === 'providers.catalog') return MOCK_PROVIDER_CATALOG;
    if (method === 'host.executionContext')
      return {
        defaultProviderId: 'claude-code',
        defaultModelId: 'host-sonnet',
        enabledProviderIds: ['claude-code', 'codex'],
        repositoryConnections: [],
        gitCredentialPolicy: policy,
      };
    throw new Error(`Unexpected member request: ${method}`);
  });
});

it('does not reuse owner settings or wait for the previous host after a window switch', async () => {
  let finishOld!: (value: unknown) => void;
  const setting = (value: string) => ({
    definition: {
      path: 'model.defaultProvider',
      type: 'string',
      label: 'Provider',
      category: 'model',
    },
    value,
  });
  request.mockImplementation(async (method) => {
    if (method === 'providers.catalog') return MOCK_PROVIDER_CATALOG;
    if (method === 'settings.get') {
      if (store.state.connections.windowBackendId === 'host-b') return setting('codex');
      return new Promise((resolve) => {
        finishOld = resolve;
      });
    }
    throw new Error(`Unexpected owner request: ${method}`);
  });
  stop.push(store.runSaga(hostExecutionSaga));
  const old = readSetting('model.defaultProvider');
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'host-b', windowBackendId: 'host-b' }),
  );
  admitLegacyPrincipal();
  const fresh = readSetting('model.defaultProvider');
  try {
    expect(request.mock.calls.filter(([method]) => method === 'settings.get')).toHaveLength(2);
    expect(await fresh).toMatchObject({ value: 'codex' });
  } finally {
    finishOld(setting('auggie'));
    await old;
  }
  expect(await readSetting('model.defaultProvider')).toMatchObject({ value: 'codex' });
});
afterEach(() => {
  stop.splice(0).forEach((cancel) => cancel());
  dispose();
});

describe('connected host model defaults', () => {
  it('replaces local defaults with the member host projection without reading settings or repository auth', async () => {
    admitMember('shared-host');
    stop.push(store.runSaga(hostExecutionSaga), store.runSaga(settingsHydrationSaga));
    await vi.waitFor(() => expect(selectActiveProviderId.select(store.state)).toBe('claude-code'));
    expect(selectSelectedModel.select(store.state)).toBe('host-sonnet');
    expect(selectEnabledProviderIds.select(store.state)).toEqual(['claude-code', 'codex']);
    expect(request).toHaveBeenCalledWith('host.executionContext', {});
    expect(
      request.mock.calls.some(
        ([method]) => method.startsWith('settings.') || method.startsWith('sourceControl.'),
      ),
    ).toBe(false);
  });

  it('discards an earlier host response after the window reconnects to another host', async () => {
    let resolveOld!: (value: unknown) => void;
    request.mockImplementation(async (method) => {
      if (method === 'providers.catalog') return MOCK_PROVIDER_CATALOG;
      if (method === 'host.executionContext') {
        if (store.state.connections.windowBackendId === 'host-a')
          return new Promise((resolve) => {
            resolveOld = resolve;
          });
        return {
          defaultProviderId: 'codex',
          defaultModelId: 'host-b-model',
          repositoryConnections: [],
          gitCredentialPolicy: policy,
        };
      }
      throw new Error(`Unexpected member request: ${method}`);
    });
    admitMember('host-a');
    stop.push(store.runSaga(hostExecutionSaga));
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    admitMember('host-b');
    await vi.waitFor(() => expect(selectSelectedModel.select(store.state)).toBe('host-b-model'));
    resolveOld({
      defaultProviderId: 'claude-code',
      defaultModelId: 'stale-a',
      repositoryConnections: [],
      gitCredentialPolicy: policy,
    });
    await Promise.resolve();
    expect(selectActiveProviderId.select(store.state)).toBe('codex');
    expect(selectSelectedModel.select(store.state)).toBe('host-b-model');
  });
});

it('refreshes host policy on invalidation and withholds unsupported choices from older hosts', async () => {
  admitMember('shared-host');
  stop.push(store.runSaga(hostExecutionSaga));
  await vi.waitFor(() =>
    expect(selectEnabledProviderIds.select(store.state)).toEqual(['claude-code', 'codex']),
  );
  request.mockImplementation(async (method) =>
    method === 'providers.catalog'
      ? MOCK_PROVIDER_CATALOG
      : {
          defaultProviderId: 'claude-code',
          defaultModelId: 'display-only',
          repositoryConnections: [],
          gitCredentialPolicy: policy,
        },
  );
  store.dispatch(hostExecutionInvalidated());
  await vi.waitFor(() => expect(selectSelectedModel.select(store.state)).toBe('display-only'));
  expect(selectEnabledProviderIds.select(store.state)).toEqual([]);
});

it('does not fall back to local setup when the connected host has no provider or repository setup', async () => {
  request.mockImplementation(async (method) =>
    method === 'providers.catalog'
      ? MOCK_PROVIDER_CATALOG
      : {
          defaultProviderId: null,
          defaultModelId: null,
          enabledProviderIds: [],
          repositoryConnections: [],
          gitCredentialPolicy: policy,
        },
  );
  admitMember('shared-host');
  stop.push(store.runSaga(hostExecutionSaga), store.runSaga(settingsHydrationSaga));
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('host.executionContext', {}));
  expect(selectActiveProviderId.select(store.state)).toBe('');
  expect(selectEnabledProviderIds.select(store.state)).toEqual([]);
  expect(
    request.mock.calls.some(
      ([method]) => method.startsWith('settings.') || method.startsWith('sourceControl.'),
    ),
  ).toBe(false);
});

it('drops an old catalog and rehydrates on same-host reconnect', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  admitMember('shared-host');
  stop.push(store.runSaga(hostExecutionSaga));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  store.dispatch(connectionStatusChanged('disconnected'));
  admitMember('shared-host');
  await vi.waitFor(() =>
    expect(
      request.mock.calls.filter(([method]) => method === 'providers.catalog').length,
    ).toBeGreaterThan(1),
  );
  finish({ ...MOCK_PROVIDER_CATALOG, defaultProviderId: 'stale-local' });
  await Promise.resolve();
  expect(store.state.providerCatalog.defaultProviderId).not.toBe('stale-local');
  expect(selectActiveProviderId.select(store.state)).toBe('claude-code');
});

it('cancels pending catalog hydration on disposal without installing an unmanaged reconnect listener', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  admitMember('shared-host');
  const cancel = store.runSaga(hostExecutionSaga);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  cancel();
  finish({ ...MOCK_PROVIDER_CATALOG, defaultProviderId: 'cancelled-catalog' });
  await Promise.resolve();
  expect(store.state.providerCatalog.defaultProviderId).not.toBe('cancelled-catalog');
});
