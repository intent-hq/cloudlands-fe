/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import type { ProviderProfile } from '$shared/provider-profiles';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
  reducers: {} as Record<string, (state: unknown, action: unknown) => unknown>,
  dispatched: [] as Array<{ type: string; payload: any }>,
  emit: { current: () => {} },
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
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
vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

const slice = () => import('$store/renderer/slices/provider-settings/provider-settings-slice');

async function seed(profiles: ProviderProfile[] = [], transportMode = 'sidecar-uds') {
  const { reducers } = await import('$store/renderer/reducer');
  mocks.reducers = reducers as never;
  const init = { type: '@@test/init' };
  const state = Object.fromEntries(
    Object.entries(reducers).map(([key, reducer]) => [
      key,
      (reducer as (s: unknown, a: unknown) => unknown)(undefined, init),
    ]),
  ) as Record<string, any>;
  const { providerProfilesLoaded } = await slice();
  state.providerSettings = (reducers as any).providerSettings(
    state.providerSettings,
    providerProfilesLoaded(profiles, 3),
  );
  state.daemonHealth = { ...state.daemonHealth, transport: { mode: transportMode } };
  mocks.state.current = state;
}

const lastOf = (type: string) =>
  [...mocks.dispatched].reverse().find((action) => action.type === type);

