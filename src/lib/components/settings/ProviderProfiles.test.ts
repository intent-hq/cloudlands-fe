/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import type { ProviderProfile } from '$shared/provider-profiles';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
  reducers: {} as Record<string, (state: unknown, action: unknown) => unknown>,
  dispatched: [] as Array<{ type: string; payload: unknown }>,
  emit: { current: () => {} },
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  confirm: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock, createStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const appStore = createAppStoreMock({
    state: () => mocks.state.current,
    dispatch: (action: { type: string; payload: unknown }) => {
      mocks.dispatched.push(action);
      mocks.state.current = Object.fromEntries(
        Object.entries(mocks.state.current).map(([key, value]) => [
          key,
          mocks.reducers[key] ? mocks.reducers[key](value, action) : value,
        ]),
      );
      queueMicrotask(() => mocks.emit.current());
      return action;
    },
  });
  mocks.emit.current = appStore.emitState;
  return createStoreMockModule(appStore);
});
vi.mock('$lib/components/patterns/notify', () => ({ notify: mocks.notify }));
vi.mock('$lib/components/patterns/confirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/components/patterns/confirm')>()),
  confirm: mocks.confirm,
}));

const WORK: ProviderProfile = {
  id: 'pwork',
  providerRef: 'codex@pwork',
  baseProviderId: 'codex',
  name: 'Work',
  env: [
    { key: 'CODEX_HOME', kind: 'set', value: '********' },
    { key: 'OPENAI_API_KEY', kind: 'unset' },
  ],
  settingsFingerprint: 'fp1',
  createdAt: '2026-10-17T10:00:00Z',
  updatedAt: '2026-10-17T10:00:00Z',
};

async function seed({
  profiles = [WORK],
  defaultProviderId = 'codex',
  transportMode = 'sidecar-uds',
  fastMode,
}: {
  profiles?: ProviderProfile[];
  defaultProviderId?: string;
  transportMode?: string;
  fastMode?: Record<string, boolean>;
} = {}) {
  const { reducers } = await import('$store/renderer/reducer');
  mocks.reducers = reducers as never;
  const init = { type: '@@test/init' };
  let state = Object.fromEntries(
    Object.entries(reducers).map(([key, reducer]) => [
      key,
      (reducer as (s: unknown, a: unknown) => unknown)(undefined, init),
    ]),
  ) as Record<string, any>;
  const { providerProfilesLoaded } =
    await import('$store/renderer/slices/provider-settings/provider-settings-slice');
  const { hydrateDefaultProvider } = await import('$store/renderer/slices/model/model-slice');
  const { fastModeSupportReceived, hydrateProviderFastMode } =
    await import('$store/renderer/slices/provider-settings/provider-settings-slice');
  const { providerCatalogLoaded } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } = await import('../../../test/fixtures/provider-catalog.fixture');
  const fastModeActions = fastMode
    ? [
        providerCatalogLoaded({
          providers: MOCK_PROVIDER_CATALOG.providers.map((p) => ({
            ...p,
            supportsFastMode: ['claude-code', 'codex'].includes(p.id),
          })),
        }),
        fastModeSupportReceived(true),
        hydrateProviderFastMode(fastMode, 1),
      ]
    : [];
  for (const action of [
    providerProfilesLoaded(profiles, 3),
    hydrateDefaultProvider(defaultProviderId),
    ...fastModeActions,
  ]) {
    state = Object.fromEntries(
      Object.entries(state).map(([key, value]) => [
        key,
        (reducers as Record<string, (s: unknown, a: unknown) => unknown>)[key](value, action),
      ]),
    );
  }
  state.daemonHealth = { ...state.daemonHealth, transport: { mode: transportMode } };
  mocks.state.current = state;
}

const lastOf = (type: string) =>
  [...mocks.dispatched].reverse().find((action) => action.type === type);

warmImport(() => import('./ProviderProfiles.svelte'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatched.length = 0;
});
afterEach(() => cleanup());

