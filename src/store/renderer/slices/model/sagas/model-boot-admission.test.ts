import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import DefaultAgentModelSettings from '$lib/components/settings/DefaultAgentModelSettings.svelte';

const settings = vi.hoisted(() => ({ getProviderSettings: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveModelsClient } = await import('$lib/client/live/live-models-client');
  const { LiveProvidersClient } = await import('$lib/client/live/live-providers-client');
  return {
    appClient: { models: new LiveModelsClient(), providers: new LiveProvidersClient(), settings },
  };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { HOST_EXECUTION_FIXTURE } from '../../../../../test/fixtures/host-execution-state';
import { MOCK_PROVIDER_CATALOG } from '../../../../../test/fixtures/provider-catalog.fixture';
import {
  principalContextChanged,
  principalReceived,
  principalIdentityChanged,
  hostMembershipChanged,
} from '../../principal/principal-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { hostExecutionSaga } from '../../host-execution/sagas/host-execution-saga';
import { selectModelEffortLevels } from '../model-selectors';
import { modelBootSaga } from './model-boot-saga';

const request = vi.mocked(backendRequest);
const handlers: Array<(value: unknown) => void> = [];
const cancellations: Array<() => void> = [];
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let dispose: () => void;
const wire = (providerId = 'codex', id = 'catalog-only-model') => ({
  providerId,
  source: 'static',
  models: [{ id, name: 'Catalog-only model', effortLevels: ['low', 'medium', 'high'] }],
});
const modelCalls = () => request.mock.calls.filter(([method]) => method === 'models.list');
function provider(id = 'codex') {
  applySettingsChanges([
    { path: 'model.defaultProvider', value: id },
    { path: 'model.providerDefaults', value: { [id]: 'catalog-only-model' } },
    { path: 'model.defaultReasoningEffort', value: 'high' },
  ]);
}
function connect(id = 'shared-host') {
  store.dispatch(connectionsListReceived({ connections: [], activeId: id, windowBackendId: id }));
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
}
function member(revision = 1, role: 'member' | 'guest' = 'member') {
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  store.dispatch(
    principalReceived(
      {
        context,
        invalidation: store.state.principal.invalidation,
        presentationVersion: store.state.principal.presentationVersion,
      },
      {
        principal: {
          id: 'member',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: false,
          hostRole: role,
          hostMembershipRevision: revision,
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
function start() {
  cancellations.push(store.runSaga(modelBootSaga));
}

beforeEach(() => {
  vi.clearAllMocks();
  dispose = store.init();
  handlers.length = 0;
  window.electronAPI = {
    on: vi.fn((_channel, handler) => {
      handlers.push(handler);
      return 'catalog-status';
    }),
    offById: vi.fn(),
  } as unknown as typeof window.electronAPI;
  settings.getProviderSettings.mockResolvedValue(null);
  request.mockImplementation(async (method, params) => {
    if (method === 'models.list') return wire((params as { providerId: string }).providerId);
    if (method === 'providers.catalog') return MOCK_PROVIDER_CATALOG;
    if (method === 'host.executionContext') return HOST_EXECUTION_FIXTURE;
    throw new Error(`Unexpected fixture request ${method}`);
  });
});
afterEach(() => {
  cancellations.splice(0).forEach((cancel) => cancel());
  cleanup();
  dispose();
});

describe('model catalog admission through the real store and models client', () => {
  it('loads after startup/connected precede owner admission and settings, without losing saved effort', async () => {
    start();
    handlers.forEach((handler) => handler({ status: 'connected' }));
    await settle();
    expect(modelCalls()).toHaveLength(0);
    admitLegacyPrincipal();
    await settle();
    provider();
    await vi.waitFor(() =>
      expect(modelCalls()).toEqual([['models.list', { providerId: 'codex' }]]),
    );
    await vi.waitFor(() =>
      expect(selectModelEffortLevels.select(store.state, 'catalog-only-model')).toEqual([
        'low',
        'medium',
        'high',
      ]),
    );
    render(DefaultAgentModelSettings, { context: new Map([['redux-store-context', { store }]]) });
    await tick();
    expect(screen.getByRole('button', { name: /Catalog-only model/ })).toBeTruthy();
    expect(store.state.model.defaultReasoningEffort).toBe('high');
    expect(request.mock.calls.every(([method]) => method === 'models.list')).toBe(true);
    // Ordinary single-user owner operation remains available with Multiplayer off.
    expect(store.state.userPreferences.labsMultiplayerEnabled).toBe(false);
  });

  it('waits for the admitted member host execution projection and never reads owner settings', async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementation(async (method, params) => {
      if (method === 'host.executionContext')
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (method === 'providers.catalog') return MOCK_PROVIDER_CATALOG;
      if (method === 'models.list') return wire((params as { providerId: string }).providerId);
      throw new Error(`Unexpected member request ${method}`);
    });
    cancellations.push(store.runSaga(hostExecutionSaga));
    start();
    connect();
    member();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(modelCalls()).toHaveLength(0);
    finish(HOST_EXECUTION_FIXTURE);
    await vi.waitFor(() =>
      expect(modelCalls()).toEqual([['models.list', { providerId: 'claude-code' }]]),
    );
    await vi.waitFor(() =>
      expect(selectModelEffortLevels.select(store.state, 'catalog-only-model')).toEqual([
        'low',
        'medium',
        'high',
      ]),
    );
    expect(settings.getProviderSettings).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'guest', 'revoked'] as const)(
    'does not use hydrated owner preferences for an %s caller',
    async (role) => {
      provider();
      if (role === 'guest') admitLegacyPrincipal('guest');
      if (role === 'revoked') {
        admitLegacyPrincipal();
        store.dispatch(
          hostMembershipChanged({ action: 'removed', principalId: 'principal', revision: 1 }),
        );
      }
      start();
      handlers.forEach((handler) => handler({ status: 'connected', reconnected: true }));
      await settle();
      expect(modelCalls()).toHaveLength(0);
      expect(settings.getProviderSettings).not.toHaveBeenCalled();
    },
  );

  it.each(['readmission', 'backend', 'guest', 'disposal'] as const)(
    'fences a held catalog across %s',
    async (replacement) => {
      let finish!: (value: unknown) => void;
      request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      admitLegacyPrincipal();
      provider();
      start();
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      if (replacement === 'disposal') cancellations.splice(0).forEach((cancel) => cancel());
      else if (replacement === 'backend') connect('replacement-host');
      else if (replacement === 'guest') admitLegacyPrincipal('guest');
      else store.dispatch(principalIdentityChanged('principal'));
      finish(wire('codex', 'obsolete-catalog'));
      await settle();
      expect(selectModelEffortLevels.select(store.state, 'obsolete-catalog')).toBeUndefined();
      expect(modelCalls()).toHaveLength(1);
      if (replacement === 'readmission') {
        admitLegacyPrincipal();
        await vi.waitFor(() => expect(modelCalls()).toHaveLength(2));
        expect(selectModelEffortLevels.select(store.state, 'obsolete-catalog')).toBeUndefined();
      }
    },
  );

  it('coalesces provider readiness changes during a held load into the current provider only', async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    admitLegacyPrincipal();
    provider();
    start();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    provider('auggie');
    provider('claude-code');
    handlers.forEach((handler) => handler({ status: 'connected', reconnected: true }));
    expect(modelCalls()).toHaveLength(1);
    finish(wire('codex', 'obsolete-catalog'));
    await vi.waitFor(() =>
      expect(modelCalls()).toEqual([
        ['models.list', { providerId: 'codex' }],
        ['models.list', { providerId: 'claude-code' }],
      ]),
    );
    await settle();
    expect(modelCalls()).toHaveLength(2);
    expect(store.state.model.availableModelsProviderId).toBe('claude-code');
  });

  it('does not spin on an empty catalog or unrelated store changes, but retries a reconnect', async () => {
    request.mockResolvedValue({ providerId: 'codex', models: [], source: 'static' });
    admitLegacyPrincipal();
    provider();
    start();
    await settle();
    provider();
    provider();
    await settle();
    expect(modelCalls()).toHaveLength(1);
    handlers.forEach((handler) => handler({ status: 'connected' }));
    await settle();
    expect(modelCalls()).toHaveLength(2);
  });
});
