/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import ProviderProfileKindDialog from './ProviderProfileKindDialog.svelte';
import { previewProfileFolder, signInCommand } from './profile-kind-mock';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

const claude = {
  open: true,
  static: true,
  provider: 'claude',
  providerName: 'Claude Code',
  folderSuffix: 'k3f9',
} as const;
const codex = { ...claude, provider: 'codex', providerName: 'Codex' } as const;

afterEach(() => cleanup());

describe('ProviderProfileKindDialog (mock-up)', () => {
  it('shows three Codex kind cards (no API key), with the token card naming Business or Enterprise', () => {
    render(ProviderProfileKindDialog, { props: { ...codex, mode: 'add' } });
    for (const kind of ['differentLogin', 'token', 'advanced']) {
      expect(screen.getByTestId(`provider-profile-kind-${kind}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('provider-profile-kind-apiKey')).toBeNull();
    expect(screen.getByText(m.settings_providerProfileKinds_tokenCodex_description())).toBeTruthy();
  });

  it('shows all four kind cards for Claude, including API key', () => {
    render(ProviderProfileKindDialog, { props: { ...claude, mode: 'add' } });
    for (const kind of ['differentLogin', 'apiKey', 'token', 'advanced']) {
      expect(screen.getByTestId(`provider-profile-kind-${kind}`)).toBeTruthy();
    }
  });

  it('moves from a card to its screen and live-previews the folder from the name', async () => {
    render(ProviderProfileKindDialog, { props: { ...claude, mode: 'add' } });
    await fireEvent.click(screen.getByTestId('provider-profile-kind-differentLogin'));

    expect(screen.getByTestId('provider-profile-starts-fresh')).toBeTruthy();
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Work account' } });
    expect(screen.getByTestId('provider-profile-folder-path').textContent?.trim()).toBe(
      '~/intent/profiles/claude/work-account-k3f9',
    );
  });

  it('closes after Create & sign in when no handler is wired (the row tracks the sign-in)', async () => {
    render(ProviderProfileKindDialog, {
      props: { ...claude, mode: 'add', step: 'details', name: 'Work' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    await waitFor(() => expect(screen.queryByTestId('provider-profile-kind-details')).toBeNull());
    expect(screen.queryByText(m.settings_providerProfileKinds_waiting_label())).toBeNull();
  });

  it('calls onCreateAndSignIn instead of advancing when a handler is wired', async () => {
    const onCreateAndSignIn = vi.fn();
    render(ProviderProfileKindDialog, {
      props: { ...claude, mode: 'add', step: 'details', name: 'Work', onCreateAndSignIn },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    expect(onCreateAndSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('provider-profile-sign-in-status')).toBeNull();
  });

  it('offers only Sign in with ChatGPT on the Codex Different-login edit screen', async () => {
    const onSignIn = vi.fn();
    render(ProviderProfileKindDialog, {
      props: {
        ...codex,
        mode: 'edit',
        kind: 'differentLogin',
        name: 'Personal',
        savedName: 'Personal',
        savedFolderPath: '~/intent/profiles/codex/personal-7h2m',
        onSignIn,
      },
    });
    expect((screen.getByTestId('provider-profile-folder-path') as HTMLInputElement).value).toBe(
      '~/intent/profiles/codex/personal-7h2m',
    );
    const actions = screen.getByTestId('provider-profile-sign-in-actions');
    expect(actions.querySelectorAll('button')).toHaveLength(1);
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_signInChatGpt_label() }),
    );
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', {
        name: m.settings_providerProfileKinds_switchToAdvanced_label(),
      }),
    ).toBeTruthy();
  });

  it('shows a saved-profile error with Try again when the folder could not be created', () => {
    render(ProviderProfileKindDialog, {
      props: {
        ...claude,
        mode: 'add',
        step: 'details',
        name: 'Work',
        setupError: { kind: 'folderFailed', path: '~/intent/profiles/claude/work-k3f9' },
      },
    });
    expect(screen.getByTestId('provider-profile-setup-error').textContent).toContain(
      '~/intent/profiles/claude/work-k3f9',
    );
    expect(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_tryAgain_label() }),
    ).toBeTruthy();
  });
});

describe('profile-kind mock helpers', () => {
  it('previews the folder in its ~/ form', () => {
    expect(previewProfileFolder('codex', 'Work account', 'k3f9')).toBe(
      '~/intent/profiles/codex/work-account-k3f9',
    );
  });

  it('builds plain sign-in commands', () => {
    expect(signInCommand('claude', true)).toBe('claude auth login');
    expect(signInCommand('codex', false)).toBe('codex login');
    expect(signInCommand('codex', true)).toBe('codex login --device-auth');
  });
});
