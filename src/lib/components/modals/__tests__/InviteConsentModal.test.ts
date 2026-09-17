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

const PAYLOAD: InviteConsentShowPayload = {
  requestId: 'req-1',
  mode: 'device-code',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
  expiresInMs: 900_000,
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
  it('shows the workspace, host, device code and verification URL', async () => {
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: true, payload: PAYLOAD, onRespond: vi.fn() } });

    const dialogEl = await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    expect(screen.getByText('https://github.com/login/device')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
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

  it('traps Tab within the dialog while open and restores focus on close', async () => {
    const InviteConsentModal = await loadModal();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { rerender } = render(InviteConsentModal, {
      props: { open: true, payload: PAYLOAD, onRespond: vi.fn() },
    });

    const dialogEl = await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    const focusable = Array.from(
      dialogEl.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    await fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    await rerender({ open: false, payload: PAYLOAD, onRespond: vi.fn() });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('responds cancel on backdrop click', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: true, payload: PAYLOAD, onRespond } });

    const dialogEl = await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    await fireEvent.click(dialogEl.parentElement!);

    expect(onRespond).toHaveBeenCalledExactlyOnceWith('cancel');
  });

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

  // Returning guest (confirm mode): no device code or URL, the stored identity
  // is named, "Why sign in?" is hidden, and Join is the primary action that
  // keeps the dialog up until main dismisses it.
  it('confirm mode: names the stored identity, hides the device flow, and Join reports open once', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, {
      props: { open: true, payload: CONFIRM_PAYLOAD, onRespond },
    });

    await screen.findByRole('alertdialog', { name: DIALOG_NAME });
    expect(screen.getByText('Signed in on this host as @octocat')).toBeTruthy();
    expect(screen.getByText('What the host learns')).toBeTruthy();
    expect(screen.queryByText('Why sign in?')).toBeNull();
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
  });

  it('confirm mode: Cancel and Escape report cancel without joining', async () => {
    const onRespond = vi.fn();
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, {
      props: { open: true, payload: CONFIRM_PAYLOAD, onRespond },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRespond).toHaveBeenCalledExactlyOnceWith('cancel');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders nothing when closed or without payload', async () => {
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: false, payload: PAYLOAD, onRespond: vi.fn() } });
    render(InviteConsentModal, { props: { open: true, payload: null, onRespond: vi.fn() } });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
