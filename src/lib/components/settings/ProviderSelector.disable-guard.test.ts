/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import { warmImport } from '../../../test/warm-import';
import { providerProfilesRequested } from '$store/renderer/slices/provider-settings/provider-settings-slice';

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

async function buildState(fileSpecialists: object[]) {
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
  const { createCollection } = await import('@themislib/themis/utils/collections/collection-utils');
  const {
    initialState: providerCatalogInitialState,
    providerCatalogLoaded,
    providerCatalogReducer,
  } = await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } = await import('../../../test/fixtures/provider-catalog.fixture');
  return {
    antigravitySetup: { ...setupInitialState },
    providerCatalog: providerCatalogReducer(
      providerCatalogInitialState,
      providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
    ),
    providerSettings: {
      ...providerSettingsInitialState,
      enabledProviders: { 'claude-code': true, codex: true },
      nonDisableableProviderIds: [],
    },
    model: { ...modelInitialState, defaultProviderId: 'auggie', providerModels: {} },
    specialists: {
      ...specialistsInitialState,
      fileSpecialists: createCollection('id', fileSpecialists as never[]),
    },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
    agentAvailability: {
      ...availabilityInitialState,
      providerStatusMap: {
        auggie: { available: true, authenticated: true },
        'claude-code': { available: true, authenticated: true },
        codex: { available: true, authenticated: true },
      },
      providerLoadingMap: { auggie: false, 'claude-code': false, codex: false },
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: true,
      watchedTerminalIds: [],
      npxStatus: null,
    },
  };
}

const providerStatus = { available: true, authenticated: true };
const availability = {
  hasAnyProvider: true,
  providers: {
    auggie: providerStatus,
    claudeCode: providerStatus,
    codex: providerStatus,
    cortex: { available: false },
    mock: { available: false },
    opencode: { available: false },
    pi: { available: false },
    droid: { available: false },
    grok: { available: false },
  },
  hiddenProviders: ['mock', 'cortex', 'opencode', 'pi', 'droid', 'grok'],
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('./ProviderSelector.svelte'));

describe('ProviderSelector disable guard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.state.current = await buildState([
      {
        id: 'my-spec',
        name: 'My Spec',
        description: 'test',
        codingAgent: 'claude-code',
        model: '',
        behaviorPrompt: 'prompt',
        filePath: '/tmp/my-spec.md',
        source: 'user',
      },
    ]);
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

  async function renderSelector() {
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    await waitFor(() => {
      expect(
        result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
      ).toBeTruthy();
    });
    return result;
  }

  async function getDisableButton(
    result: Awaited<ReturnType<typeof renderSelector>>,
    providerName: string,
  ) {
    await fireEvent.click(
      result.getByRole('button', { name: `Provider actions for ${providerName}` }),
    );
    return await waitFor(() => result.getByRole('menuitem', { name: 'Disable' }));
  }

  it('disables the Disable control for an in-use provider with a reason', async () => {
    const result = await renderSelector();
    const claudeButton = (await getDisableButton(
      result,
      'Anthropic Claude Code',
    )) as HTMLButtonElement;
    expect(claudeButton.getAttribute('aria-disabled')).toBe('true');
    expect(claudeButton.getAttribute('title')).toBeTruthy();
    mocks.dispatch.mockClear();
    await fireEvent.click(claudeButton);
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await fireEvent.click(
      result.getByRole('button', { name: 'Provider actions for Anthropic Claude Code' }),
    );
    const codexButton = (await getDisableButton(result, 'OpenAI Codex')) as HTMLButtonElement;
    expect(codexButton.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('still dispatches setProviderEnabled(false) for providers not in use', async () => {
    const result = await renderSelector();
    const codexButton = await getDisableButton(result, 'OpenAI Codex');
    await fireEvent.click(codexButton);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/setProviderEnabled',
        payload: [
          { providerId: 'codex', enabled: false },
          { id: expect.any(String), sessionId: expect.any(String) },
        ],
      }),
    );
  });

  it('blocks disabling an in-use provider even if the click fires', async () => {
    const result = await renderSelector();
    const claudeButton = await getDisableButton(result, 'Anthropic Claude Code');
    await fireEvent.click(claudeButton);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'providerSettings/setProviderEnabled' }),
    );
  });

  it('opens and closes a saga-owned availability panel session', async () => {
    await renderSelector();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agentAvailability/panelOpened',
        payload: [expect.any(String)],
      }),
    );
    const opened = mocks.dispatch.mock.calls.find(
      ([action]) => action.type === 'agentAvailability/panelOpened',
    )![0];
    cleanup();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agentAvailability/panelClosed', payload: opened.payload }),
    );
  });
});

