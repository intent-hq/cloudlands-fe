/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';
import { describeInviteFailureReason } from '$shared/utils/invite-failure-text';
import { m } from '$shared/paraglide/messages.js';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const FAILED: InviteNoticeShowPayload = {
  requestId: 'req-1',
  kind: 'failed',
  reason: 'workspace-full',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
};

const PLAINTEXT: InviteNoticeShowPayload = {
  requestId: 'req-2',
  kind: 'plaintext',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../InviteNoticeModal.svelte'));

async function loadModal() {
  return (await import('../InviteNoticeModal.svelte')).default;
}

describe('InviteNoticeModal', () => {
  it('failed: titles the dialog as a failure and shows the sentence for the bounded reason', async () => {
    const InviteNoticeModal = await loadModal();

    render(InviteNoticeModal, { props: { open: true, payload: FAILED, onAcknowledge: vi.fn() } });

    const dialogEl = await screen.findByRole('alertdialog', {
      name: m.deeplink_inviteFailed_title(),
    });
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText(describeInviteFailureReason('workspace-full'))).toBeTruthy();
    expect(screen.getByText(/Alpha/)).toBeTruthy();
  });

  it('failed: a different reason renders a different sentence', async () => {
    const InviteNoticeModal = await loadModal();

    render(InviteNoticeModal, {
      props: { open: true, payload: { ...FAILED, reason: 'host-refused' }, onAcknowledge: vi.fn() },
    });

    expect(screen.getByText(describeInviteFailureReason('host-refused'))).toBeTruthy();
    expect(screen.queryByText(describeInviteFailureReason('workspace-full'))).toBeNull();
  });

  it('plaintext: titles the dialog as the encryption warning with its message', async () => {
    const InviteNoticeModal = await loadModal();

    render(InviteNoticeModal, {
      props: { open: true, payload: PLAINTEXT, onAcknowledge: vi.fn() },
    });

    expect(
      await screen.findByRole('alertdialog', { name: m.deeplink_invitePlaintext_title() }),
    ).toBeTruthy();
    expect(screen.getByText(m.deeplink_invitePlaintext_message())).toBeTruthy();
  });

  it('omits the workspace/host line when the labels are unknown', async () => {
    const InviteNoticeModal = await loadModal();

    render(InviteNoticeModal, {
      props: {
        open: true,
        payload: { requestId: 'req-3', kind: 'failed', reason: 'host-unreachable' },
        onAcknowledge: vi.fn(),
      },
    });

    await screen.findByRole('alertdialog');
    expect(screen.queryByText(/Alpha|host\.example/)).toBeNull();
  });

  it('OK acknowledges once and closes', async () => {
    const onAcknowledge = vi.fn();
    const InviteNoticeModal = await loadModal();

    render(InviteNoticeModal, { props: { open: true, payload: FAILED, onAcknowledge } });
    const ok = screen.getByRole('button', { name: m.deeplink_inviteFailed_ok_button() });
    await fireEvent.click(ok);
    await fireEvent.click(ok);

    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('focuses the dialog on open so Escape acknowledges without clicking inside', async () => {
    const onAcknowledge = vi.fn();
    const InviteNoticeModal = await loadModal();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(InviteNoticeModal, { props: { open: true, payload: PLAINTEXT, onAcknowledge } });

    const dialogEl = await screen.findByRole('alertdialog');
    expect(document.activeElement).toBe(dialogEl);

    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('acknowledges on backdrop click', async () => {
    const onAcknowledge = vi.fn();
    const InviteNoticeModal = await loadModal();

    render(InviteNoticeModal, { props: { open: true, payload: FAILED, onAcknowledge } });

    const dialogEl = await screen.findByRole('alertdialog');
    await fireEvent.click(dialogEl.parentElement!);

    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it('closes on dismiss (open=false) without acknowledging', async () => {
    const onAcknowledge = vi.fn();
    const InviteNoticeModal = await loadModal();

    const { rerender } = render(InviteNoticeModal, {
      props: { open: true, payload: FAILED, onAcknowledge },
    });
    await rerender({ open: false, payload: null, onAcknowledge });

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onAcknowledge).not.toHaveBeenCalled();
  });
});
