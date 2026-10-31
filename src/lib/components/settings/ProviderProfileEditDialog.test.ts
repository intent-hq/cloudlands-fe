/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import type { EnvEntryRead, ProviderProfile } from '$shared/provider-profiles';
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
const staged = async (envRef: number) =>
  (
    await import('$store/renderer/slices/provider-settings/provider-profiles-state')
  ).takeStagedProfileEnv(envRef);

async function seed(profiles: ProviderProfile[], transportMode = 'sidecar-uds') {
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

function profileOf(
  base: 'claude-code' | 'codex',
  env: EnvEntryRead[],
  extra: Partial<ProviderProfile> = {},
): ProviderProfile {
  return {
    id: 'p1',
    providerRef: `${base}@p1`,
    baseProviderId: base,
    name: 'Work',
    env,
    settingsFingerprint: 'fp1',
    createdAt: '2026-10-30T10:00:00Z',
    updatedAt: '2026-10-30T10:00:00Z',
    ...extra,
  };
}

const MASK = '********';
const CLAUDE_FOLDER = profileOf('claude-code', [
  { key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '~/.claude-work' },
]);
const CLAUDE_KEY = profileOf('claude-code', [
  { key: 'ANTHROPIC_API_KEY', kind: 'set', value: MASK },
  { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
  { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
]);
const CLAUDE_TOKEN = profileOf('claude-code', [
  { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'set', value: MASK },
]);
const CODEX_FOLDER = profileOf('codex', [
  { key: 'CODEX_HOME', kind: 'set', value: '~/intent/profiles/codex/work-k3f9' },
  { key: 'CODEX_ACCESS_TOKEN', kind: 'unset' },
]);
const CODEX_TOKEN = profileOf('codex', [
  { key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: MASK },
  { key: 'CODEX_API_KEY', kind: 'unset' },
  { key: 'OPENAI_API_KEY', kind: 'unset' },
]);

async function openEdit(profile: ProviderProfile, transportMode = 'sidecar-uds') {
  await seed([profile], transportMode);
  const provider = profile.baseProviderId === 'codex' ? 'codex' : 'claude';
  const { default: Dialog } = await import('./ProviderProfileEditDialog.svelte');
  render(Dialog, {
    props: {
      open: true,
      static: true,
      provider,
      providerName: provider === 'codex' ? 'Codex' : 'Claude Code',
      profile,
    },
  });
  return screen.getByTestId('provider-profile-kind-details');
}

const save = () =>
  fireEvent.click(screen.getByRole('button', { name: m.settings_providerProfiles_save_label() }));
const nameInput = () =>
  screen.getByLabelText(m.settings_providerProfiles_name_label(), { selector: 'input' });

warmImport(() => import('./ProviderProfileEditDialog.svelte'));
warmImport(() => import('./ProviderProfileDialog.svelte'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatched.length = 0;
});
afterEach(() => cleanup());

describe('ProviderProfileEditDialog: the matching screen', () => {
  it.each([
    ['Claude Different login', CLAUDE_FOLDER, 'differentLogin'],
    ['Claude API key', CLAUDE_KEY, 'apiKey'],
    ['Claude Token', CLAUDE_TOKEN, 'token'],
    ['Codex Different login', CODEX_FOLDER, 'differentLogin'],
    ['Codex Token', CODEX_TOKEN, 'token'],
  ] as const)('%s opens its own screen', async (_label, profile, kind) => {
    const details = await openEdit(profile);
    expect(details.dataset.kind).toBe(kind);
    expect(
      screen.getByRole('button', {
        name: m.settings_providerProfileKinds_switchToAdvanced_label(),
      }),
    ).toBeTruthy();
    expect((nameInput() as HTMLInputElement).value).toBe('Work');
  });

  it('shows the saved folder read-only; Codex offers only Sign in with ChatGPT', async () => {
    await openEdit(CODEX_FOLDER);
    const folder = screen.getByTestId('provider-profile-folder-path') as HTMLInputElement;
    expect(folder.value).toBe('~/intent/profiles/codex/work-k3f9');
    expect(folder.readOnly).toBe(true);
    const actions = screen.getByTestId('provider-profile-sign-in-actions');
    expect(
      within(actions)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim()),
    ).toEqual([m.settings_providerProfileKinds_signInChatGpt_label()]);
  });

  it('a foreign unset or an extra set key opens Advanced', async () => {
    const details = await openEdit(
      profileOf('claude-code', [
        { key: 'ANTHROPIC_API_KEY', kind: 'set', value: MASK },
        { key: 'HTTPS_PROXY', kind: 'set', value: MASK },
      ]),
    );
    expect(details.dataset.kind).toBe('advanced');
    expect(
      screen.queryByRole('button', {
        name: m.settings_providerProfileKinds_switchToAdvanced_label(),
      }),
    ).toBeNull();
  });

  it('an older daemon (masked folder) opens Advanced with no error', async () => {
    const details = await openEdit(
      profileOf('codex', [
        { key: 'CODEX_HOME', kind: 'set', value: MASK },
        { key: 'OPENAI_API_KEY', kind: 'unset' },
      ]),
    );
    expect(details.dataset.kind).toBe('advanced');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('provider-profile-sign-in-actions')).toBeNull();
  });
});

describe('ProviderProfileEditDialog: saving', () => {
  it('keeps a saved key: a rename sends no env and no key check', async () => {
    await openEdit(CLAUDE_KEY);
    expect(screen.getByTestId('provider-profile-secret-saved').textContent).toContain(
      m.settings_providerProfileKinds_saved_label(),
    );
    await fireEvent.input(nameInput(), { target: { value: 'Office' } });
    expect(screen.queryByTestId('provider-profile-restart-warning')).toBeNull();
    await save();
    const { providerProfileUpdateRequested, providerProfileSecretEditRequested } = await slice();
    const action = lastOf(providerProfileUpdateRequested.type)!;
    expect(action.payload).toMatchObject({ profileId: 'p1', name: 'Office', envRef: undefined });
    expect(lastOf(providerProfileSecretEditRequested.type)).toBeUndefined();
  });

  it('re-adds missing unsets on save and sends the folder as keep', async () => {
    await openEdit(CLAUDE_FOLDER);
    await save();
    const { providerProfileUpdateRequested } = await slice();
    const action = lastOf(providerProfileUpdateRequested.type)!;
    expect(action.payload.name).toBeUndefined();
    expect(await staged(action.payload.envRef)).toEqual([
      { key: 'CLAUDE_CONFIG_DIR', kind: 'keep' },
      { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
    ]);
  });

  it('closes without a request when nothing changed', async () => {
    await openEdit(CODEX_TOKEN);
    await save();
    const { providerProfileUpdateRequested } = await slice();
    expect(lastOf(providerProfileUpdateRequested.type)).toBeUndefined();
    await waitFor(() => expect(screen.queryByTestId('provider-profile-kind-details')).toBeNull());
  });

  it('Replace sends the new key, runs the key check and shows Key was rejected', async () => {
    await openEdit(CLAUDE_KEY);
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_replace_label() }),
    );
    await fireEvent.input(screen.getByTestId('provider-profile-secret-input'), {
      target: { value: 'sk-ant-new' },
    });
    expect(screen.getByTestId('provider-profile-restart-warning')).toBeTruthy();
    await save();
    const { providerProfileSecretEditRequested, providerProfileSetupChanged } = await slice();
    const action = lastOf(providerProfileSecretEditRequested.type)!;
    expect(action.payload).toMatchObject({ profileId: 'p1' });
    expect(action.payload.name).toBeUndefined();
    expect(await staged(action.payload.envRef)).toEqual([
      { key: 'ANTHROPIC_API_KEY', kind: 'set', value: 'sk-ant-new' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
    ]);
    expect(JSON.stringify(mocks.dispatched)).not.toContain('sk-ant-new');

    const setupId = action.payload.setupId;
    await dispatch(providerProfileSetupChanged(setupId, { phase: 'keyRejected', profileId: 'p1' }));
    expect(screen.getByTestId('provider-profile-sign-in-status').dataset.status).toBe(
      'keyRejected',
    );
    await dispatch(providerProfileSetupChanged(setupId, { phase: 'keyWorks' }));
    await waitFor(() => expect(mocks.notify.warning).toHaveBeenCalledTimes(1));
    expect(mocks.notify.warning.mock.calls[0][0]).toBe(
      m.settings_providerProfiles_saved_label({ name: 'Work' }),
    );
  });

  it('an empty replacement is blocked inline', async () => {
    await openEdit(CODEX_TOKEN);
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_replace_label() }),
    );
    await save();
    expect(screen.getByText(m.settings_providerProfileKinds_tokenRequired_error())).toBeTruthy();
    const { providerProfileSecretEditRequested } = await slice();
    expect(lastOf(providerProfileSecretEditRequested.type)).toBeUndefined();
  });

  it('a rejected save shows the daemon error on the name field', async () => {
    await openEdit(CLAUDE_TOKEN);
    await fireEvent.input(nameInput(), { target: { value: 'Dup' } });
    await save();
    const { providerProfileUpdateRequested, providerProfileMutationFailed } = await slice();
    const { requestId } = lastOf(providerProfileUpdateRequested.type)!.payload;
    await dispatch(
      providerProfileMutationFailed(requestId, {
        kind: 'fieldErrors',
        fieldErrors: [{ field: 'name', code: 'name-duplicate', message: 'taken' }],
      }),
    );
    expect(
      screen.getByText(
        m.settings_providerProfiles_nameDuplicate_error({ provider: 'Claude Code' }),
      ),
    ).toBeTruthy();
  });

  it('Sign in on Different login signs in to the saved folder', async () => {
    await openEdit(CLAUDE_FOLDER);
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_logIn_label() }),
    );
    const { providerProfileSavedFolderSignInRequested, providerProfileSetupChanged } =
      await slice();
    const [{ setupId, profileId }] = lastOf(
      providerProfileSavedFolderSignInRequested.type,
    )!.payload;
    expect(profileId).toBe('p1');
    await dispatch(
      providerProfileSetupChanged(setupId, { phase: 'signedIn', email: 'work@acme.com' }),
    );
    expect(
      screen.getByText(
        m.settings_providerProfileKinds_signedInAs_label({ email: 'work@acme.com' }),
      ),
    ).toBeTruthy();
  });
});