describe('ProviderSelector does not label the app default provider', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows no Default label on an unavailable default provider', async () => {
    const base = await buildState([]);
    mocks.state.current = {
      ...base,
      providerSettings: {
        enabledProviders: { 'claude-code': true, codex: true },
      },
      model: { ...base.model, defaultProviderId: 'codex' },
      agentAvailability: {
        ...base.agentAvailability,
        providerStatusMap: {
          ...base.agentAvailability.providerStatusMap,
          codex: { available: false },
        },
      },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return {
          success: true,
          data: {
            ...availability,
            providers: { ...availability.providers, codex: { available: false } },
          },
        };
      }
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return {
          success: true,
          data: {
            paths: { auggie: null, 'claude-code': null, codex: null },
            secondaryPaths: {},
          },
        };
      }
      return { success: true, data: {} };
    });

    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    await waitFor(() => {
      expect(result.getAllByRole('button', { name: /^Provider actions for / })).not.toHaveLength(0);
    });
    expect(result.queryByText(/^Default/)).toBeNull();
  });

  it('shows no Default label on unavailable Auggie as the default provider', async () => {
    const base = await buildState([]);
    mocks.state.current = {
      ...base,
      providerSettings: {
        enabledProviders: { 'claude-code': true, codex: true },
      },
      model: { ...base.model, defaultProviderId: 'auggie' },
      agentAvailability: {
        ...base.agentAvailability,
        providerStatusMap: {
          ...base.agentAvailability.providerStatusMap,
          auggie: { available: false },
        },
      },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return { success: true, data: availability };
      }
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return {
          success: true,
          data: {
            paths: { auggie: null, 'claude-code': null, codex: null },
            secondaryPaths: {},
          },
        };
      }
      return { success: true, data: {} };
    });

    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    await waitFor(() => {
      expect(result.getAllByRole('button', { name: /^Provider actions for / })).not.toHaveLength(0);
    });
    expect(result.queryByText(/^Default/)).toBeNull();
  });
});

