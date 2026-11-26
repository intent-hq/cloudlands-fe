/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
  toastError: vi.fn(),
  state: { current: {} as unknown },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  shell: { open: vi.fn() },
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { get: vi.fn().mockResolvedValue({ value: {} }) } },
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock('./ProviderPathConfig.svelte', async () => ({
  default: (await import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

const dshSignedOut = { available: true, authenticated: false, version: '0.2.2-rc.5' };

async function buildState() {
  const { initialState: specialistsInitialState } =
    await import('$store/renderer/slices/specialists/specialists-slice');
  const { initialState: modelInitialState } =
    await import('$store/renderer/slices/model/model-slice');
  const { initialState: providerSettingsInitialState } =
    await import('$store/renderer/slices/provider-settings/provider-settings-slice');
  const { initialState: availabilityInitialState } =
    await import('$store/renderer/slices/agent-availability/agent-availability-slice');
  const {
    initialState: providerCatalogInitialState,
    providerCatalogLoaded,
    providerCatalogReducer,
  } = await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_DSH_PROVIDER, MOCK_PROVIDER_CATALOG } =
    await import('../../../test/fixtures/provider-catalog.fixture');
  const { initialState: daemonHealthInitialState } =
    await import('$store/renderer/slices/daemon-health/daemon-health-slice');
  return {
    daemonHealth: { ...daemonHealthInitialState },
    providerCatalog: providerCatalogReducer(
      providerCatalogInitialState,
      providerCatalogLoaded({
        providers: [
          ...MOCK_PROVIDER_CATALOG.providers,
          { ...MOCK_DSH_PROVIDER, supportsProfiles: true },
        ],
      }),
    ),
    providerSettings: {
      ...providerSettingsInitialState,
      enabledProviders: { codex: true },
      nonDisableableProviderIds: [],
    },
    model: { ...modelInitialState, defaultProviderId: 'codex', providerModels: {} },
    specialists: { ...specialistsInitialState },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
    agentAvailability: {
      ...availabilityInitialState,
      providerStatusMap: {
        codex: { available: true, authenticated: true },
        dsh: dshSignedOut,
      },
      providerLoadingMap: { codex: false, dsh: false },
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: true,
      watchedTerminalIds: [],
      npxStatus: null,
    },
  };
}

warmImport(() => import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('./ProviderSelector.svelte'));

describe('ProviderSelector DeepSeek Harness row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { paths: {}, secondaryPaths: {} } };
      }
      return { success: true, data: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('offers Add API key instead of Log in while DSH is signed out', async () => {
    mocks.state.current = await buildState();
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    const trigger = await waitFor(() =>
      result.getByRole('button', { name: 'Provider actions for DeepSeek Harness' }),
    );
    await fireEvent.click(trigger);
    const menu = await waitFor(() => result.getByRole('menu'));
    expect(
      within(menu).getByRole('menuitem', { name: m.settings_providers_addApiKey_label() }),
    ).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: m.settings_providers_logIn() })).toBeNull();
  });
});
