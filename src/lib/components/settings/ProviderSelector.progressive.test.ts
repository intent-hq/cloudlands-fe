/**
 * Progressive rendering of the Settings → AI Coding CLIs list.
 *
 * Rows come straight from the provider catalog and must be on screen before
 * any availability probe settles; each row's status area then fills in from
 * the shared agent-availability slice as ITS own probe lands, so a slow
 * provider never holds back a fast one.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
  state: { current: {} as any },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  shell: { open: vi.fn() },
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { get: vi.fn().mockResolvedValue({ value: {} }) } },
}));

vi.mock('$features/pi/pi-models.client', () => ({
  checkPiMcpAdapterInstalled: vi.fn().mockResolvedValue(true),
  installPiMcpAdapter: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

/** State with the catalog hydrated and every provider probe still in flight. */
async function buildState(
  providerStatusMap: Record<string, { available: boolean; authenticated?: boolean }>,
) {
  const { initialState: specialistsInitialState } =
    await import('$store/renderer/slices/specialists/specialists-slice');
  const { initialState: modelInitialState } =
    await import('$store/renderer/slices/model/model-slice');
  const {
    initialState: providerCatalogInitialState,
    providerCatalogLoaded,
    providerCatalogReducer,
  } = await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } = await import('../../../test/fixtures/provider-catalog.fixture');
  const providerLoadingMap: Record<string, boolean> = {};
  for (const entry of MOCK_PROVIDER_CATALOG.providers) {
    providerLoadingMap[entry.id] = providerStatusMap[entry.id] === undefined;
  }
  return {
    providerCatalog: providerCatalogReducer(
      providerCatalogInitialState,
      providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
    ),
    providerSettings: {
      activeProviderId: 'auggie',
      enabledProviders: {},
      defaultProviderId: MOCK_PROVIDER_CATALOG.defaultProviderId,
      nonDisableableProviderIds: [],
    },
    model: { ...modelInitialState, providerModels: {} },
    specialists: { ...specialistsInitialState },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
    agentAvailability: {
      providerStatusMap,
      providerLoadingMap,
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: false,
      watchedTerminalIds: [],
      npxStatus: null,
    },
  };
}

warmImport(() => import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('./ProviderSelector.svelte'));

describe('ProviderSelector progressive rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The aggregated GET_AVAILABILITY never settles: rows must not wait on it.
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === AUGGIE_CHANNELS.STATUS) return new Promise(() => {});
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) return new Promise(() => {});
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { paths: {}, secondaryPaths: {} } };
      }
      return { success: true, data: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders catalog rows immediately while every probe is still in flight', async () => {
    mocks.state.current = await buildState({});
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    // Visible catalog rows are on screen without any probe having settled;
    // gated rows (mock, cortex) stay hidden via the catalog's own verdict.
    for (const name of ['Augment Auggie', 'Anthropic Claude Code', 'OpenAI Codex', 'Grok Build']) {
      expect(result.getByText(name)).toBeTruthy();
    }
    expect(result.queryByText('Mock (E2E)')).toBeNull();
    expect(result.queryByText('Snowflake Cortex')).toBeNull();
  });

  it('shows a settled row while a slower row is still pending', async () => {
    mocks.state.current = await buildState({
      codex: { available: true, authenticated: true },
      opencode: { available: true, authenticated: false },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    // Codex settled → terminal status; OpenCode settled → its login CTA.
    await waitFor(() => {
      expect(result.getByText('Logged in')).toBeTruthy();
    });
    expect(result.getByText('Log in')).toBeTruthy();
    // Providers whose probe has not landed keep a per-row pending indicator.
    expect(result.getAllByLabelText('Loading…').length).toBeGreaterThan(0);
  });
});
