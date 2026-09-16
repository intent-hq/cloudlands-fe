/**
 * Renderer side of the invite-consent round-trip.
 *
 * The main process (`src/main/invite-consent.ts`) sends `invite-consent:show`
 * to the focused/main window instead of opening the native GitHub device-code
 * message box. This service (installed once in the app shell, so any window
 * can answer):
 *
 * 1. On `show`: immediately invokes `invite-consent:ack { requestId }` — main
 *    falls back to the native dialog if the ack does not arrive within a
 *    short window — then opens the modal via the installed show handler.
 * 2. On the user's decision: `respondToInviteConsent(action)` invokes
 *    `invite-consent:response { requestId, action }`. `open` keeps the request
 *    active (the modal enters its waiting state) so a later `cancel` still
 *    reaches main and aborts the join; `cancel` ends the request, so repeated
 *    cancel paths (button + Escape) cannot double-send.
 * 3. On `invite-consent:dismiss`: closes the modal for the active request
 *    (main settled or superseded it, e.g. via the native fallback).
 *
 * Payload contract: `src/shared/ipc/invite-consent.ts`.
 */
import { Logger } from '$shared/logger';
import { electronAPI } from '$lib/client/live/backend-transport';
import { INVITE_CONSENT_CHANNELS } from '$shared/ipc/channels';
import type {
  InviteConsentAckPayload,
  InviteConsentAction,
  InviteConsentDismissPayload,
  InviteConsentResponsePayload,
  InviteConsentShowPayload,
} from '$shared/ipc/invite-consent';

const logger = new Logger('InviteConsentService');

/** Handlers wiring the service to the app-shell modal state. */
export interface InviteConsentHandlers {
  /** Open the modal with the request payload. */
  onShow: (payload: InviteConsentShowPayload) => void;
  /** Close the modal (request settled elsewhere or superseded). */
  onDismiss: () => void;
}

let activeRequestId: string | null = null;
let openSent = false;
let handlers: InviteConsentHandlers | null = null;

/**
 * Install the invite-consent service. Call once at app boot.
 *
 * @returns Disposer function
 */
export function installInviteConsentService(newHandlers: InviteConsentHandlers): () => void {
  handlers = newHandlers;

  const api = electronAPI();
  if (!api) {
    logger.warn('No electron API available, invite-consent service disabled');
    return () => {};
  }

  const showListenerId = api.on(INVITE_CONSENT_CHANNELS.SHOW, (payload: unknown) => {
    const show = payload as InviteConsentShowPayload | undefined;
    if (!show || typeof show.requestId !== 'string') {
      logger.warn('Ignoring malformed invite-consent show payload', { payload });
      return;
    }
    activeRequestId = show.requestId;
    openSent = false;
    // Ack immediately: main only waits a short window for it before falling
    // back to the native dialog. Never gate it on the modal rendering.
    const ack: InviteConsentAckPayload = { requestId: show.requestId };
    void api.invoke(INVITE_CONSENT_CHANNELS.ACK, ack).catch((error) => {
      logger.warn('Failed to ack invite-consent request', { error });
    });
    logger.info('Invite-consent request received', { requestId: show.requestId });
    handlers?.onShow(show);
  });

  const dismissListenerId = api.on(INVITE_CONSENT_CHANNELS.DISMISS, (payload: unknown) => {
    const dismiss = payload as InviteConsentDismissPayload | undefined;
    if (!dismiss || dismiss.requestId !== activeRequestId || activeRequestId === null) return;
    logger.info('Invite-consent request dismissed by main', {
      requestId: activeRequestId,
      outcome: dismiss.outcome,
    });
    activeRequestId = null;
    openSent = false;
    handlers?.onDismiss();
  });

  logger.info('Invite-consent service installed');

  return () => {
    api.offById(INVITE_CONSENT_CHANNELS.SHOW, showListenerId);
    api.offById(INVITE_CONSENT_CHANNELS.DISMISS, dismissListenerId);
    handlers = null;
    activeRequestId = null;
    openSent = false;
    logger.info('Invite-consent service disposed');
  };
}

/**
 * Send the user's decision for the active request. No-ops when there is no
 * active request (already cancelled, dismissed, or never shown). `open` is
 * sent at most once per request and keeps the request active so a `cancel`
 * from the waiting state still reaches main; `cancel` ends the request.
 */
export function respondToInviteConsent(action: InviteConsentAction): void {
  const api = electronAPI();
  if (!api || activeRequestId === null) return;
  if (action === 'open') {
    if (openSent) return;
    openSent = true;
  }
  const requestId = activeRequestId;
  if (action === 'cancel') {
    activeRequestId = null;
    openSent = false;
  }
  logger.info('Sending invite-consent response', { requestId, action });
  const response: InviteConsentResponsePayload = { requestId, action };
  void api.invoke(INVITE_CONSENT_CHANNELS.RESPONSE, response).catch((error) => {
    logger.error('Failed to send invite-consent response', { error });
  });
}