async function dispatch(action: { type: string; payload: unknown }) {
  const { store } = await import('$store/renderer/store');
  store.dispatch(action as never);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function openDialog(provider: 'claude' | 'codex' = 'claude') {
  const { default: Dialog } = await import('./ProviderProfileAddDialog.svelte');
  return render(Dialog, {
    props: {
      open: true,
      static: true,
      provider,
      providerId: provider === 'claude' ? 'claude-code' : 'codex',
      providerName: provider === 'claude' ? 'Claude Code' : 'Codex',
    },
  });
}

warmImport(() => import('./ProviderProfileAddDialog.svelte'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatched.length = 0;
});
afterEach(() => cleanup());

describe('ProviderProfileAddDialog', () => {
  it('Different login: requests the folder setup, then closes and hands the wait to the row once the terminal opens', async () => {
    await seed();
    await openDialog('claude');
    await fireEvent.click(screen.getByTestId('provider-profile-kind-differentLogin'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Work account' } });
    const preview = screen.getByTestId('provider-profile-folder-path').textContent!.trim();
    expect(preview).toMatch(/^~\/intent\/profiles\/claude\/work-account-[a-z0-9]{4}$/);

    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    const {
      providerProfileFolderSetupRequested,
      providerProfileSetupChanged,
      providerProfileSetupDismissed,
    } = await slice();
    const request = lastOf(providerProfileFolderSetupRequested.type)!;
    const [{ setupId, provider, name, backup, suffix }] = request.payload;
    expect({ provider, name, backup }).toEqual({
      provider: 'claude',
      name: 'Work account',
      backup: false,
    });
    expect(preview.endsWith(`-${suffix}`)).toBe(true);

    // Saved, terminal still opening: the dialog stays (errors would show here).
    await dispatch(
      providerProfileSetupChanged(setupId, { phase: 'openingTerminal', profileId: 'p1' }),
    );
    expect(screen.getByTestId('provider-profile-kind-details')).toBeTruthy();

    await dispatch(providerProfileSetupChanged(setupId, { phase: 'waiting', deviceAuth: false }));
    await waitFor(() => expect(screen.queryByTestId('provider-profile-kind-details')).toBeNull());
    const { selectProviderProfileSetups } =
      await import('$store/renderer/slices/provider-settings/provider-settings-selectors');
    expect(selectProviderProfileSetups.select(mocks.state.current as never)[setupId]).toMatchObject(
      { phase: 'waiting', onRow: true, profileId: 'p1' },
    );
    expect(lastOf(providerProfileSetupDismissed.type)).toBeUndefined();
    expect(mocks.notify.success).not.toHaveBeenCalled();
  });

  it('a terminal that fails to open keeps the error in the dialog with Try again', async () => {
    await seed([], 'remote-tcp');
    await openDialog('codex');
    expect(screen.queryByTestId('provider-profile-kind-apiKey')).toBeNull();
    await fireEvent.click(screen.getByTestId('provider-profile-kind-differentLogin'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Work' } });
    expect(screen.getByText('codex login --device-auth')).toBeTruthy();
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    const {
      providerProfileFolderSetupRequested,
      providerProfileSetupChanged,
      providerProfileSignInRetryRequested,
    } = await slice();
    const [{ setupId }] = lastOf(providerProfileFolderSetupRequested.type)!.payload;
    await dispatch(
      providerProfileSetupChanged(setupId, {
        phase: 'failed',
        profileId: 'p1',
        failure: { kind: 'terminalFailed' },
      }),
    );
    expect(screen.getByTestId('provider-profile-setup-error').textContent).toContain(
      m.settings_providerProfileKinds_terminalFailed_error(),
    );
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_tryAgain_label() }),
    );
    expect(lastOf(providerProfileSignInRetryRequested.type)?.payload).toEqual([setupId]);
  });

  it('a rejected save shows the name error and lets the form be submitted again', async () => {
    await seed();
    await openDialog('claude');
    await fireEvent.click(screen.getByTestId('provider-profile-kind-differentLogin'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Work' } });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    const { providerProfileFolderSetupRequested, providerProfileSetupChanged } = await slice();
    const [{ setupId }] = lastOf(providerProfileFolderSetupRequested.type)!.payload;
    await dispatch(
      providerProfileSetupChanged(setupId, {
        phase: 'failed',
        failure: {
          kind: 'saveFailed',
          failure: {
            kind: 'fieldErrors',
            fieldErrors: [{ field: 'name', code: 'duplicate', message: 'Name taken' }],
          },
        },
      }),
    );
    await waitFor(() => expect(screen.getByRole('textbox')).not.toHaveProperty('disabled', true));
    expect(screen.queryByTestId('provider-profile-sign-in-status')).toBeNull();
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    const second = lastOf(providerProfileFolderSetupRequested.type)!.payload[0].setupId;
    expect(second).not.toBe(setupId);
  });

  it('Claude API key: stages the key (never on the action), then retries a rejected key with a replacement', async () => {
    const created: ProviderProfile = {
      id: 'p1',
      providerRef: 'claude-code@p1',
      baseProviderId: 'claude-code',
      name: 'Key',
      env: [
        { key: 'ANTHROPIC_API_KEY', kind: 'set', value: '********' },
        { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
        { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
      ],
      settingsFingerprint: 'fp',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    };
    await seed([created]);
    await openDialog('claude');
    await fireEvent.click(screen.getByTestId('provider-profile-kind-apiKey'));
    await fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Key' } });

    // An empty key blocks Create with an inline error.
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    );
    const {
      providerProfileSecretSetupRequested,
      providerProfileSecretRetryRequested,
      providerProfileSetupChanged,
    } = await slice();
    expect(lastOf(providerProfileSecretSetupRequested.type)).toBeUndefined();
    expect(screen.getByText(m.settings_providerProfileKinds_keyRequired_error())).toBeTruthy();

    await fireEvent.input(screen.getByTestId('provider-profile-secret-input'), {
      target: { value: 'sk-ant-first' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    );
    const request = lastOf(providerProfileSecretSetupRequested.type)!;
    expect(JSON.stringify(request)).not.toContain('sk-ant-first');
    const { takeStagedProfileEnv } =
      await import('$store/renderer/slices/provider-settings/provider-profiles-state');
    expect(request.payload).toMatchObject({
      baseProviderId: 'claude-code',
      name: 'Key',
      backup: false,
    });
    expect(takeStagedProfileEnv(request.payload.envRef)).toEqual([
      { key: 'ANTHROPIC_API_KEY', kind: 'set', value: 'sk-ant-first' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
    ]);

    const setupId = request.payload.setupId;
    await dispatch(providerProfileSetupChanged(setupId, { phase: 'saving' }));
    await dispatch(providerProfileSetupChanged(setupId, { phase: 'keyRejected', profileId: 'p1' }));
    expect(screen.getByText(m.settings_providerProfileKinds_keyRejected_label())).toBeTruthy();

    await fireEvent.input(screen.getByTestId('provider-profile-secret-input'), {
      target: { value: 'sk-ant-second' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_tryAgain_label() }),
    );
    const retry = lastOf(providerProfileSecretRetryRequested.type)!;
    expect(JSON.stringify(retry)).not.toContain('sk-ant-second');
    expect(takeStagedProfileEnv(retry.payload.envRef)).toEqual([
      { key: 'ANTHROPIC_API_KEY', kind: 'set', value: 'sk-ant-second' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
    ]);

    await dispatch(providerProfileSetupChanged(setupId, { phase: 'keyWorks' }));
    expect(screen.getByText(m.settings_providerProfileKinds_keyWorks_label())).toBeTruthy();
    expect(mocks.notify.success).toHaveBeenCalledWith(
      m.settings_providerProfiles_created_label({ name: 'Key' }),
    );
  });

  it('Codex token: rejects a non-JWT value inline, then sends CODEX_ACCESS_TOKEN with its unsets', async () => {
    await seed();
    await openDialog('codex');
    await fireEvent.click(screen.getByTestId('provider-profile-kind-token'));
    await fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Biz' } });
    await fireEvent.input(screen.getByTestId('provider-profile-secret-input'), {
      target: { value: 'not-a-jwt' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    );
    const { providerProfileSecretSetupRequested } = await slice();
    expect(lastOf(providerProfileSecretSetupRequested.type)).toBeUndefined();
    expect(screen.getByText(m.settings_providerProfileKinds_tokenNotJwt_error())).toBeTruthy();

    await fireEvent.input(screen.getByTestId('provider-profile-secret-input'), {
      target: { value: 'aaa.bbb.ccc' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    );
    const { takeStagedProfileEnv } =
      await import('$store/renderer/slices/provider-settings/provider-profiles-state');
    const request = lastOf(providerProfileSecretSetupRequested.type)!;
    expect(request.payload.baseProviderId).toBe('codex');
    expect(takeStagedProfileEnv(request.payload.envRef)).toEqual([
      { key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: 'aaa.bbb.ccc' },
      { key: 'CODEX_API_KEY', kind: 'unset' },
      { key: 'OPENAI_API_KEY', kind: 'unset' },
    ]);
  });

  it('Advanced creates through the ordinary create request', async () => {
    await seed();
    await openDialog('codex');
    await fireEvent.click(screen.getByTestId('provider-profile-kind-advanced'));
    await fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Raw' } });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_create_label() }),
    );
    const { providerProfileCreateRequested } = await slice();
    expect(lastOf(providerProfileCreateRequested.type)?.payload).toMatchObject({
      baseProviderId: 'codex',
      name: 'Raw',
    });
  });

  it('closing the dialog before the terminal opens dismisses its setup (the profile stays saved)', async () => {
    await seed();
    const view = await openDialog('claude');
    await fireEvent.click(screen.getByTestId('provider-profile-kind-differentLogin'));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Work' } });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    const {
      providerProfileFolderSetupRequested,
      providerProfileSetupDismissed,
      providerProfileSetupChanged,
    } = await slice();
    const [{ setupId }] = lastOf(providerProfileFolderSetupRequested.type)!.payload;
    await dispatch(providerProfileSetupChanged(setupId, { phase: 'openingTerminal' }));
    await view.rerender({ open: false });
    await waitFor(() =>
      expect(lastOf(providerProfileSetupDismissed.type)?.payload).toEqual([setupId]),
    );
  });
});
