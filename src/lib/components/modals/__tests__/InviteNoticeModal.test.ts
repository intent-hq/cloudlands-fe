/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';
import { describeInviteFailureReason } from '$shared/utils/invite-failure-text';
import { m } from '$shared/paraglide/messages.js';
import { setLabsSettingsVisible } from '$store/renderer/slices/user-preferences/user-preferences-slice';

const labs = vi.hoisted(() => ({ enabled: false, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ userPreferences: { labsGitLabEnabled: labs.enabled } }),
    dispatch: labs.dispatch,
  });
});
beforeEach(() => {
  labs.enabled = false;
  vi.clearAllMocks();
});

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const { navigateToSettings } = vi.hoisted(() => ({
  navigateToSettings: vi.fn(() => Promise.resolve()),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings }));

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
  it.each(['proof-gitlab-not-connected', 'proof-gitlab-scope-missing'] as const)(
    'offers a Labs enable route for %s while setup is hidden, preserving the failure payload',
    async (reason) => {
      const Modal = await loadModal();
      const payload = { ...FAILED, reason };
      const onAcknowledge = vi.fn();
      render(Modal, { props: { open: true, payload, onAcknowledge } });
      expect(labs.dispatch).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByRole('button', { name: 'Enable GitLab in Labs' }));
      expect(navigateToSettings).toHaveBeenCalledExactlyOnceWith({
        tab: 'labs',
        hash: 'labs-gitlab',
      });
      expect(onAcknowledge).toHaveBeenCalledOnce();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(payload).toEqual({ ...FAILED, reason });
      expect(labs.dispatch).toHaveBeenCalledExactlyOnceWith(setLabsSettingsVisible(true));
    },
  );

  it.each(['pin-mismatch', 'identity-unavailable'] as const)(
    'keeps %s recovery neutral for unknown or GitHub accounts',
    async (reason) => {
      const Modal = await loadModal();
      for (const accountProvider of [undefined, 'github'] as const) {
        const onAcknowledge = vi.fn();
        const view = render(Modal, {
          props: { open: true, payload: { ...FAILED, reason, accountProvider }, onAcknowledge },
        });
        expect(screen.queryByRole('button', { name: 'Enable GitLab in Labs' })).toBeNull();
        await fireEvent.click(screen.getByRole('button', { name: 'Open Connections' }));
        expect(navigateToSettings).toHaveBeenLastCalledWith({
          tab: 'connections',
          hash: 'integrations',
        });
        expect(onAcknowledge).toHaveBeenCalledOnce();
        expect(labs.dispatch).not.toHaveBeenCalled();
        view.unmount();
      }
    },
  );

  it.each(['pin-mismatch', 'identity-unavailable'] as const)(
    'reveals Labs for confirmed GitLab %s without enabling GitLab',
    async (reason) => {
      const Modal = await loadModal();
      const payload = { ...FAILED, reason, accountProvider: 'gitlab' as const };
      const onAcknowledge = vi.fn();
      render(Modal, { props: { open: true, payload, onAcknowledge } });
      expect(labs.dispatch).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByRole('button', { name: 'Enable GitLab in Labs' }));
      expect(navigateToSettings).toHaveBeenCalledExactlyOnceWith({
        tab: 'labs',
        hash: 'labs-gitlab',
      });
      expect(onAcknowledge).toHaveBeenCalledOnce();
      expect(labs.dispatch).toHaveBeenCalledExactlyOnceWith(setLabsSettingsVisible(true));
      expect(payload.accountProvider).toBe('gitlab');
    },
  );

  it.each(['ok', 'escape'] as const)(
    'keeps Labs hidden when a GitLab setup notice is dismissed with %s',
    async (dismiss) => {
      const Modal = await loadModal();
      const payload = {
        ...FAILED,
        reason: 'pin-mismatch' as const,
        accountProvider: 'gitlab' as const,
      };
      const onAcknowledge = vi.fn();
      render(Modal, { props: { open: true, payload, onAcknowledge } });
      if (dismiss === 'ok') {
        await fireEvent.click(
          screen.getByRole('button', { name: m.deeplink_inviteFailed_ok_button() }),
        );
      } else {
        await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      }
      expect(onAcknowledge).toHaveBeenCalledOnce();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(labs.dispatch).not.toHaveBeenCalled();
      expect(navigateToSettings).not.toHaveBeenCalled();
      expect(payload.accountProvider).toBe('gitlab');
    },
  );

  it.each(['host-unreachable', 'proof-gitlab-unreachable', 'generic'] as const)(
    'does not turn unrelated %s failures into account setup',
    async (reason) => {
      const Modal = await loadModal();
      render(Modal, {
        props: { open: true, payload: { ...FAILED, reason, accountProvider: 'gitlab' } },
      });
      expect(screen.queryByRole('button', { name: 'Enable GitLab in Labs' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open Connections' })).toBeNull();
      await fireEvent.click(
        screen.getByRole('button', { name: m.deeplink_inviteFailed_ok_button() }),
      );
      expect(navigateToSettings).not.toHaveBeenCalled();
      expect(labs.dispatch).not.toHaveBeenCalled();
    },
  );

  it('routes enabled GitLab setup to Connections after acknowledging the failed join', async () => {
    labs.enabled = true;
    const Modal = await loadModal();
    const onAcknowledge = vi.fn();
    render(Modal, {
      props: {
        open: true,
        payload: { ...FAILED, reason: 'proof-gitlab-not-connected' },
        onAcknowledge,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open Connections' }));
    expect(navigateToSettings).toHaveBeenCalledExactlyOnceWith({
      tab: 'connections',
      hash: 'integrations',
    });
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(labs.dispatch).not.toHaveBeenCalled();
  });

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
    expect(dialogEl.contains(document.activeElement)).toBe(true);

    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    outside.remove();
  });

  // Real keyboard/pointer coverage lives in invitation-dialogs.ct.spec.ts.
  it('restores focus to the opener when OK acknowledges', async () => {
    const InviteNoticeModal = await loadModal();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    render(InviteNoticeModal, { props: { open: true, payload: FAILED, onAcknowledge: vi.fn() } });
    await screen.findByRole('alertdialog');
    expect(document.activeElement).not.toBe(outside);

    await fireEvent.click(
      screen.getByRole('button', { name: m.deeplink_inviteFailed_ok_button() }),
    );

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  // Real keyboard/pointer coverage lives in invitation-dialogs.ct.spec.ts.
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
