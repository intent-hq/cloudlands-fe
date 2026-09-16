/**
 * @vitest-environment jsdom
 *
 * Renderer invite-notice service: show → immediate ack + modal open,
 * acknowledgement invoke (exact payload, once), dismiss closes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeInviteNotice, installInviteNoticeService } from '../invite-notice-service';
import { INVITE_NOTICE_CHANNELS } from '$shared/ipc/channels';
import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';

const SHOW_PAYLOAD: InviteNoticeShowPayload = {
  requestId: 'req-1',
  kind: 'failed',
  reason: 'expired',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
};

function getHandlers(channel: string): Array<(payload: unknown) => void> {
  return (window as any).electronAPI._getRegisteredHandlers(channel);
}

function emit(channel: string, payload: unknown) {
  for (const handler of getHandlers(channel)) handler(payload);
}

describe('invite-notice-service', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let onShow: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;
  let dispose: () => void;

  beforeEach(() => {
    invoke = (window as any).electronAPI.invoke;
    invoke.mockClear();
    // Drain handlers registered by previous installs (test-setup persists them).
    getHandlers(INVITE_NOTICE_CHANNELS.SHOW).length = 0;
    getHandlers(INVITE_NOTICE_CHANNELS.DISMISS).length = 0;
    onShow = vi.fn();
    onDismiss = vi.fn();
    dispose = installInviteNoticeService({ onShow, onDismiss });
    return () => dispose();
  });

  it('acks immediately with the exact requestId and opens the modal on show', () => {
    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_NOTICE_CHANNELS.ACK, {
      requestId: 'req-1',
    });
    expect(onShow).toHaveBeenCalledExactlyOnceWith(SHOW_PAYLOAD);
  });

  it('sends the acknowledgement once and ends the request', () => {
    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    acknowledgeInviteNotice();
    acknowledgeInviteNotice();

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_NOTICE_CHANNELS.RESPONSE, {
      requestId: 'req-1',
    });
  });

  it('acknowledging with no active request sends nothing', () => {
    acknowledgeInviteNotice();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('dismiss for the active request closes the modal and drops the request', () => {
    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    emit(INVITE_NOTICE_CHANNELS.DISMISS, { requestId: 'req-1' });

    expect(onDismiss).toHaveBeenCalledOnce();
    acknowledgeInviteNotice();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores dismiss for a stale requestId', () => {
    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);

    emit(INVITE_NOTICE_CHANNELS.DISMISS, { requestId: 'other-req' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores malformed show payloads without acking', () => {
    emit(INVITE_NOTICE_CHANNELS.SHOW, { nope: true });
    emit(INVITE_NOTICE_CHANNELS.SHOW, undefined);

    expect(invoke).not.toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
  });

  it('a later show supersedes the previous request', () => {
    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);
    emit(INVITE_NOTICE_CHANNELS.SHOW, { ...SHOW_PAYLOAD, requestId: 'req-2', kind: 'plaintext' });
    invoke.mockClear();

    acknowledgeInviteNotice();

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_NOTICE_CHANNELS.RESPONSE, {
      requestId: 'req-2',
    });
  });

  it('dispose detaches the listeners and drops the active request', () => {
    const api = (window as any).electronAPI;
    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);
    dispose();
    invoke.mockClear();

    acknowledgeInviteNotice();

    expect(invoke).not.toHaveBeenCalled();
    expect(api.offById).toHaveBeenCalledWith(INVITE_NOTICE_CHANNELS.SHOW, expect.any(String));
    expect(api.offById).toHaveBeenCalledWith(INVITE_NOTICE_CHANNELS.DISMISS, expect.any(String));
  });
});
