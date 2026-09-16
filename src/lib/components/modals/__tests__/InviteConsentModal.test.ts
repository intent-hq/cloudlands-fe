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
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
  expiresInMs: 900_000,
};

const DIALOG_NAME = 'Join Alpha';

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
    expect(dialogEl.textContent).toContain('host.example');
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
    expect(document.activeElement).toBe(dialogEl);

    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(onRespond).toHaveBeenCalledExactlyOnceWith('cancel');
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

  it('renders nothing when closed or without payload', async () => {
    const InviteConsentModal = await loadModal();

    render(InviteConsentModal, { props: { open: false, payload: PAYLOAD, onRespond: vi.fn() } });
    render(InviteConsentModal, { props: { open: true, payload: null, onRespond: vi.fn() } });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
