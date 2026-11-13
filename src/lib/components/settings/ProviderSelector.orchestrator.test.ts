/**
 * Settings → Providers against an orchestrator (PROTOCOL `provider-profiles.md`
 * → "Profiles on an orchestrator"). The orchestrator runs no provider CLI, so
 * `host.providerDiscovery` reports nothing installed: its rows still offer
 * enable / disable and profiles, with no install, sign-in, path or recheck
 * action and no "Not Detected" group. A Full daemon with the same empty
 * discovery keeps today's install guidance.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
  shellOpen: vi.fn(),
  state: { current: {} as any },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  shell: { open: mocks.shellOpen },
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { get: vi.fn().mockResolvedValue({ value: {} }) } },
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

/** Every probe settled with nothing installed, as an orchestrator answers. */
async function buildState(daemonMode: 'orchestrator' | 'regular') {
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
  const { MOCK_PROVIDER_CATALOG } = await import('../../../test/fixtures/provider-catalog.fixture');
  const { withBackendDaemonMode, withLegacyPrincipal } =
    await import('../../../test/fixtures/principal-state');
  const catalog = {
    ...MOCK_PROVIDER_CATALOG,
    providers: MOCK_PROVIDER_CATALOG.providers.map((entry) =>
      entry.id === 'claude-code'
        ? { ...entry, supportsProfiles: true, supportsTestPrompt: daemonMode !== 'orchestrator' }
        : entry,
    ),
  };
  const providerLoadingMap: Record<string, boolean> = {};
  for (const entry of catalog.providers) providerLoadingMap[entry.id] = false;
  const state = withLegacyPrincipal({
    providerCatalog: providerCatalogReducer(
      providerCatalogInitialState,
      providerCatalogLoaded(catalog),
    ),
    providerSettings: {
      ...providerSettingsInitialState,
      activeProviderId: 'auggie',
      enabledProviders: { codex: true },
      defaultProviderId: catalog.defaultProviderId,
      nonDisableableProviderIds: [],
    },
    model: { ...modelInitialState, providerModels: {} },
    specialists: { ...specialistsInitialState },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
    agentAvailability: {
      ...availabilityInitialState,
      // `host.providerDiscovery` → `{ providers: [] }`: nothing reported installed.
      providerStatusMap: {},
      providerLoadingMap,
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: true,
      watchedTerminalIds: [],
      npxStatus: null,
    },
  });
  return withBackendDaemonMode(state, daemonMode);
}

warmImport(() => import('./ProviderSelector.svelte'));

const CLAUDE_ACTIONS = 'Provider actions for Anthropic Claude Code';

describe('ProviderSelector on an orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_PATHS)
        return { success: true, data: { paths: {}, secondaryPaths: {} } };
      return { success: true, data: {} };
    });
  });

  afterEach(() => cleanup());

  it('lets a provider be enabled without any install or sign-in check', async () => {
    mocks.state.current = await buildState('orchestrator');
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    expect(result.getByTestId('providers-orchestrator-note')).toBeTruthy();
    // Nothing waits on a probe and nothing reads as missing.
    expect(result.queryAllByLabelText('Loading…')).toHaveLength(0);
    expect(result.queryByRole('heading', { name: 'Not Detected' })).toBeNull();

    const enable = result.getAllByRole('button', { name: 'Enable' });
    expect(enable.length).toBeGreaterThan(0);
    await fireEvent.click(enable[0]);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'providerSettings/setProviderEnabled' }),
    );
  });

  it('keeps profiles and drops install, path, sign-in and recheck actions', async () => {
    mocks.state.current = await buildState('orchestrator');
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    await fireEvent.click(result.getByRole('button', { name: CLAUDE_ACTIONS }));
    expect(result.getByRole('menuitem', { name: 'Add profile' })).toBeTruthy();
    for (const name of ['Install', 'Set custom path', 'Log in', 'Recheck'])
      expect(result.queryByRole('menuitem', { name })).toBeNull();
  });

  it('keeps install guidance on a Full daemon that finds no CLI', async () => {
    mocks.state.current = await buildState('regular');
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    expect(result.queryByTestId('providers-orchestrator-note')).toBeNull();
    expect(result.getByRole('heading', { name: 'Not Detected' })).toBeTruthy();
    await fireEvent.click(result.getByRole('button', { name: CLAUDE_ACTIONS }));
    expect(result.getByRole('menuitem', { name: 'Install' })).toBeTruthy();
    // Profiles need an installed CLI on a Full daemon.
    expect(result.queryByRole('menuitem', { name: 'Add profile' })).toBeNull();
    expect(result.getByRole('menuitem', { name: 'Set custom path' })).toBeTruthy();
  });
});
