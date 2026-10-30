/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import ProviderProfileKindDialog from './ProviderProfileKindDialog.svelte';
import ProfileDeleteConfirm from './ProfileDeleteConfirm.svelte';
import ProfileRowsMock from './ProfileRowsMock.svelte';
import {
  claudeAdvancedEdit,
  claudeApiKeyAdd,
  claudeApiKeyEdit,
  claudeApiKeyEditWithEndpoint,
  claudeEdit,
  claudeRows,
  claudeTokenAdd,
  codexTokenAdd,
  FAKE_JWT,
} from './profile-kind.preview-fixtures';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const createButton = () =>
  screen.getByRole('button', { name: m.settings_providerProfiles_create_label() });
const secretInput = () => screen.getByTestId('provider-profile-secret-input') as HTMLInputElement;

describe('API key and Token screens (mock-up)', () => {
  it('blocks Create with an inline error when the Claude API key is empty', async () => {
    const onCreate = vi.fn();
    render(ProviderProfileKindDialog, { props: { ...claudeApiKeyAdd, onCreate } });
    expect(secretInput().type).toBe('password');
    await fireEvent.click(createButton());
    expect(screen.getByText(m.settings_providerProfileKinds_keyRequired_error())).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('runs the mock key check after Create: Checking, then Key works', async () => {
    vi.useFakeTimers();
    render(ProviderProfileKindDialog, { props: { ...claudeApiKeyAdd } });
    await fireEvent.input(secretInput(), { target: { value: 'sk-ant-fake' } });
    await fireEvent.click(createButton());
    const status = () => screen.getByTestId('provider-profile-sign-in-status').dataset.status;
    expect(status()).toBe('checkingKey');
    await vi.advanceTimersByTimeAsync(1500);
    expect(status()).toBe('keyWorks');
  });

  it('keeps the Custom endpoint collapsed until opened', () => {
    render(ProviderProfileKindDialog, { props: { ...claudeApiKeyAdd } });
    const details = screen.getByTestId('provider-profile-custom-endpoint') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.getByText(m.settings_providerProfileKinds_customEndpoint_label())).toBeTruthy();
  });

  it('shows a copyable claude setup-token command on the Claude Token screen', () => {
    render(ProviderProfileKindDialog, { props: { ...claudeTokenAdd } });
    expect(screen.getByTestId('provider-profile-setup-token').textContent).toContain(
      'claude setup-token',
    );
  });

  it('rejects a non-JWT Codex token inline and accepts a JWT-shaped one', async () => {
    const onCreate = vi.fn();
    render(ProviderProfileKindDialog, { props: { ...codexTokenAdd, onCreate } });
    expect(screen.getByTestId('provider-profile-token-eligibility')).toBeTruthy();
    await fireEvent.input(secretInput(), { target: { value: 'not-a-token' } });
    await fireEvent.click(createButton());
    expect(screen.getByText(m.settings_providerProfileKinds_tokenNotJwt_error())).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();

    await fireEvent.input(secretInput(), { target: { value: FAKE_JWT } });
    await fireEvent.click(createButton());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('shows a saved key as Saved •••• with Replace, and warns once it is replaced', async () => {
    render(ProviderProfileKindDialog, { props: { ...claudeApiKeyEdit } });
    expect(screen.getByTestId('provider-profile-secret-saved')).toBeTruthy();
    expect(screen.queryByTestId('provider-profile-secret-input')).toBeNull();
    expect(screen.queryByTestId('provider-profile-restart-warning')).toBeNull();

    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_replace_label() }),
    );
    await fireEvent.input(secretInput(), { target: { value: 'sk-ant-new' } });
    expect(screen.getByTestId('provider-profile-restart-warning')).toBeTruthy();
  });

  it('offers Replace and Remove for a saved Custom endpoint', async () => {
    render(ProviderProfileKindDialog, { props: { ...claudeApiKeyEditWithEndpoint } });
    const saved = screen.getByTestId('provider-profile-base-url-saved');
    expect(saved.textContent).toContain(m.settings_providerProfileKinds_saved_label());
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfiles_remove_label() }),
    );
    expect(screen.getByText(m.settings_providerProfileKinds_baseUrlRemoved_label())).toBeTruthy();
    expect(screen.getByTestId('provider-profile-restart-warning')).toBeTruthy();
  });
});

describe('Advanced and Switch to Advanced (mock-up)', () => {
  it('keeps the unsaved name and backup when switching to Advanced', async () => {
    render(ProviderProfileKindDialog, {
      props: {
        ...claudeEdit,
        savedEnv: [
          { key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: claudeEdit.savedFolderPath },
          { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
        ],
      },
    });
    const name = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Renamed' } });
    await fireEvent.click(screen.getByRole('switch'));
    await fireEvent.click(
      screen.getByRole('button', {
        name: m.settings_providerProfileKinds_switchToAdvanced_label(),
      }),
    );

    expect(screen.getByTestId('provider-profile-kind-details').dataset.kind).toBe('advanced');
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('Renamed');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByTestId('provider-profile-env-row')).toHaveLength(2);
  });

  it('shows the running-sessions warning only after an Advanced edit changes env', async () => {
    render(ProviderProfileKindDialog, { props: { ...claudeAdvancedEdit } });
    expect(screen.queryByTestId('provider-profile-restart-warning')).toBeNull();
    const removeButtons = screen.getAllByRole('button', {
      name: (accessibleName) => accessibleName.includes('AWS_REGION'),
    });
    await fireEvent.click(removeButtons[removeButtons.length - 1]!);
    expect(screen.getByTestId('provider-profile-restart-warning')).toBeTruthy();
  });
});

describe('profile rows and delete confirmation (mock-up)', () => {
  it('names the folder left on disk when removing a Different-login profile', () => {
    render(ProfileDeleteConfirm, {
      props: {
        static: true,
        profileName: 'Work account',
        folderPath: '~/intent/profiles/claude/work-account-k3f9',
      },
    });
    expect(
      screen.getByText(
        m.settings_providerProfileKinds_removeFolder_description({
          path: '~/intent/profiles/claude/work-account-k3f9',
        }),
      ),
    ).toBeTruthy();
  });

  it('shows Signed in as <email> on ready Claude rows only', () => {
    render(ProfileRowsMock, {
      props: {
        provider: 'claude',
        providerName: 'Claude Code',
        rows: claudeRows.map((row) => ({ ...row })),
      },
    });
    const identities = screen.getAllByTestId('provider-profile-identity');
    expect(identities).toHaveLength(1);
    expect(identities[0]!.textContent).toContain('work@acme.com');
    expect(screen.getByText(m.settings_providerProfiles_statusError_label())).toBeTruthy();
  });

  it('offers ⋯ → Log In for Different-login rows only', () => {
    const rows = claudeRows.map((row) => ({ ...row }));
    const { unmount } = render(ProfileRowsMock, {
      props: {
        provider: 'claude',
        providerName: 'Claude Code',
        rows,
        menuOpenFor: 'side',
        staticMenus: true,
      },
    });
    expect(screen.getByTestId('provider-profile-row-log-in')).toBeTruthy();
    unmount();
    render(ProfileRowsMock, {
      props: {
        provider: 'claude',
        providerName: 'Claude Code',
        rows,
        menuOpenFor: 'key',
        staticMenus: true,
      },
    });
    expect(screen.getByTestId('provider-profile-row-menu')).toBeTruthy();
    expect(screen.queryByTestId('provider-profile-row-log-in')).toBeNull();
  });
});
