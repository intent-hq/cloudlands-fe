/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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
  it('shows the four kind cards, with the Codex token card naming Business or Enterprise', () => {
    render(ProviderProfileKindDialog, { props: { ...codex, mode: 'add' } });
    for (const kind of ['differentLogin', 'apiKey', 'token', 'advanced']) {
      expect(screen.getByTestId(`provider-profile-kind-${kind}`)).toBeTruthy();
    }
    expect(screen.getByText(m.settings_providerProfileKinds_tokenCodex_description())).toBeTruthy();
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

  it('shows Waiting for sign-in after Create & sign in when no handler is wired', async () => {
    render(ProviderProfileKindDialog, {
      props: { ...claude, mode: 'add', step: 'details', name: 'Work' },
    });
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_createAndSignIn_label() }),
    );
    expect(screen.getByTestId('provider-profile-sign-in-status').dataset.status).toBe('waiting');
    expect(screen.getByText(m.settings_providerProfileKinds_waiting_label())).toBeTruthy();
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

  it('offers both Codex sign-in methods on the Different-login edit screen', async () => {
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
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_signInApiKey_label() }),
    );
    expect(onSignIn).toHaveBeenCalledWith('apiKey');
    expect(
      screen.getByRole('button', { name: m.settings_providerProfileKinds_signInChatGpt_label() }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: m.settings_providerProfileKinds_switchToAdvanced_label(),
      }),
    ).toBeTruthy();
  });

  it('shows the Claude identity once signed in, and plain Signed in for Codex', () => {
    const { unmount } = render(ProviderProfileKindDialog, {
      props: {
        ...claude,
        mode: 'add',
        step: 'details',
        name: 'Work',
        signIn: { status: 'signedIn', email: 'work@acme.com' },
      },
    });
    expect(
      screen.getByText(
        m.settings_providerProfileKinds_signedInAs_label({ email: 'work@acme.com' }),
      ),
    ).toBeTruthy();
    unmount();
    render(ProviderProfileKindDialog, {
      props: {
        ...codex,
        mode: 'add',
        step: 'details',
        name: 'Work',
        signIn: { status: 'signedIn' },
      },
    });
    expect(screen.getByText(m.settings_providerProfileKinds_signedIn_label())).toBeTruthy();
  });

  it('shows the Codex API-key instructions with no key field', () => {
    render(ProviderProfileKindDialog, {
      props: { ...codex, mode: 'add', step: 'details', kind: 'apiKey', name: 'Key' },
    });
    expect(screen.getByTestId('provider-profile-api-key-steps')).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText('codex login --with-api-key')).toBeTruthy();
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
    expect(signInCommand('claude', 'chatgpt', true)).toBe('claude auth login');
    expect(signInCommand('codex', 'chatgpt', false)).toBe('codex login');
    expect(signInCommand('codex', 'chatgpt', true)).toBe('codex login --device-auth');
    expect(signInCommand('codex', 'apiKey', true)).toBe('codex login --with-api-key');
  });
});
