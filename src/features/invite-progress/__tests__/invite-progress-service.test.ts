/**
 * @vitest-environment jsdom
 *
 * Renderer invite-progress service: show → immediate ack + modal open,
 * update forwarded only for the active request, cancel invoke (exact payload,
 * once), dismiss closes, and the bounded-logging rule (reason codes only;
 * never the payload or reject value).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ userPreferences: { labsMultiplayerEnabled: true, labsGitLabEnabled: false } }),
  });
});
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = loggerMocks.info;
    warn = loggerMocks.warn;
    error = loggerMocks.error;
  },
}));

import {
  cancelInviteProgress,
  retryInviteProgress,
  installInviteProgressService,
} from '../invite-progress-service';
import { COLLABORATION_AUTH } from '../../collaboration-auth/types';
import { INVITE_PROGRESS_CHANNELS } from '$shared/ipc/channels';
import type { InviteProgressShowPayload } from '$shared/ipc/invite-progress';

const SHOW_PAYLOAD: InviteProgressShowPayload = {
  requestId: 'req-1',
  phase: 'connecting',
  hostLabel: 'host.example',
};

const UPDATE_PAYLOAD: InviteProgressShowPayload = {
  requestId: 'req-1',
  phase: 'opening',
  workspaceTitle: 'Alpha',
};

function getHandlers(channel: string): Array<(payload: unknown) => void> {
  return (window as any).electronAPI._getRegisteredHandlers(channel);
}

function emit(channel: string, payload: unknown) {
  for (const handler of getHandlers(channel)) handler(payload);
}

describe('invite-progress-service', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let onShow: ReturnType<typeof vi.fn>;
  let onUpdate: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;
  let dispose: () => void;

  beforeEach(() => {
    invoke = (window as any).electronAPI.invoke;
    invoke.mockReset().mockResolvedValue({ ok: true });
    loggerMocks.warn.mockClear();
    loggerMocks.error.mockClear();
    // Drain handlers registered by previous installs (test-setup persists them).
    getHandlers(INVITE_PROGRESS_CHANNELS.SHOW).length = 0;
    getHandlers(INVITE_PROGRESS_CHANNELS.UPDATE).length = 0;
    getHandlers(INVITE_PROGRESS_CHANNELS.DISMISS).length = 0;
    onShow = vi.fn();
    onUpdate = vi.fn();
    onDismiss = vi.fn();
    dispose = installInviteProgressService({ onShow, onUpdate, onDismiss });
    invoke.mockClear();
    return () => dispose();
  });

  it('acks immediately with the exact requestId and opens the modal on show', () => {
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_PROGRESS_CHANNELS.ACK, {
      requestId: 'req-1',
    });
    expect(onShow).toHaveBeenCalledExactlyOnceWith(SHOW_PAYLOAD);
  });

  it('announces readiness only after listeners can show and acknowledge a replay', () => {
    dispose();
    invoke.mockImplementation(async (channel) => {
      if (channel === COLLABORATION_AUTH.POLICY)
        emit(INVITE_PROGRESS_CHANNELS.SHOW, { ...SHOW_PAYLOAD, phase: 'admission' });
      return { ok: true };
    });
    dispose = installInviteProgressService({ onShow, onUpdate, onDismiss });
    expect(onShow).toHaveBeenCalledWith({ ...SHOW_PAYLOAD, phase: 'admission' });
    expect(invoke).toHaveBeenCalledWith(INVITE_PROGRESS_CHANNELS.ACK, {
      requestId: SHOW_PAYLOAD.requestId,
    });
  });

  it('publishes renderer policy before explicitly retrying the same invitation', async () => {
    invoke.mockResolvedValue({ ok: true });
    emit(INVITE_PROGRESS_CHANNELS.SHOW, { ...SHOW_PAYLOAD, phase: 'admission' });
    invoke.mockClear();
    await retryInviteProgress();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      COLLABORATION_AUTH.POLICY,
      INVITE_PROGRESS_CHANNELS.RESPONSE,
    ]);
    expect(invoke).toHaveBeenLastCalledWith(INVITE_PROGRESS_CHANNELS.RESPONSE, {
      requestId: SHOW_PAYLOAD.requestId,
      action: 'retry',
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'replacement', 'policy-failure'] as const)(
    'does not retry after %s while policy publication is pending',
    async (mode) => {
      emit(INVITE_PROGRESS_CHANNELS.SHOW, { ...SHOW_PAYLOAD, phase: 'admission' });
      const pending = Promise.withResolvers<{ ok: boolean }>();
      invoke.mockImplementation((channel: string) =>
        channel === COLLABORATION_AUTH.POLICY ? pending.promise : Promise.resolve({ ok: true }),
      );
      const retrying = retryInviteProgress();
      if (mode === 'cancel') cancelInviteProgress();
      if (mode === 'replacement')
        emit(INVITE_PROGRESS_CHANNELS.SHOW, {
          ...SHOW_PAYLOAD,
          requestId: 'new',
          phase: 'admission',
        });
      pending.resolve({ ok: mode !== 'policy-failure' });
      await retrying;
      expect(
        invoke.mock.calls.filter(
          ([channel, input]) =>
            channel === INVITE_PROGRESS_CHANNELS.RESPONSE && (input as any).action === 'retry',
        ),
      ).toEqual([]);
    },
  );

  it('forwards an update for the active request without acking again', () => {
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    emit(INVITE_PROGRESS_CHANNELS.UPDATE, UPDATE_PAYLOAD);

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(UPDATE_PAYLOAD);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores an update for a stale requestId or with no active request', () => {
    emit(INVITE_PROGRESS_CHANNELS.UPDATE, UPDATE_PAYLOAD);
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    emit(INVITE_PROGRESS_CHANNELS.UPDATE, { ...UPDATE_PAYLOAD, requestId: 'other-req' });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('sends the cancel response once and ends the request', () => {
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    cancelInviteProgress();
    cancelInviteProgress();

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_PROGRESS_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      action: 'cancel',
    });
  });

  it('cancelling with no active request sends nothing', () => {
    cancelInviteProgress();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('dismiss for the active request closes the modal and drops the request', () => {
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    emit(INVITE_PROGRESS_CHANNELS.DISMISS, { requestId: 'req-1' });

    expect(onDismiss).toHaveBeenCalledOnce();
    cancelInviteProgress();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores dismiss for a stale requestId', () => {
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);

    emit(INVITE_PROGRESS_CHANNELS.DISMISS, { requestId: 'other-req' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores malformed show payloads without acking and logs only a bounded code', () => {
    const leak = 'super-secret-junk';
    emit(INVITE_PROGRESS_CHANNELS.SHOW, { nope: true, leak });
    emit(INVITE_PROGRESS_CHANNELS.SHOW, { requestId: 'req-x', phase: 'bogus', leak });
    emit(INVITE_PROGRESS_CHANNELS.SHOW, undefined);

    expect(invoke).not.toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(3);
    for (const call of loggerMocks.warn.mock.calls) {
      expect(call[1]).toEqual({ code: 'malformed-payload' });
      expect(JSON.stringify(call)).not.toContain(leak);
    }
  });

  it('an ack reject logs only a bounded code plus requestId and phase', async () => {
    const rejectText = 'raw-ipc-failure-text';
    invoke.mockRejectedValueOnce(rejectText);

    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    await vi.waitFor(() => expect(loggerMocks.warn).toHaveBeenCalledOnce());

    expect(loggerMocks.warn.mock.calls[0][1]).toEqual({
      code: 'ack-rejected',
      requestId: 'req-1',
      phase: 'connecting',
    });
    expect(JSON.stringify(loggerMocks.warn.mock.calls)).not.toContain(rejectText);
    expect(onShow).toHaveBeenCalledExactlyOnceWith(SHOW_PAYLOAD);
  });

  it('a response reject logs only a bounded code plus requestId', async () => {
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    const rejectText = 'raw-response-failure-text';
    invoke.mockRejectedValueOnce(new Error(rejectText));

    cancelInviteProgress();
    await vi.waitFor(() => expect(loggerMocks.error).toHaveBeenCalledOnce());

    expect(loggerMocks.error.mock.calls[0][1]).toEqual({
      code: 'response-rejected',
      requestId: 'req-1',
    });
    expect(JSON.stringify(loggerMocks.error.mock.calls)).not.toContain(rejectText);
  });

  it('a later show supersedes the previous request', () => {
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    emit(INVITE_PROGRESS_CHANNELS.SHOW, { ...SHOW_PAYLOAD, requestId: 'req-2' });
    invoke.mockClear();

    emit(INVITE_PROGRESS_CHANNELS.UPDATE, UPDATE_PAYLOAD);
    expect(onUpdate).not.toHaveBeenCalled();

    cancelInviteProgress();

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_PROGRESS_CHANNELS.RESPONSE, {
      requestId: 'req-2',
      action: 'cancel',
    });
  });

  it('dispose detaches the listeners and drops the active request', () => {
    const api = (window as any).electronAPI;
    emit(INVITE_PROGRESS_CHANNELS.SHOW, SHOW_PAYLOAD);
    dispose();
    invoke.mockClear();

    cancelInviteProgress();

    expect(invoke).not.toHaveBeenCalled();
    expect(api.offById).toHaveBeenCalledWith(INVITE_PROGRESS_CHANNELS.SHOW, expect.any(String));
    expect(api.offById).toHaveBeenCalledWith(INVITE_PROGRESS_CHANNELS.UPDATE, expect.any(String));
    expect(api.offById).toHaveBeenCalledWith(INVITE_PROGRESS_CHANNELS.DISMISS, expect.any(String));
  });
});
