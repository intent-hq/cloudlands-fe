/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { InviteConsentShowPayload } from '$shared/ipc/invite-consent';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const { handleLink } = vi.hoisted(() => ({ handleLink: vi.fn(() => Promise.resolve()) }));
vi.mock('$features/navigation/link-handler', () => ({ handleLink }));

/** The guest's own sign-in (`sign-in-required`): device code + URL, "Open GitHub" primary. */
const PAYLOAD: InviteConsentShowPayload = {
  requestId: 'req-1',
  mode: 'sign-in-required',
  reason: 'not-connected',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
  expiresInMs: 900_000,
};

/** First join with a signed-in guest (`prove`): no code, "Join" primary. */
const PROVE_PAYLOAD: InviteConsentShowPayload = {
  requestId: 'req-3',
  mode: 'prove',
  login: 'octocat',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
};

const CONFIRM_PAYLOAD: InviteConsentShowPayload = {
  requestId: 'req-2',
  mode: 'confirm',
  login: 'octocat',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
};

const DIALOG_NAME = 'Join “Alpha” on host.example';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../InviteConsentModal.svelte'));

async function loadModal() {
  return (await import('../InviteConsentModal.svelte')).default;
}

describe('InviteConsentModal', () => {
  it('sign-in-required: shows the workspace, host, device code and verification URL, no Join button', async () => {
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: true, payload: PAYLOAD, onRespond: vi.fn() } });

    const dialogEl = await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    expect(screen.getByText('https://github.com/login/device')).toBeTruthy();
    expect(screen.getByText('Sign in to GitHub first')).toBeTruthy();
    expect(screen.getByText('What the host learns')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sign-in-required: the scope-missing reason is explained differently from not-connected', async () => {
    const InviteConsentModal = await loadModal();

    const { unmount } = render(InviteConsentModal, {
      props: { open: true, payload: PAYLOAD, onRespond: vi.fn() },
    });
    await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    const notConnected =
      screen.getByText('Sign in to GitHub first').nextElementSibling?.textContent;
    unmount();

    render(InviteConsentModal, {
      props: { open: true, payload: { ...PAYLOAD, reason: 'scope-missing' }, onRespond: vi.fn() },
    });
    await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    const scopeMissing =
      screen.getByText('Sign in to GitHub first').nextElementSibling?.textContent;

    expect(notConnected).toBeTruthy();
    expect(scopeMissing).toBeTruthy();
    expect(scopeMissing).not.toBe(notConnected);
  });

  it('Open GitHub reports open once, keeps the dialog up in a waiting state and does not open the URL itself', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: true, payload: PAYLOAD, onRespond } });

    const openButton = screen.getByRole('button', { name: 'Open GitHub' });
    await fireEvent.click(openButton);
    await fireEvent.click(openButton);

    expect(onRespond).toHaveBeenCalledExactlyOnceWith('open');
    expect(handleLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: DIALOG_NAME })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('Cancel from the waiting state reports cancel and closes', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: true, payload: PAYLOAD, onRespond } });

    await fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRespond.mock.calls).toEqual([['open'], ['cancel']]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('responds cancel on Cancel', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: true, payload: PAYLOAD, onRespond } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith('cancel');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('focuses the dialog on open so Escape cancels without clicking inside', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(InviteConsentModal, { props: { open: true, payload: PAYLOAD, onRespond } });

    const dialogEl = await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    expect(dialogEl.contains(document.activeElement)).toBe(true);

    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(onRespond).toHaveBeenCalledExactlyOnceWith('cancel');
    outside.remove();
  });

  // Real keyboard/pointer coverage lives in invitation-dialogs.ct.spec.ts.
  // Real keyboard/pointer coverage lives in invitation-dialogs.ct.spec.ts.
  it('closes on dismiss (open=false) without responding', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    const { rerender } = render(InviteConsentModal, {
      props: { open: true, payload: PAYLOAD, onRespond },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }));
    onRespond.mockClear();

    await rerender({ open: false, payload: null, onRespond });

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('after the grant (main dismisses the waiting dialog) Cancel is no longer offered and Escape reports nothing', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    const { rerender } = render(InviteConsentModal, {
      props: { open: true, payload: PAYLOAD, onRespond },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    await rerender({ open: false, payload: null, onRespond });

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close invite dialog' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onRespond.mock.calls).toEqual([['open']]);
  });

  // Prove (first join, signed in) and confirm (returning guest): no device
  // code or URL, the identity is named — the GitHub account the proof is made
  // with, or the identity the host already knows — the sign-in section is
  // hidden, and Join is the primary action that keeps the dialog up until
  // main dismisses it.
  it.each([
    ['prove', PROVE_PAYLOAD, 'Signed in to GitHub as @octocat'],
    ['confirm', CONFIRM_PAYLOAD, 'Signed in on this host as @octocat'],
  ] as const)(
    '%s mode: names the identity, hides the device flow, and Join reports open once',
    async (_mode, payload, identityLine) => {
      const onRespond = vi.fn();
      const InviteConsentModal = await loadModal();

      render(InviteConsentModal, { props: { open: true, payload, onRespond } });

      await screen.findByRole('alertdialog', { name: DIALOG_NAME });
      expect(screen.getByText(identityLine)).toBeTruthy();
      expect(screen.getByText('What the host learns')).toBeTruthy();
      expect(screen.queryByText('Sign in to GitHub first')).toBeNull();
      expect(screen.queryByText('ABCD-1234')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open GitHub' })).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();

      const joinButton = screen.getByRole('button', { name: 'Join' });
      await fireEvent.click(joinButton);
      await fireEvent.click(joinButton);

      expect(onRespond).toHaveBeenCalledExactlyOnceWith('open');
      expect(handleLink).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog', { name: DIALOG_NAME })).toBeTruthy();
      expect(screen.getByRole('status')).toBeTruthy();
    },
  );

  it.each([
    ['prove', PROVE_PAYLOAD],
    ['confirm', CONFIRM_PAYLOAD],
  ] as const)('%s mode: Cancel reports cancel without joining', async (_mode, payload) => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: true, payload, onRespond } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith('cancel');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('prove mode: a cancel from the joining state is still reported until main dismisses', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    const { rerender } = render(InviteConsentModal, {
      props: { open: true, payload: PROVE_PAYLOAD, onRespond },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByRole('status')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRespond.mock.calls).toEqual([['open'], ['cancel']]);

    await rerender({ open: false, payload: null, onRespond });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing when closed or without payload', async () => {
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: false, payload: PAYLOAD, onRespond: vi.fn() } });
    render(InviteConsentModal, { props: { open: true, payload: null, onRespond: vi.fn() } });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
