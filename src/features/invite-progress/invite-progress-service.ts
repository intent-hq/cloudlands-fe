/**
 * Renderer side of the invite-progress round-trip.
 *
 * The main process (`src/main/invite-progress.ts`) sends `invite-progress:show`
 * to the focused/main window during the silent phases of an `intent://invite`
 * join. This service (installed once in the app shell, so any window can
 * answer):
 *
 * 1. On `show`: immediately invokes `invite-progress:ack { requestId }` — main
 *    gives up on the dialog (and dismisses it) if the ack does not arrive
 *    within a short window — then opens the modal via the installed handler.
 * 2. On `update`: forwards the new phase / labels for the active request to
 *    the installed update handler; updates for any other request are ignored.
 * 3. On the user's Cancel: `cancelInviteProgress()` invokes
 *    `invite-progress:response { requestId, action: 'cancel' }` once and ends
 *    the request, so repeated cancel paths (button + Escape + backdrop) cannot
 *    double-send.
 * 4. On `invite-progress:dismiss`: closes the modal for the active request
 *    (its phase ended, or main gave up waiting for the ack).
 *
 * Payload contract: `src/shared/ipc/invite-progress.ts`.
 */
import { Logger } from '$shared/logger';
import { electronAPI } from '$lib/client/live/backend-transport';
import { INVITE_PROGRESS_CHANNELS } from '$shared/ipc/channels';
import type {
  InviteProgressAckPayload,
  InviteProgressDismissPayload,
  InviteProgressResponsePayload,
  InviteProgressShowPayload,
  InviteProgressUpdatePayload,
} from '$shared/ipc/invite-progress';

const logger = new Logger('InviteProgressService');

/** Handlers wiring the service to the app-shell modal state. */
export interface InviteProgressHandlers {
  /** Open the modal with the request payload. */
  onShow: (payload: InviteProgressShowPayload) => void;
  /** Re-render the open modal with the new phase / labels of the same request. */
  onUpdate: (payload: InviteProgressUpdatePayload) => void;
  /** Close the modal (request finished or superseded by main). */
  onDismiss: () => void;
}

let activeRequestId: string | null = null;
let handlers: InviteProgressHandlers | null = null;

function isProgressPayload(payload: unknown): payload is InviteProgressShowPayload {
  const candidate = payload as InviteProgressShowPayload | undefined;
  return (
    !!candidate &&
    typeof candidate.requestId === 'string' &&
    (candidate.phase === 'connecting' || candidate.phase === 'opening')
  );
}

/**
 * Install the invite-progress service. Call once at app boot.
 *
 * @returns Disposer function
 */
export function installInviteProgressService(newHandlers: InviteProgressHandlers): () => void {
  handlers = newHandlers;

  const api = electronAPI();
  if (!api) {
    logger.warn('No electron API available, invite-progress service disabled');
    return () => {};
  }

  const showListenerId = api.on(INVITE_PROGRESS_CHANNELS.SHOW, (payload: unknown) => {
    if (!isProgressPayload(payload)) {
      // Bounded logging: never echo the payload itself.
      logger.warn('Ignoring malformed invite-progress show payload', {
        code: 'malformed-payload',
      });
      return;
    }
    activeRequestId = payload.requestId;
    // Ack immediately: main only waits a short window for it before giving up
    // on the dialog. Never gate it on the modal rendering.
    const ack: InviteProgressAckPayload = { requestId: payload.requestId };
    void api.invoke(INVITE_PROGRESS_CHANNELS.ACK, ack).catch(() => {
      logger.warn('Failed to ack invite-progress request', {
        code: 'ack-rejected',
        requestId: payload.requestId,
        phase: payload.phase,
      });
    });
    logger.info('Invite-progress request received', {
      requestId: payload.requestId,
      phase: payload.phase,
    });
    handlers?.onShow(payload);
  });

  const updateListenerId = api.on(INVITE_PROGRESS_CHANNELS.UPDATE, (payload: unknown) => {
    if (!isProgressPayload(payload)) {
      logger.warn('Ignoring malformed invite-progress update payload', {
        code: 'malformed-payload',
      });
      return;
    }
    if (activeRequestId === null || payload.requestId !== activeRequestId) return;
    logger.info('Invite-progress request updated', {
      requestId: payload.requestId,
      phase: payload.phase,
    });
    handlers?.onUpdate(payload);
  });

  const dismissListenerId = api.on(INVITE_PROGRESS_CHANNELS.DISMISS, (payload: unknown) => {
    const dismiss = payload as InviteProgressDismissPayload | undefined;
    if (!dismiss || activeRequestId === null || dismiss.requestId !== activeRequestId) return;
    logger.info('Invite-progress request dismissed by main', { requestId: activeRequestId });
    activeRequestId = null;
    handlers?.onDismiss();
  });

  logger.info('Invite-progress service installed');

  return () => {
    api.offById(INVITE_PROGRESS_CHANNELS.SHOW, showListenerId);
    api.offById(INVITE_PROGRESS_CHANNELS.UPDATE, updateListenerId);
    api.offById(INVITE_PROGRESS_CHANNELS.DISMISS, dismissListenerId);
    handlers = null;
    activeRequestId = null;
    logger.info('Invite-progress service disposed');
  };
}

/**
 * Send the user's Cancel for the active request. No-ops when there is no
 * active request (already cancelled, dismissed, or never shown). Ends the
 * request, so it is sent at most once per request.
 */
export function cancelInviteProgress(): void {
  const api = electronAPI();
  if (!api || activeRequestId === null) return;
  const requestId = activeRequestId;
  activeRequestId = null;
  logger.info('Sending invite-progress cancel', { requestId });
  const response: InviteProgressResponsePayload = { requestId, action: 'cancel' };
  void api.invoke(INVITE_PROGRESS_CHANNELS.RESPONSE, response).catch(() => {
    logger.error('Failed to send invite-progress response', {
      code: 'response-rejected',
      requestId,
    });
  });
}
