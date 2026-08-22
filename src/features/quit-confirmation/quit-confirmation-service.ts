/**
 * Renderer side of the quit-confirmation round-trip.
 *
 * The main process (`src/main/quit-confirmation.ts`) sends
 * `quit-confirmation:show` to the focused/main window instead of opening a
 * native message box. This service (installed once in the app shell, so any
 * window can answer):
 *
 * 1. On `show`: immediately invokes `quit-confirmation:ack { requestId }` —
 *    main falls back to the native dialog if the ack does not arrive within
 *    a short window — then opens the modal via the installed show handler.
 * 2. On the user's decision: `respondToQuitConfirmation(proceed)` invokes
 *    `quit-confirmation:response { requestId, proceed }` exactly once per
 *    request (cancel/Escape/backdrop → `proceed: false`).
 * 3. On `quit-confirmation:dismiss`: closes the modal for the active request
 *    (main settled or superseded it, e.g. via the native fallback).
 *
 * Payload contract: `src/shared/ipc/quit-confirmation.ts`.
 */
import { Logger } from '$shared/logger';
import { electronAPI } from '$lib/client/live/backend-transport';
import { QUIT_CONFIRMATION_CHANNELS } from '$shared/ipc/channels';
import type {
  QuitConfirmationDismissPayload,
  QuitConfirmationShowPayload,
} from '$shared/ipc/quit-confirmation';

const logger = new Logger('QuitConfirmationService');

/** Handlers wiring the service to the app-shell modal state. */
export interface QuitConfirmationHandlers {
  /** Open the modal with the request payload. */
  onShow: (payload: QuitConfirmationShowPayload) => void;
  /** Close the modal (request settled elsewhere or superseded). */
  onDismiss: () => void;
}

let activeRequestId: string | null = null;
let handlers: QuitConfirmationHandlers | null = null;

/**
 * Install the quit-confirmation service. Call once at app boot.
 *
 * @returns Disposer function
 */
export function installQuitConfirmationService(newHandlers: QuitConfirmationHandlers): () => void {
  handlers = newHandlers;

  const api = electronAPI();
  if (!api) {
    logger.warn('No electron API available, quit-confirmation service disabled');
    return () => {};
  }

  const showListenerId = api.on(QUIT_CONFIRMATION_CHANNELS.SHOW, (payload: unknown) => {
    const show = payload as QuitConfirmationShowPayload | undefined;
    if (!show || typeof show.requestId !== 'string') {
      logger.warn('Ignoring malformed quit-confirmation show payload', { payload });
      return;
    }
    activeRequestId = show.requestId;
    // Ack immediately: main only waits a short window for it before falling
    // back to the native dialog. Never gate it on the modal rendering.
    void api.invoke(QUIT_CONFIRMATION_CHANNELS.ACK, { requestId: show.requestId }).catch((error) => {
      logger.warn('Failed to ack quit-confirmation request', { error });
    });
    logger.info('Quit-confirmation request received', { requestId: show.requestId });
    handlers?.onShow(show);
  });

  const dismissListenerId = api.on(QUIT_CONFIRMATION_CHANNELS.DISMISS, (payload: unknown) => {
    const dismiss = payload as QuitConfirmationDismissPayload | undefined;
    if (!dismiss || dismiss.requestId !== activeRequestId || activeRequestId === null) return;
    logger.info('Quit-confirmation request dismissed by main', { requestId: activeRequestId });
    activeRequestId = null;
    handlers?.onDismiss();
  });

  logger.info('Quit-confirmation service installed');

  return () => {
    api.offById(QUIT_CONFIRMATION_CHANNELS.SHOW, showListenerId);
    api.offById(QUIT_CONFIRMATION_CHANNELS.DISMISS, dismissListenerId);
    handlers = null;
    activeRequestId = null;
    logger.info('Quit-confirmation service disposed');
  };
}

/**
 * Send the user's decision for the active request. No-ops when there is no
 * active request (already responded, dismissed, or never shown), so repeated
 * cancel paths (button + Escape) cannot double-send.
 */
export function respondToQuitConfirmation(proceed: boolean): void {
  const api = electronAPI();
  if (!api || activeRequestId === null) return;
  const requestId = activeRequestId;
  activeRequestId = null;
  logger.info('Sending quit-confirmation response', { requestId, proceed });
  void api.invoke(QUIT_CONFIRMATION_CHANNELS.RESPONSE, { requestId, proceed }).catch((error) => {
    logger.error('Failed to send quit-confirmation response', { error });
  });
}
