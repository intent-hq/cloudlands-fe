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
  checkPiMcpAdapterInstalled: vi.fn(),
  installPiMcpAdapter: vi.fn(),
  state: { current: {} as any },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  shell: { open: mocks.shellOpen },
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { get: vi.fn().mockResolvedValue({ value: {} }) } },
}));

vi.mock('$features/pi/pi-models.client', () => ({
  checkPiMcpAdapterInstalled: mocks.checkPiMcpAdapterInstalled,
  installPiMcpAdapter: mocks.installPiMcpAdapter,
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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
      enabledProviders: { auggie: true },
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
      npxStatus,
    },
  };
}

warmImport(() => import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('./ProviderSelector.svelte'));

describe('ProviderSelector progressive rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkPiMcpAdapterInstalled.mockResolvedValue(true);
    mocks.installPiMcpAdapter.mockResolvedValue({ success: true });
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

    expect(
      result.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent?.trim()),
    ).toEqual(['Enabled', 'Supported']);
    expect(result.queryByRole('heading', { name: 'Discovered' })).toBeNull();

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

    const groupHeadings = result.getAllByRole('heading', { level: 3 });
    expect(groupHeadings.map((heading) => heading.textContent?.trim())).toEqual([
      'Enabled',
      'Discovered',
      'Supported',
    ]);
    const discoveredText = groupHeadings[1]?.closest('section')?.textContent ?? '';
    expect(discoveredText.indexOf('OpenAI Codex')).toBeLessThan(discoveredText.indexOf('OpenCode'));

    // Codex settled → inline enable action; login status/actions stay in menus.
    await waitFor(() => {
      expect(result.getByRole('button', { name: 'Enable' })).toBeTruthy();
    });
    const enableButton = result.getByRole('button', { name: 'Enable' });
    expect(enableButton.className).toContain('text-secondary-foreground');
    expect(enableButton.className).not.toContain('bg-primary');
    expect(result.queryByText('Logged in')).toBeNull();

    await fireEvent.click(enableButton);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/setProviderEnabled',
        payload: [{ providerId: 'codex', enabled: true }],
      }),
    );

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
    );
    expect(result.getByRole('menuitem', { name: 'Logged in' })).toBeTruthy();
    expect(result.queryByRole('menuitem', { name: 'Enable' })).toBeNull();

    await fireEvent.click(result.getByRole('button', { name: 'Provider actions for OpenCode' }));
    expect(result.getByRole('menuitem', { name: 'Log in' })).toBeTruthy();
    // Providers whose probe has not landed keep a per-row pending indicator.
    expect(result.getAllByLabelText('Loading…').length).toBeGreaterThan(0);
  });

  it('mutes a provider name once its probe settles as unavailable', async () => {
    mocks.state.current = await buildState({
      'claude-code': { available: false },
    });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);

    const providerName = result.getByText('Anthropic Claude Code');
    expect(providerName.className).toContain('text-muted-foreground');
    expect(providerName.className).toContain('opacity-60');
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

  it('moves the Pi adapter warning and install action into the overflow menu', async () => {
    mocks.checkPiMcpAdapterInstalled.mockResolvedValue(false);
    mocks.state.current = await buildState({ pi: { available: true } });
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    const warning = 'Pi needs the pi-mcp-adapter package to use workspace tools';

    await waitFor(() => {
      expect(result.getByRole('img', { name: warning })).toBeTruthy();
    });
    expect(result.queryByText(warning)).toBeNull();

    await fireEvent.click(result.getByRole('button', { name: 'Provider actions for Pi' }));
    expect(result.getByText(warning)).toBeTruthy();
    await fireEvent.click(result.getByRole('menuitem', { name: 'Install' }));
    expect(mocks.installPiMcpAdapter).toHaveBeenCalledOnce();
  });
});
