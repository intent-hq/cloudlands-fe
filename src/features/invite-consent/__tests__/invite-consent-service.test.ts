/**
 * @vitest-environment jsdom
 *
 * Renderer invite-consent service: show → immediate ack + modal open,
 * response invoke (exact payload; `open` once, then `cancel` still allowed
 * from the waiting state), dismiss closes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installInviteConsentService, respondToInviteConsent } from '../invite-consent-service';
import { INVITE_CONSENT_CHANNELS } from '$shared/ipc/channels';
import type { InviteConsentShowPayload } from '$shared/ipc/invite-consent';

const SHOW_PAYLOAD: InviteConsentShowPayload = {
  requestId: 'req-1',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  workspaceTitle: 'Alpha',
  hostLabel: 'host.example',
  expiresInMs: 900_000,
};

function getHandlers(channel: string): Array<(payload: unknown) => void> {
  return (window as any).electronAPI._getRegisteredHandlers(channel);
}

function emit(channel: string, payload: unknown) {
  for (const handler of getHandlers(channel)) handler(payload);
}

describe('invite-consent-service', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let onShow: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;
  let dispose: () => void;

  beforeEach(() => {
    invoke = (window as any).electronAPI.invoke;
    invoke.mockClear();
    // Drain handlers registered by previous installs (test-setup persists them).
    getHandlers(INVITE_CONSENT_CHANNELS.SHOW).length = 0;
    getHandlers(INVITE_CONSENT_CHANNELS.DISMISS).length = 0;
    onShow = vi.fn();
    onDismiss = vi.fn();
    dispose = installInviteConsentService({ onShow, onDismiss });
    return () => dispose();
  });

  it('acks immediately with the exact requestId and opens the modal on show', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, SHOW_PAYLOAD);

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_CONSENT_CHANNELS.ACK, {
      requestId: 'req-1',
    });
    expect(onShow).toHaveBeenCalledExactlyOnceWith(SHOW_PAYLOAD);
  });

  it('sends open once and keeps the request live for a later cancel', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    respondToInviteConsent('open');
    respondToInviteConsent('open');
    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_CONSENT_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      action: 'open',
    });

    invoke.mockClear();
    respondToInviteConsent('cancel');
    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_CONSENT_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      action: 'cancel',
    });
  });

  it('cancel ends the request so repeat cancel/open paths cannot double-send', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    respondToInviteConsent('cancel');
    respondToInviteConsent('cancel');
    respondToInviteConsent('open');

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_CONSENT_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      action: 'cancel',
    });
  });

  it('dismiss for the active request closes the modal and drops the request', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, SHOW_PAYLOAD);
    respondToInviteConsent('open');
    invoke.mockClear();

    emit(INVITE_CONSENT_CHANNELS.DISMISS, { requestId: 'req-1', outcome: 'joined' });

    expect(onDismiss).toHaveBeenCalledOnce();
    respondToInviteConsent('cancel');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores dismiss for a stale requestId', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, SHOW_PAYLOAD);

    emit(INVITE_CONSENT_CHANNELS.DISMISS, { requestId: 'other-req', outcome: 'cancelled' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores malformed show payloads without acking', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, { nope: true });
    emit(INVITE_CONSENT_CHANNELS.SHOW, undefined);

    expect(invoke).not.toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
  });

  it('a later show supersedes the previous request and resets the open state', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, SHOW_PAYLOAD);
    respondToInviteConsent('open');
    emit(INVITE_CONSENT_CHANNELS.SHOW, { ...SHOW_PAYLOAD, requestId: 'req-2' });
    invoke.mockClear();

    respondToInviteConsent('open');

    expect(invoke).toHaveBeenCalledExactlyOnceWith(INVITE_CONSENT_CHANNELS.RESPONSE, {
      requestId: 'req-2',
      action: 'open',
    });
  });

  it('does nothing without an active request', () => {
    respondToInviteConsent('open');
    respondToInviteConsent('cancel');

    expect(invoke).not.toHaveBeenCalled();
  });

  it('dispose removes listeners and clears the active request', () => {
    emit(INVITE_CONSENT_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    dispose();
    respondToInviteConsent('open');

    expect(invoke).not.toHaveBeenCalled();
    expect((window as any).electronAPI.offById).toHaveBeenCalledWith(
      INVITE_CONSENT_CHANNELS.SHOW,
      expect.any(String),
    );
    expect((window as any).electronAPI.offById).toHaveBeenCalledWith(
      INVITE_CONSENT_CHANNELS.DISMISS,
      expect.any(String),
    );
  });
});