describe('ProviderProfiles', () => {
  it('lists profiles with an honest status and offers Add profile', async () => {
    await seed();
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    const row = screen.getByTestId('provider-profile-row');
    expect(within(row).getByText('Work')).toBeTruthy();
    // A saved profile is configured, never ready, until its own probe says so.
    expect(row.querySelector('[data-profile-status]')?.getAttribute('data-profile-status')).toBe(
      'configured',
    );
    expect(
      screen.getByRole('button', { name: m.settings_providerProfiles_add_label() }),
    ).toBeTruthy();
  });

  it('explains that a leading ~ in CODEX_HOME and CLAUDE_CONFIG_DIR means the home folder', async () => {
    await seed({ profiles: [] });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_add_label() }),
    );
    const dialog = await screen.findByRole('dialog');
    const help = within(dialog).getByText(m.settings_providerProfiles_env_description());
    expect(help.textContent).toMatch(/~.*CODEX_HOME.*CLAUDE_CONFIG_DIR.*home folder/);
  });

  it('creates a profile with masked values, literal empty strings and daemon field errors', async () => {
    await seed({ profiles: [] });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    const { takeStagedProfileEnv } =
      await import('$store/renderer/slices/provider-settings/provider-profiles-state');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_add_label() }),
    );
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(
      within(dialog).getByLabelText(m.settings_providerProfiles_name_label(), {
        selector: 'input[required]',
      }),
      { target: { value: 'Work' } },
    );
    const label = m.settings_providerProfiles_variableN_label({ n: '1' });
    await fireEvent.input(
      within(dialog).getByLabelText(m.settings_providerProfiles_key_ariaLabel({ name: label })),
      { target: { value: 'PATH' } },
    );
    const value = within(dialog).getByLabelText(
      m.settings_providerProfiles_value_ariaLabel({ name: 'PATH' }),
    ) as HTMLInputElement;
    expect(value.type).toBe('password');
    await fireEvent.input(value, { target: { value: 'synthetic-secret' } });
    await fireEvent.click(
      within(dialog).getByRole('button', {
        name: m.settings_providerProfiles_showValue_ariaLabel({ name: 'PATH' }),
      }),
    );
    expect(value.type).toBe('text');

    await fireEvent.click(
      within(dialog).getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    );
    const action = lastOf('providerProfiles/createRequested') as {
      payload: { requestId: string; baseProviderId: string; name: string; envRef: number };
    };
    expect(action.payload).toMatchObject({ baseProviderId: 'codex', name: 'Work' });
    expect(JSON.stringify(action)).not.toContain('synthetic-secret');
    expect(takeStagedProfileEnv(action.payload.envRef)).toEqual([
      { key: 'PATH', kind: 'set', value: 'synthetic-secret' },
    ]);

    const { providerProfileMutationFailed } =
      await import('$store/renderer/slices/provider-settings/provider-settings-slice');
    const { store } = await import('$store/renderer/store');
    store.dispatch(
      providerProfileMutationFailed(action.payload.requestId, {
        kind: 'fieldErrors',
        fieldErrors: [
          {
            field: 'env[0].key',
            code: 'env-key-reserved',
            message: 'PATH is rewritten at launch.',
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(within(dialog).getByText('PATH is rewritten at launch.')).toBeTruthy(),
    );
    expect(
      within(dialog)
        .getByLabelText(m.settings_providerProfiles_key_ariaLabel({ name: 'PATH' }))
        .getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.queryByRole('dialog')).toBeTruthy();
  });

  it('keeps masked saved values on edit and warns with the app-owned restart copy', async () => {
    await seed({ transportMode: 'sidecar-uds' });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await openEdit();
    const dialog = await screen.findByRole('dialog');
    const value = within(dialog).getByLabelText(
      m.settings_providerProfiles_value_ariaLabel({ name: 'CODEX_HOME' }),
    ) as HTMLInputElement;
    expect(value.value).toBe('');
    expect(value.placeholder).toBe(m.settings_providerProfiles_savedValue_placeholder());
    expect(
      within(dialog).getByText(m.settings_providerProfiles_modeUnset_description()),
    ).toBeTruthy();
    expect(screen.queryByTestId('provider-profile-restart-warning')).toBeNull();

    // A rename alone sends no env and needs no restart.
    const name = within(dialog).getByLabelText(m.settings_providerProfiles_name_label(), {
      selector: 'input[required]',
    });
    await fireEvent.input(name, { target: { value: 'Office' } });
    expect(screen.queryByTestId('provider-profile-restart-warning')).toBeNull();

    await fireEvent.input(value, { target: { value: '/accounts/work-2' } });
    const warning = await screen.findByTestId('provider-profile-restart-warning');
    expect(warning.textContent).toContain(m.settings_providerProfiles_restartLocal_description());

    await fireEvent.click(
      within(dialog).getByRole('button', { name: m.settings_providerProfiles_save_label() }),
    );
    const action = lastOf('providerProfiles/updateRequested') as {
      payload: { requestId: string; profileId: string; name?: string; envRef: number };
    };
    expect(action.payload).toMatchObject({ profileId: 'pwork', name: 'Office' });
    const { takeStagedProfileEnv } =
      await import('$store/renderer/slices/provider-settings/provider-profiles-state');
    expect(takeStagedProfileEnv(action.payload.envRef)).toEqual([
      { key: 'CODEX_HOME', kind: 'set', value: '/accounts/work-2' },
      { key: 'OPENAI_API_KEY', kind: 'keep' },
    ]);

    const { providerProfileMutationSucceeded } =
      await import('$store/renderer/slices/provider-settings/provider-settings-slice');
    const { store } = await import('$store/renderer/store');
    store.dispatch(
      providerProfileMutationSucceeded(action.payload.requestId, {
        revision: 4,
        profile: { ...WORK, name: 'Office', settingsFingerprint: 'fp2' },
        activation: { envChanged: true, runningProcesses: 2 },
      }),
    );
    await waitFor(() => expect(mocks.notify.warning).toHaveBeenCalledTimes(1));
    expect(mocks.notify.warning.mock.calls[0][1]).toEqual({
      description: m.settings_providerProfiles_restartLocal_description(),
    });
    await waitFor(() =>
      expect(screen.getByTestId('provider-profile-earlier-settings')).toBeTruthy(),
    );
  });

  // Coordinator decision: the notice follows the per-profile activation count
  // (processes still on earlier settings) and clears by itself at zero.
  it('shows Using earlier settings while processes remain and clears it at zero', async () => {
    await seed();
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    const { providerProfilesLoaded } =
      await import('$store/renderer/slices/provider-settings/provider-settings-slice');
    const { store } = await import('$store/renderer/store');
    const withActivation = (runningProcesses: number) =>
      ({ ...WORK, activation: { envChanged: true, runningProcesses } }) as ProviderProfile;

    store.dispatch(providerProfilesLoaded([withActivation(2)], 5));
    await waitFor(() =>
      expect(screen.getByTestId('provider-profile-earlier-settings')).toBeTruthy(),
    );

    store.dispatch(providerProfilesLoaded([withActivation(0)], 6));
    await waitFor(() =>
      expect(screen.queryByTestId('provider-profile-earlier-settings')).toBeNull(),
    );
  });

  it('keeps an earlier-settings notice when a read carries no activation count', async () => {
    await seed();
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    const { providerProfilesLoaded } =
      await import('$store/renderer/slices/provider-settings/provider-settings-slice');
    const { store } = await import('$store/renderer/store');
    store.dispatch(
      providerProfilesLoaded(
        [{ ...WORK, activation: { envChanged: true, runningProcesses: 1 } } as ProviderProfile],
        5,
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('provider-profile-earlier-settings')).toBeTruthy(),
    );
    store.dispatch(providerProfilesLoaded([WORK], 6));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('provider-profile-earlier-settings')).toBeTruthy();
  });

  it('names intentd on the provider host when the daemon is not app-owned', async () => {
    await seed({ transportMode: 'external-uds' });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await openEdit();
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(
      within(dialog).getByLabelText(
        m.settings_providerProfiles_value_ariaLabel({ name: 'CODEX_HOME' }),
      ),
      { target: { value: '/accounts/x' } },
    );
    const warning = await screen.findByTestId('provider-profile-restart-warning');
    expect(warning.textContent).toContain(m.settings_providerProfiles_restartRemote_description());
    expect(warning.textContent).not.toContain(
      m.settings_providerProfiles_restartLocal_description(),
    );
  });

  it('blocks removal with named reasons while the profile is the default provider', async () => {
    await seed({ defaultProviderId: 'codex@pwork' });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await chooseMenuItem(m.settings_providerProfiles_remove_label());
    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalledTimes(1));
    expect(mocks.notify.error.mock.calls[0][1]?.description).toContain(
      m.settings_providers_inUseDefaultProvider_label(),
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(lastOf('providerProfiles/deleteRequested')).toBeUndefined();
  });

  it('confirms removal before asking the daemon to delete', async () => {
    await seed();
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await chooseMenuItem(m.settings_providerProfiles_remove_label());
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ destructive: true });
    expect(lastOf('providerProfiles/deleteRequested')).toBeUndefined();
    await chooseMenuItem(m.settings_providerProfiles_remove_label());
    await waitFor(() => expect(lastOf('providerProfiles/deleteRequested')).toBeTruthy());
    expect(lastOf('providerProfiles/deleteRequested')?.payload).toEqual([
      expect.objectContaining({ profileId: 'pwork' }),
    ]);
  });
});

