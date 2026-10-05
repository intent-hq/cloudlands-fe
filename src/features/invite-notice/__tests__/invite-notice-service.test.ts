/**
 * @vitest-environment jsdom
 *
 * Renderer invite-notice service: show → immediate ack + modal open,
 * acknowledgement invoke (exact payload, once), dismiss closes, and the
 * bounded-logging rule (reason codes only; never the payload or reject value).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = loggerMocks.info;
    warn = loggerMocks.warn;
    error = loggerMocks.error;
  },
}));

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
    loggerMocks.warn.mockClear();
    loggerMocks.error.mockClear();
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

  it('ignores malformed show payloads without acking and logs only a bounded code', () => {
    const leak = 'super-secret-junk';
    emit(INVITE_NOTICE_CHANNELS.SHOW, { nope: true, leak });
    emit(INVITE_NOTICE_CHANNELS.SHOW, undefined);

    expect(invoke).not.toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(2);
    for (const call of loggerMocks.warn.mock.calls) {
      expect(call[1]).toEqual({ code: 'malformed-payload' });
      expect(JSON.stringify(call)).not.toContain(leak);
    }
  });

  it('an ack reject logs only a bounded code plus requestId and kind', async () => {
    const rejectText = 'raw-ipc-failure-text';
    invoke.mockRejectedValueOnce(rejectText);

    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);
    await vi.waitFor(() => expect(loggerMocks.warn).toHaveBeenCalledOnce());

    expect(loggerMocks.warn.mock.calls[0][1]).toEqual({
      code: 'ack-rejected',
      requestId: 'req-1',
      kind: 'failed',
    });
    expect(JSON.stringify(loggerMocks.warn.mock.calls)).not.toContain(rejectText);
    expect(onShow).toHaveBeenCalledExactlyOnceWith(SHOW_PAYLOAD);
  });

  it('a response reject logs only a bounded code plus requestId', async () => {
    emit(INVITE_NOTICE_CHANNELS.SHOW, SHOW_PAYLOAD);
    const rejectText = 'raw-response-failure-text';
    invoke.mockRejectedValueOnce(new Error(rejectText));

    acknowledgeInviteNotice();
    await vi.waitFor(() => expect(loggerMocks.error).toHaveBeenCalledOnce());

    expect(loggerMocks.error.mock.calls[0][1]).toEqual({
      code: 'response-rejected',
      requestId: 'req-1',
    });
    expect(JSON.stringify(loggerMocks.error.mock.calls)).not.toContain(rejectText);
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
