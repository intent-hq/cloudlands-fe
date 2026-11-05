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

const cursorStatus = { available: true, authenticated: true };

async function buildState({ lab, cursorEnabled }: { lab: boolean; cursorEnabled: boolean }) {
  const { initialState: setupInitialState } =
    await import('$store/renderer/slices/antigravity-setup/antigravity-setup-slice');
  const { initialState: specialistsInitialState } =
    await import('$store/renderer/slices/specialists/specialists-slice');
  const { initialState: modelInitialState } =
    await import('$store/renderer/slices/model/model-slice');
  const { initialState: providerSettingsInitialState } =
    await import('$store/renderer/slices/provider-settings/provider-settings-slice');
  const { initialState: availabilityInitialState } =
    await import('$store/renderer/slices/agent-availability/agent-availability-slice');
  const { initialState: userPreferencesInitialState } =
    await import('$store/renderer/slices/user-preferences/user-preferences-slice');
  const {
    initialState: providerCatalogInitialState,
    providerCatalogLoaded,
    providerCatalogReducer,
  } = await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_CURSOR_PROVIDER, MOCK_PROVIDER_CATALOG } =
    await import('../../../test/fixtures/provider-catalog.fixture');
  const { initialState: daemonHealthInitialState } =
    await import('$store/renderer/slices/daemon-health/daemon-health-slice');
  return {
    daemonHealth: { ...daemonHealthInitialState },
    antigravitySetup: { ...setupInitialState },
    providerCatalog: providerCatalogReducer(
      providerCatalogInitialState,
      providerCatalogLoaded({
        providers: [...MOCK_PROVIDER_CATALOG.providers, MOCK_CURSOR_PROVIDER],
      }),
    ),
    providerSettings: {
      ...providerSettingsInitialState,
      enabledProviders: { codex: true, cursor: cursorEnabled },
      nonDisableableProviderIds: [],
    },
    userPreferences: { ...userPreferencesInitialState, labsCursorProviderEnabled: lab },
    model: { ...modelInitialState, defaultProviderId: 'codex', providerModels: {} },
    specialists: { ...specialistsInitialState },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
    agentAvailability: {
      ...availabilityInitialState,
      providerStatusMap: {
        codex: { available: true, authenticated: true },
        cursor: cursorStatus,
      },
      providerLoadingMap: { codex: false, cursor: false },
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: true,
      watchedTerminalIds: [],
      npxStatus: null,
    },
  };
}

const unavailable = { available: false };
const availability = {
  hasAnyProvider: true,
  providers: {
    auggie: unavailable,
    claudeCode: unavailable,
    codex: { available: true, authenticated: true },
    cortex: unavailable,
    mock: unavailable,
    opencode: unavailable,
    pi: unavailable,
    droid: unavailable,
    grok: unavailable,
    unsloth: unavailable,
    cursor: cursorStatus,
  },
  hiddenProviders: ['mock'],
};

warmImport(() => import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('./ProviderSelector.svelte'));

const CURSOR_ACTIONS = 'Provider actions for Cursor';

describe('ProviderSelector Cursor Labs gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return { success: true, data: availability };
      }
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { paths: {}, secondaryPaths: {} } };
      }
      return { success: true, data: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  async function renderSelector(options: { lab: boolean; cursorEnabled: boolean }) {
    mocks.state.current = await buildState(options);
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    await waitFor(() => {
      expect(
        result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
      ).toBeTruthy();
    });
    return result;
  }

  it('shows no Cursor row while the lab is off and Cursor is not enabled', async () => {
    const result = await renderSelector({ lab: false, cursorEnabled: false });
    expect(result.queryByRole('button', { name: CURSOR_ACTIONS })).toBeNull();
    expect(result.queryByText('Cursor')).toBeNull();
  });

  it('offers an installed Cursor row under Discovered while the lab is on', async () => {
    const result = await renderSelector({ lab: true, cursorEnabled: false });
    const discovered = result.getByRole('region', {
      name: m.settings_providers_groupDiscovered_label(),
    });
    expect(within(discovered).getByRole('button', { name: CURSOR_ACTIONS })).toBeTruthy();
    expect(within(discovered).getByRole('img', { name: 'Cursor' })).toBeTruthy();
  });

  it('keeps an enabled Cursor row and its Disable action when the lab is off', async () => {
    const result = await renderSelector({ lab: false, cursorEnabled: true });
    const enabledGroup = result.getByRole('region', {
      name: m.settings_providers_groupEnabled_label(),
    });
    await fireEvent.click(within(enabledGroup).getByRole('button', { name: CURSOR_ACTIONS }));
    const disable = (await waitFor(() =>
      result.getByRole('menuitem', { name: 'Disable' }),
    )) as HTMLButtonElement;
    expect(disable.getAttribute('aria-disabled')).not.toBe('true');
    mocks.dispatch.mockClear();
    await fireEvent.click(disable);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/setProviderEnabled',
        payload: [
          { providerId: 'cursor', enabled: false },
          { id: expect.any(String), sessionId: expect.any(String) },
        ],
      }),
    );
  });
});