const PERSONAL: ProviderProfile = {
  ...WORK,
  id: 'ppersonal',
  providerRef: 'claude-code@ppersonal',
  baseProviderId: 'claude-code',
  name: 'Personal',
  env: [{ key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '********' }],
};

describe('ProviderProfiles Fast mode', () => {
  async function openActions(name: string) {
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_actions_ariaLabel({ name }) }),
    );
    return screen.findByRole('menu');
  }

  it('offers a per-profile Fast mode that starts off even when the Default profile has it on', async () => {
    await seed({ profiles: [PERSONAL], fastMode: { 'claude-code': true } });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'claude-code', providerName: 'Claude Code' });
    const menu = await openActions('Personal');
    const item = within(menu).getByRole('menuitemcheckbox', {
      name: m.settings_providers_fastMode_label(),
    });
    expect(item.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(item);
    await waitFor(() => expect(lastOf('providerSettings/setFastMode')).toBeTruthy());
    expect(lastOf('providerSettings/setFastMode')?.payload).toEqual([
      'claude-code@ppersonal',
      true,
    ]);
  });

  it("reflects the profile's own saved Fast mode", async () => {
    await seed({
      profiles: [PERSONAL],
      fastMode: { 'claude-code': false, 'claude-code@ppersonal': true },
    });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'claude-code', providerName: 'Claude Code' });
    const menu = await openActions('Personal');
    expect(
      within(menu)
        .getByRole('menuitemcheckbox', { name: m.settings_providers_fastMode_label() })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('offers a Codex profile its own Service Tier', async () => {
    await seed({ fastMode: { codex: true } });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    const menu = await openActions('Work');
    expect(
      within(menu).getByRole('menuitem', { name: m.settings_providers_serviceTier_label() }),
    ).toBeTruthy();
    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull();
    const tier = within(menu).getByRole('menuitem', {
      name: m.settings_providers_serviceTier_label(),
    });
    tier.focus();
    await fireEvent.keyDown(tier, { key: 'ArrowRight' });
    const fast = await screen.findByRole('menuitemradio', {
      name: m.settings_providers_serviceTierFast_label(),
    });
    expect(fast.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(fast);
    await waitFor(() => expect(lastOf('providerSettings/setFastMode')).toBeTruthy());
    expect(lastOf('providerSettings/setFastMode')?.payload).toEqual(['codex@pwork', true]);
  });

  it('hides Fast mode when the daemon does not support it', async () => {
    await seed({ profiles: [PERSONAL] });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'claude-code', providerName: 'Claude Code' });
    const menu = await openActions('Personal');
    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull();
    expect(
      within(menu).queryByRole('menuitem', { name: m.settings_providers_serviceTier_label() }),
    ).toBeNull();
  });
});

