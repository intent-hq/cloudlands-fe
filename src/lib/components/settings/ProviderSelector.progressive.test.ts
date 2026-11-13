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
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
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

/** State with the catalog hydrated and every provider probe still in flight. */
async function buildState(
  providerStatusMap: Record<
    string,
    {
      available: boolean;
      authenticated?: boolean;
      hasNpxFallback?: boolean;
      warning?: string;
    }
  >,
  npxStatus: { resolvedPath: string | null; versionOk: boolean | null } | null = null,
  enabledProviders: Record<string, boolean> = { auggie: true },
) {
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
      ...providerSettingsInitialState,
      activeProviderId: 'auggie',
      enabledProviders,
      defaultProviderId: MOCK_PROVIDER_CATALOG.defaultProviderId,
      nonDisableableProviderIds: [],
    },
    model: { ...modelInitialState, providerModels: {} },
    specialists: { ...specialistsInitialState },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
    agentAvailability: {
      ...availabilityInitialState,
      providerStatusMap,
      providerLoadingMap,
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: false,
      watchedTerminalIds: [],
      npxStatus,
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
    mocks.state.current = await buildState({}, null, { codex: true });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    expect(
      result.getByRole('button', { name: 'Provider actions for Anthropic Claude Code' }),
    ).toBeTruthy();
    expect(result.queryByText('Mock (E2E)')).toBeNull();

    expect(result.queryByTitle('Configure Anthropic Claude Code path')).toBeNull();
    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for Anthropic Claude Code' }),
    );
    await fireEvent.click(result.getByRole('menuitem', { name: 'Set custom path' }));
    await waitFor(() => {
      expect(result.getByText('Anthropic Claude Code CLI Path')).toBeTruthy();
    });
  });

  it('shows a settled row while a slower row is still pending', async () => {
    mocks.state.current = await buildState({
      codex: { available: true, authenticated: true },
      opencode: { available: true, authenticated: false },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    // Codex settled → inline enable action; login status/actions stay in menus.
    await waitFor(() => {
      expect(result.getByRole('button', { name: 'Enable' })).toBeTruthy();
    });
    const enableButton = result.getByRole('button', { name: 'Enable' });
    expect(result.queryByText('Logged in')).toBeNull();

    await fireEvent.click(enableButton);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/setProviderEnabled',
        payload: [
          { providerId: 'codex', enabled: true },
          { id: expect.any(String), sessionId: expect.any(String) },
        ],
      }),
    );

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
    );
    expect(result.getByText('Logged in').getAttribute('role')).toBe('status');
    expect(result.queryByRole('menuitem', { name: 'Logged in' })).toBeNull();
    expect(result.queryByRole('menuitem', { name: 'Enable' })).toBeNull();

    await fireEvent.click(result.getByRole('button', { name: 'Provider actions for OpenCode' }));
    expect(result.getByRole('menuitem', { name: 'Log in' })).toBeTruthy();
    // Providers whose probe has not landed keep a per-row pending indicator.
    expect(result.getAllByLabelText('Loading…').length).toBeGreaterThan(0);
  });

  it('shows provider warning details and the Node.js action only in the overflow menu', async () => {
    const warning = 'npx not found — install Node.js (with npm) to use Claude Code';
    mocks.state.current = await buildState({
      'claude-code': { available: false, warning },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    expect(result.getByRole('img', { name: warning })).toBeTruthy();
    expect(result.queryByText(warning)).toBeNull();

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for Anthropic Claude Code' }),
    );
    expect(result.getByText(warning)).toBeTruthy();
    await fireEvent.click(result.getByRole('menuitem', { name: 'install from nodejs.org' }));
    expect(mocks.shellOpen).toHaveBeenCalledWith('https://nodejs.org');
  });

  it('moves the missing Node.js warning and action into the overflow menu', async () => {
    mocks.state.current = await buildState(
      { codex: { available: false, hasNpxFallback: true } },
      { resolvedPath: null, versionOk: null },
    );
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    expect(result.getByRole('img', { name: 'Requires Node.js (npx) —' })).toBeTruthy();
    expect(result.queryByText('Requires Node.js (npx) —')).toBeNull();

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
    );
    expect(result.getByText('Requires Node.js (npx) —')).toBeTruthy();
    expect(result.getByRole('menuitem', { name: 'install from nodejs.org' })).toBeTruthy();
  });

  it('moves the old npm warning text into the overflow menu', async () => {
    mocks.state.current = await buildState(
      { codex: { available: false, hasNpxFallback: true } },
      { resolvedPath: '/usr/local/bin/npx', versionOk: false },
    );
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    expect(result.getByRole('img', { name: 'npm/npx too old — npm 7+ required' })).toBeTruthy();
    expect(result.queryByText('npm/npx too old — npm 7+ required')).toBeNull();

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
    );
    expect(result.getByText('npm/npx too old — npm 7+ required')).toBeTruthy();
  });

  it('runs the catalog login command in a terminal from Log in', async () => {
    // auggie carries loginCommandHint ('auggie login') in the catalog fixture.
    mocks.state.current = await buildState({
      auggie: { available: true, authenticated: false },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for Augment Auggie' }),
    );
    await fireEvent.click(result.getByRole('menuitem', { name: 'Log in' }));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agentAvailability/providerLoginRequested',
        payload: ['auggie'],
      }),
    );
    expect(mocks.shellOpen).not.toHaveBeenCalled();
  });

  it('falls back to the docs-link Log in action when the catalog has no hint', async () => {
    // opencode has loginDocsUrl but no loginCommandHint in the fixture.
    mocks.state.current = await buildState({
      opencode: { available: true, authenticated: false },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    await fireEvent.click(result.getByRole('button', { name: 'Provider actions for OpenCode' }));
    await fireEvent.click(result.getByRole('menuitem', { name: 'Log in' }));
    expect(mocks.shellOpen).toHaveBeenCalledWith('https://opencode.ai/docs#configure');
  });

  it('dispatches a forced single-provider recheck from the Recheck action', async () => {
    mocks.state.current = await buildState({
      auggie: { available: true, authenticated: false },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for Augment Auggie' }),
    );
    await fireEvent.click(result.getByRole('menuitem', { name: 'Recheck' }));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agentAvailability/checkSingleProviderRequested',
        payload: ['auggie'],
      }),
    );
  });
});

