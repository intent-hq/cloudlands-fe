import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), state: {} as any }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('../utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state });
});

import { withLegacyPrincipal } from '../../../test/fixtures/principal-state';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';
import {
  initialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '../slices/provider-catalog/provider-catalog-slice';
import { selectAvailableEnabledProviderIds } from '../slices/provider-settings/provider-settings-selectors';
import { mockInvoke } from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { __resetProviderAuthStatusForTests } from '$features/providers/provider-auth-status.client';

function admit(role: 'owner' | 'member' | 'guest') {
  mocks.state = withLegacyPrincipal({
    providerCatalog: providerCatalogReducer(
      initialState,
      providerCatalogLoaded({
        ...MOCK_PROVIDER_CATALOG,
        providers: MOCK_PROVIDER_CATALOG.providers.map((row) =>
          row.id === 'droid'
            ? { ...row, requiresEnvVar: 'INTENTD_ENABLE_DROID', visible: true }
            : row,
        ),
      }),
    ),
  });
  mocks.state.principal.snapshot.capabilities.hostMembership = true;
  Object.assign(mocks.state.principal.snapshot.principal, {
    hostRole: role,
    isAdministrator: role === 'owner',
  });
}

describe('admitted member setup bridge', () => {
  beforeAll(async () => {
    await import('./provider-status-bridge-seeder');
    await import('./host-bridge-seeder');
  });
  beforeEach(() => {
    mocks.request.mockReset();
    admit('member');
    __resetProviderAuthStatusForTests();
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'host.providerDiscovery')
        return {
          providers: [
            { id: 'grok', installed: true },
            { id: 'droid', installed: true },
            { id: 'auggie', installed: false },
            { id: 'mock', installed: false, gatedOff: 'disabled' },
          ],
        };
      if (method === 'host.providerAuthStatus')
        return {
          providers: [
            { id: 'grok', authenticated: true },
            { id: 'droid', authenticated: false },
          ],
        };
      if (method === 'host.toolAvailability') return { tools: { git: { available: true } } };
      throw Object.assign(new Error('Forbidden'), { code: -32003 });
    });
  });

  it('uses the host discovery and auth projection for aggregate and specialist availability', async () => {
    const aggregate = await mockInvoke<any>(PROVIDERS_CHANNELS.GET_AVAILABILITY);
    const specialist = await mockInvoke<any>(PROVIDERS_CHANNELS.CHECK_SINGLE, {
      providerId: 'droid',
      force: false,
    });
    expect(aggregate).toMatchObject({
      success: true,
      data: {
        hasAnyProvider: true,
        providers: {
          grok: { available: true, authenticated: true },
          auggie: { available: false },
        },
      },
    });
    expect(specialist).toMatchObject({
      success: true,
      data: { available: true, authenticated: false },
    });
    expect(
      mocks.request.mock.calls.every(([method]) =>
        ['host.providerDiscovery', 'host.providerAuthStatus'].includes(method),
      ),
    ).toBe(true);
  });

  it('does not probe the owner editor configuration during member startup', async () => {
    await mockInvoke(IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not label rejected discovery as all providers missing', async () => {
    mocks.request.mockRejectedValue(new Error('network unavailable'));
    expect(await mockInvoke<any>(PROVIDERS_CHANNELS.GET_AVAILABILITY)).toMatchObject({
      success: false,
    });
  });

  it.each(['guest', null] as const)(
    'does not run owner or member provider probes with %s authority',
    async (role) => {
      if (role) admit(role);
      else mocks.state.principal.status = 'loading';
      expect(await mockInvoke<any>(PROVIDERS_CHANNELS.GET_AVAILABILITY)).toMatchObject({
        success: false,
      });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it('discards a discovery reply after the connection changes', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation((method: string) =>
      method === 'host.providerDiscovery'
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve({ providers: [] }),
    );
    const pending = mockInvoke<any>(PROVIDERS_CHANNELS.GET_AVAILABILITY);
    mocks.state.connections.windowBackendId = 'host-B';
    resolve({ providers: [{ id: 'grok', installed: true }] });
    expect(await pending).toMatchObject({ success: false });
  });

  it('uses the permitted host tool projection for member Git presence', async () => {
    expect(await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_GIT)).toMatchObject({
      success: true,
      data: { available: true },
    });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('host.toolAvailability', {
      tools: ['git'],
    });
  });

  it('retains owner Git diagnostics', async () => {
    admit('owner');
    mocks.request.mockResolvedValue({ available: true, version: 'git version 2.45' });
    expect(await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_GIT)).toMatchObject({
      data: { available: true, version: 'git version 2.45' },
    });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('host.checkGit');
  });

  it.each([{}, { tools: {} }, { tools: { git: {} } }])(
    'does not report missing Git for a malformed projection %j',
    async (response) => {
      mocks.request.mockResolvedValue(response);
      expect(await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_GIT)).toEqual({
        success: true,
        data: { available: 'unknown' },
      });
    },
  );

  it('discards a Git result after the principal changes on the same connection', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_GIT);
    mocks.state.principal.snapshot.principal.id = 'different-member';
    resolve({ tools: { git: { available: true } } });
    expect(await pending).toEqual({ success: true, data: { available: 'unknown' } });
  });

  it('uses the host visibility verdict for an enabled specialist provider', () => {
    const context = mocks.state.principal.context;
    mocks.state.hostExecution = {
      connection: context,
      context: { enabledProviderIds: ['grok', 'droid'] },
    };
    mocks.state.agentAvailability = {
      providerStatusMap: { grok: { available: true }, droid: { available: true } },
    };
    expect(selectAvailableEnabledProviderIds.select(mocks.state)).toEqual(['grok', 'droid']);
  });
});