describe('ProviderProfiles dialog outcomes', () => {
  it('creates a profile from its name alone, sending no env', async () => {
    await seed({ profiles: [] });
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_add_label() }),
    );
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(
      within(dialog).getByLabelText(m.settings_providerProfiles_name_label(), {
        selector: 'input[required]',
      }),
      { target: { value: 'Work' } },
    );
    await fireEvent.click(
      within(dialog).getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    );
    const action = lastOf('providerProfiles/createRequested') as
      { payload: { name: string; envRef?: number } } | undefined;
    expect(action?.payload).toMatchObject({ name: 'Work', envRef: undefined });
    expect(
      within(dialog).queryByText(m.settings_providerProfiles_valueRequired_error()),
    ).toBeNull();
  });

  async function startEnvSaveThenCancel() {
    await seed();
    const { default: ProviderProfiles } = await import('./ProviderProfiles.svelte');
    render(ProviderProfiles, { providerId: 'codex', providerName: 'Codex' });
    await openEdit();
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(
      within(dialog).getByLabelText(
        m.settings_providerProfiles_value_ariaLabel({ name: 'CODEX_HOME' }),
      ),
      { target: { value: '/accounts/new' } },
    );
    await fireEvent.click(
      within(dialog).getByRole('button', { name: m.settings_providerProfiles_save_label() }),
    );
    const action = lastOf('providerProfiles/updateRequested') as {
      payload: { requestId: string };
    };
    await fireEvent.click(
      within(dialog).getByRole('button', { name: m.modals_bulkActionConfirm_cancel_label() }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Reopening must not forget the pending save.
    await openEdit();
    await screen.findByRole('dialog');
    const slice = await import('$store/renderer/slices/provider-settings/provider-settings-slice');
    const { store } = await import('$store/renderer/store');
    return { requestId: action.payload.requestId, slice, store };
  }

  it('still shows the restart warning when a cancelled env save commits', async () => {
    const { requestId, slice, store } = await startEnvSaveThenCancel();
    store.dispatch(
      slice.providerProfileMutationSucceeded(requestId, {
        revision: 4,
        profile: { ...WORK, settingsFingerprint: 'fp2' },
        activation: { envChanged: true, runningProcesses: 0 },
      }),
    );
    await waitFor(() => expect(mocks.notify.warning).toHaveBeenCalledTimes(1));
    expect(mocks.notify.warning.mock.calls[0][1]).toEqual({
      description: m.settings_providerProfiles_restartLocal_description(),
    });
  });

  it('still reports a rejected save after the dialog was cancelled', async () => {
    const { requestId, slice, store } = await startEnvSaveThenCancel();
    store.dispatch(slice.providerProfileMutationFailed(requestId, { kind: 'other' }));
    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalledTimes(1));
  });
});

async function chooseMenuItem(label: string) {
  await fireEvent.click(
    screen.getByRole('button', {
      name: m.settings_providerProfiles_actions_ariaLabel({ name: 'Work' }),
    }),
  );
  const item = await screen.findByRole('menuitem', { name: label });
  await fireEvent.click(item);
}

async function openEdit() {
  await chooseMenuItem(m.settings_providerProfiles_edit_label());
}
