/**
 * Renderer side of the invite-notice round-trip.
 *
 * The main process (`src/main/invite-notice.ts`) sends `invite-notice:show`
 * to the focused/main window instead of opening a native message box for an
 * invite join's failure or plaintext-credential warning. This service
 * (installed once in the app shell, so any window can answer):
 *
 * 1. On `show`: immediately invokes `invite-notice:ack { requestId }` — main
 *    falls back to the native dialog if the ack does not arrive within a
 *    short window — then opens the modal via the installed show handler.
 * 2. On the user's acknowledgement: `acknowledgeInviteNotice()` invokes
 *    `invite-notice:response { requestId }` once and ends the request, so
 *    repeated close paths (OK + Escape) cannot double-send.
 * 3. On `invite-notice:dismiss`: closes the modal for the active request
 *    (main gave up waiting for the ack and used the native fallback).
 *
 * Payload contract: `src/shared/ipc/invite-notice.ts`.
 */
import { Logger } from '$shared/logger';
import { electronAPI } from '$lib/client/live/backend-transport';
import { INVITE_NOTICE_CHANNELS } from '$shared/ipc/channels';
import type {
  InviteNoticeAckPayload,
  InviteNoticeDismissPayload,
  InviteNoticeResponsePayload,
  InviteNoticeShowPayload,
} from '$shared/ipc/invite-notice';

const logger = new Logger('InviteNoticeService');

/** Handlers wiring the service to the app-shell modal state. */
export interface InviteNoticeHandlers {
  /** Open the modal with the request payload. */
  onShow: (payload: InviteNoticeShowPayload) => void;
  /** Close the modal (request superseded by main). */
  onDismiss: () => void;
}

let activeRequestId: string | null = null;
let handlers: InviteNoticeHandlers | null = null;

/**
 * Install the invite-notice service. Call once at app boot.
 *
 * @returns Disposer function
 */
export function installInviteNoticeService(newHandlers: InviteNoticeHandlers): () => void {
  handlers = newHandlers;

  const api = electronAPI();
  if (!api) {
    logger.warn('No electron API available, invite-notice service disabled');
    return () => {};
  }

  const showListenerId = api.on(INVITE_NOTICE_CHANNELS.SHOW, (payload: unknown) => {
    const show = payload as InviteNoticeShowPayload | undefined;
    if (!show || typeof show.requestId !== 'string') {
      // Bounded logging: never echo the payload itself.
      logger.warn('Ignoring malformed invite-notice show payload', { code: 'malformed-payload' });
      return;
    }
    activeRequestId = show.requestId;
    // Ack immediately: main only waits a short window for it before falling
    // back to the native dialog. Never gate it on the modal rendering.
    const ack: InviteNoticeAckPayload = { requestId: show.requestId };
    void api.invoke(INVITE_NOTICE_CHANNELS.ACK, ack).catch(() => {
      logger.warn('Failed to ack invite-notice request', {
        code: 'ack-rejected',
        requestId: show.requestId,
        kind: show.kind,
      });
    });
    logger.info('Invite-notice request received', { requestId: show.requestId, kind: show.kind });
    handlers?.onShow(show);
  });

  const dismissListenerId = api.on(INVITE_NOTICE_CHANNELS.DISMISS, (payload: unknown) => {
    const dismiss = payload as InviteNoticeDismissPayload | undefined;
    if (!dismiss || dismiss.requestId !== activeRequestId || activeRequestId === null) return;
    logger.info('Invite-notice request dismissed by main', { requestId: activeRequestId });
    activeRequestId = null;
    handlers?.onDismiss();
  });

  logger.info('Invite-notice service installed');

  return () => {
    api.offById(INVITE_NOTICE_CHANNELS.SHOW, showListenerId);
    api.offById(INVITE_NOTICE_CHANNELS.DISMISS, dismissListenerId);
    handlers = null;
    activeRequestId = null;
    logger.info('Invite-notice service disposed');
  };
}

/**
 * Send the user's acknowledgement for the active request and end it. No-ops
 * when there is no active request (already acknowledged, dismissed, or never
 * shown), so OK + Escape cannot double-send.
 */
export function acknowledgeInviteNotice(): void {
  const api = electronAPI();
  if (!api || activeRequestId === null) return;
  const requestId = activeRequestId;
  activeRequestId = null;
  logger.info('Sending invite-notice acknowledgement', { requestId });
  const response: InviteNoticeResponsePayload = { requestId };
  void api.invoke(INVITE_NOTICE_CHANNELS.RESPONSE, response).catch(() => {
    logger.error('Failed to send invite-notice response', { code: 'response-rejected', requestId });
  });
}