describe('ProviderSelector model refresh rewire (intent-hq/intent#3966)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('requests an availability check with model refresh intent when retrying', async () => {
    // Mount fails the aggregated check (surfacing Try Again); the retry succeeds.
    let availabilityCalls = 0;
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        availabilityCalls += 1;
        if (availabilityCalls === 1) return { success: false, error: 'availability check failed' };
        return { success: true, data: { hasAnyProvider: true, providers: {} } };
      }
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { paths: {}, secondaryPaths: {} } };
      }
      return { success: true, data: {} };
    });
    mocks.state.current = await buildState({});
    mocks.state.current.agentAvailability.discoveryError = 'availability check failed';
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    const tryAgain = await result.findByRole('button', { name: 'Try Again' });
    // The mount-time check does not refresh models.
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'model/reloadModelsForProvider' }),
    );

    await fireEvent.click(tryAgain);

    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agentAvailability/checkAllProvidersRequested',
          payload: [true],
        }),
      );
    });
  });

  it('offers no Set as default in the provider actions menu', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) return new Promise(() => {});
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { paths: {}, secondaryPaths: {} } };
      }
      return { success: true, data: {} };
    });
    mocks.state.current = await buildState({
      codex: { available: true, authenticated: true },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
    );
    expect(await result.findAllByRole('menuitem')).not.toHaveLength(0);
    expect(result.queryByRole('menuitem', { name: /default/i })).toBeNull();
  });
});