describe('ProviderProfileEditDialog: Switch to Advanced', () => {
  it('keeps the unsaved name, backup and typed key', async () => {
    await openEdit(CLAUDE_KEY);
    await fireEvent.input(nameInput(), { target: { value: 'Office' } });
    await fireEvent.click(screen.getByRole('switch'));
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_replace_label() }),
    );
    await fireEvent.input(screen.getByTestId('provider-profile-secret-input'), {
      target: { value: 'sk-typed' },
    });
    await fireEvent.click(
      screen.getByRole('button', {
        name: m.settings_providerProfileKinds_switchToAdvanced_label(),
      }),
    );
    expect(screen.getByTestId('provider-profile-kind-details').dataset.kind).toBe('advanced');
    expect((nameInput() as HTMLInputElement).value).toBe('Office');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    const keyValue = screen.getByLabelText(
      m.settings_providerProfiles_value_ariaLabel({ name: 'ANTHROPIC_API_KEY' }),
    ) as HTMLInputElement;
    expect(keyValue.value).toBe('sk-typed');
    expect(screen.getByTestId('provider-profile-restart-warning')).toBeTruthy();

    await save();
    const { providerProfileUpdateRequested } = await slice();
    const action = lastOf(providerProfileUpdateRequested.type)!;
    expect(action.payload).toMatchObject({ name: 'Office', backup: true });
    expect(await staged(action.payload.envRef)).toEqual([
      { key: 'ANTHROPIC_API_KEY', kind: 'set', value: 'sk-typed' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'keep' },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'keep' },
    ]);
  });
});

describe('Default configuration dialog is unchanged', () => {
  it('keeps the plain name + env editor: no kinds, no Switch to Advanced', async () => {
    await seed([]);
    const { default: ProviderProfileDialog } = await import('./ProviderProfileDialog.svelte');
    render(ProviderProfileDialog, {
      props: {
        open: true,
        static: true,
        providerId: 'claude-code',
        providerName: 'Claude Code',
        isDefault: true,
        defaultConfig: {
          baseProviderId: 'claude-code',
          providerRef: 'claude-code',
          name: 'Default',
          env: [{ key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '~/.claude-work' }],
          settingsFingerprint: 'fdef',
        } as never,
      },
    });
    expect(
      screen.getByText(m.settings_providerDefault_title_label({ provider: 'Claude Code' })),
    ).toBeTruthy();
    expect(screen.queryByTestId('provider-profile-kind-details')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: m.settings_providerProfileKinds_switchToAdvanced_label(),
      }),
    ).toBeNull();
    expect(
      screen.getByLabelText(
        m.settings_providerProfiles_value_ariaLabel({ name: 'CLAUDE_CONFIG_DIR' }),
      ),
    ).toBeTruthy();
  });
});