describe('ProviderSelector profiles entry point', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY)
        return { success: true, data: availability };
      if (channel === PROVIDERS_CHANNELS.GET_PATHS)
        return { success: true, data: { paths: {}, secondaryPaths: {} } };
      return { success: true, data: {} };
    });
  });
  afterEach(() => cleanup());

  async function renderWithCatalog(supportsProfiles: Record<string, boolean>) {
    const state = await buildState([]);
    const { MOCK_PROVIDER_CATALOG } =
      await import('../../../test/fixtures/provider-catalog.fixture');
    const { providerCatalogLoaded, providerCatalogReducer, initialState } =
      await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
    state.providerCatalog = providerCatalogReducer(
      initialState,
      providerCatalogLoaded({
        providers: MOCK_PROVIDER_CATALOG.providers.map((row) =>
          row.id in supportsProfiles ? { ...row, supportsProfiles: supportsProfiles[row.id] } : row,
        ),
      }),
    );
    mocks.state.current = state;
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    await waitFor(() =>
      expect(
        result.getByRole('button', { name: 'Provider actions for OpenAI Codex' }),
      ).toBeTruthy(),
    );
    return result;
  }

  async function openProviderMenu(result: ReturnType<typeof render>, providerName: string) {
    await fireEvent.click(
      result.getByRole('button', { name: `Provider actions for ${providerName}` }),
    );
    return await waitFor(() => result.getByRole('menu'));
  }

  it('offers Add profile on no provider when the catalog does not advertise profiles', async () => {
    const result = await renderWithCatalog({});
    const menu = await openProviderMenu(result, 'OpenAI Codex');
    expect(
      within(menu).queryByRole('menuitem', { name: m.settings_providerProfiles_add_label() }),
    ).toBeNull();
  });

  it('offers Add profile in the actions menu only on providers whose catalog row supports profiles', async () => {
    const result = await renderWithCatalog({ codex: true, 'claude-code': false });
    const codexMenu = await openProviderMenu(result, 'OpenAI Codex');
    expect(
      within(codexMenu).getByRole('menuitem', { name: m.settings_providerProfiles_add_label() }),
    ).toBeTruthy();
    await fireEvent.keyDown(codexMenu, { key: 'Escape' });
    await waitFor(() => expect(result.queryByRole('menu')).toBeNull());
    const claudeMenu = await openProviderMenu(result, 'Anthropic Claude Code');
    expect(
      within(claudeMenu).queryByRole('menuitem', { name: m.settings_providerProfiles_add_label() }),
    ).toBeNull();
    // No standalone Add profile button and no empty profile block without profiles.
    expect(
      result.queryByRole('button', { name: m.settings_providerProfiles_add_label() }),
    ).toBeNull();
    expect(result.queryByTestId('provider-profiles-codex')).toBeNull();
  });

  it('offers Environment variables for the Default only on profile-capable providers', async () => {
    const result = await renderWithCatalog({ codex: true, 'claude-code': false });
    const codexMenu = await openProviderMenu(result, 'OpenAI Codex');
    await fireEvent.click(
      within(codexMenu).getByRole('menuitem', { name: m.settings_providerDefault_menu_label() }),
    );
    const dialog = await waitFor(() => result.getByRole('dialog'));
    expect(
      within(dialog).getByText(
        m.settings_providerDefault_title_label({ provider: 'OpenAI Codex' }),
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByTestId('provider-profile-backup')).toBeNull();
    await fireEvent.click(
      within(dialog).getByRole('button', { name: m.modals_bulkActionConfirm_cancel_label() }),
    );
    await waitFor(() => expect(result.queryByRole('dialog')).toBeNull());
    const claudeMenu = await openProviderMenu(result, 'Anthropic Claude Code');
    expect(
      within(claudeMenu).queryByRole('menuitem', { name: m.settings_providerDefault_menu_label() }),
    ).toBeNull();
  });

  it('opens the add-profile dialog from the provider actions menu', async () => {
    const result = await renderWithCatalog({ codex: true });
    const menu = await openProviderMenu(result, 'OpenAI Codex');
    await fireEvent.click(
      within(menu).getByRole('menuitem', { name: m.settings_providerProfiles_add_label() }),
    );
    const dialog = await waitFor(() => result.getByRole('dialog'));
    expect(
      within(dialog).getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    ).toBeTruthy();
  });

  it('keeps a half-filled add-profile dialog open when the provider row re-renders', async () => {
    const result = await renderWithCatalog({ codex: true });
    const menu = await openProviderMenu(result, 'OpenAI Codex');
    await fireEvent.click(
      within(menu).getByRole('menuitem', { name: m.settings_providerProfiles_add_label() }),
    );
    const dialog = await waitFor(() => result.getByRole('dialog'));
    const name = within(dialog).getByLabelText(m.settings_providerProfiles_name_label(), {
      selector: 'input[required]',
    }) as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Work' } });

    // The row stops offering profiles (catalog refresh): its profile list
    // unmounts, but the page-level dialog and its draft must survive.
    const { MOCK_PROVIDER_CATALOG } =
      await import('../../../test/fixtures/provider-catalog.fixture');
    const { providerCatalogLoaded, providerCatalogReducer, initialState } =
      await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
    mocks.state.current = {
      ...(mocks.state.current as object),
      providerCatalog: providerCatalogReducer(
        initialState,
        providerCatalogLoaded({ providers: MOCK_PROVIDER_CATALOG.providers }),
      ),
    };
    const { store } = await import('$store/renderer/store');
    (store as unknown as { emitState: () => void }).emitState();
    await waitFor(() => expect(result.queryByTestId('provider-profiles-codex')).toBeNull());
    expect(result.getByRole('dialog')).toBe(dialog);
    expect(name.value).toBe('Work');
  });

  it('requests saved profiles without any Labs opt-in when a provider supports them', async () => {
    await renderWithCatalog({ codex: true });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: providerProfilesRequested.type }),
    );
  });

  it('skips the profile read when no provider supports profiles', async () => {
    await renderWithCatalog({});
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: providerProfilesRequested.type }),
    );
  });
});
