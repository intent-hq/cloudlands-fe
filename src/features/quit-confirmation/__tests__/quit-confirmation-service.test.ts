/**
 * @vitest-environment jsdom
 *
 * Renderer quit-confirmation service: show → immediate ack + modal open,
 * response invoke (exact payload, once per request), dismiss closes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installQuitConfirmationService,
  respondToQuitConfirmation,
} from '../quit-confirmation-service';
import { QUIT_CONFIRMATION_CHANNELS } from '$shared/ipc/channels';
import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';

const SHOW_PAYLOAD: QuitConfirmationShowPayload = {
  requestId: 'req-1',
  interrupted: [{ agentId: 'a1', agentName: 'Local Agent' }],
  keepRunning: [],
  disruptedBrowserTabs: [],
};

function getHandlers(channel: string): Array<(payload: unknown) => void> {
  return (window as any).electronAPI._getRegisteredHandlers(channel);
}

function emit(channel: string, payload: unknown) {
  for (const handler of getHandlers(channel)) handler(payload);
}

describe('quit-confirmation-service', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let onShow: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;
  let dispose: () => void;

  beforeEach(() => {
    invoke = (window as any).electronAPI.invoke;
    invoke.mockClear();
    // Drain handlers registered by previous installs (test-setup persists them).
    getHandlers(QUIT_CONFIRMATION_CHANNELS.SHOW).length = 0;
    getHandlers(QUIT_CONFIRMATION_CHANNELS.DISMISS).length = 0;
    onShow = vi.fn();
    onDismiss = vi.fn();
    dispose = installQuitConfirmationService({ onShow, onDismiss });
    return () => dispose();
  });

  it('acks immediately with the exact requestId and opens the modal on show', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, SHOW_PAYLOAD);

    expect(invoke).toHaveBeenCalledWith(QUIT_CONFIRMATION_CHANNELS.ACK, { requestId: 'req-1' });
    expect(onShow).toHaveBeenCalledExactlyOnceWith(SHOW_PAYLOAD);
  });

  it('sends the exact response payload once, and no-ops on repeat calls', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    respondToQuitConfirmation(true);
    respondToQuitConfirmation(false);

    expect(invoke).toHaveBeenCalledExactlyOnceWith(QUIT_CONFIRMATION_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      proceed: true,
    });
  });

  it('sends proceed: false for the cancel path', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    respondToQuitConfirmation(false);

    expect(invoke).toHaveBeenCalledExactlyOnceWith(QUIT_CONFIRMATION_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      proceed: false,
    });
  });

  it('dismiss for the active request closes the modal and drops the request', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    emit(QUIT_CONFIRMATION_CHANNELS.DISMISS, { requestId: 'req-1' });

    expect(onDismiss).toHaveBeenCalledOnce();
    respondToQuitConfirmation(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores dismiss for a stale requestId', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, SHOW_PAYLOAD);

    emit(QUIT_CONFIRMATION_CHANNELS.DISMISS, { requestId: 'other-req' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores malformed show payloads without acking', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, { nope: true });
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, undefined);

    expect(invoke).not.toHaveBeenCalled();
    expect(onShow).not.toHaveBeenCalled();
  });

  it('a later show supersedes the previous request', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, SHOW_PAYLOAD);
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, { ...SHOW_PAYLOAD, requestId: 'req-2' });
    invoke.mockClear();

    respondToQuitConfirmation(true);

    expect(invoke).toHaveBeenCalledExactlyOnceWith(QUIT_CONFIRMATION_CHANNELS.RESPONSE, {
      requestId: 'req-2',
      proceed: true,
    });
  });

  it('dispose removes listeners and clears the active request', () => {
    emit(QUIT_CONFIRMATION_CHANNELS.SHOW, SHOW_PAYLOAD);
    invoke.mockClear();

    dispose();
    respondToQuitConfirmation(true);

    expect(invoke).not.toHaveBeenCalled();
    expect((window as any).electronAPI.offById).toHaveBeenCalledWith(
      QUIT_CONFIRMATION_CHANNELS.SHOW,
      expect.any(String),
    );
    expect((window as any).electronAPI.offById).toHaveBeenCalledWith(
      QUIT_CONFIRMATION_CHANNELS.DISMISS,
      expect.any(String),
    );
  });
});
