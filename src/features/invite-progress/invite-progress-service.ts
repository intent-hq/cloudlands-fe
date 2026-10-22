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
import { store as appStore } from '$store/renderer/store';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { Logger } from '$shared/logger';
import { electronAPI } from '$lib/client/live/backend-transport';
import { INVITE_PROGRESS_CHANNELS } from '$shared/ipc/channels';
import { syncCollaborationPolicy } from '../collaboration-auth/renderer/collaboration-auth.client';
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
  onRecoveryState?: (state: { busy: boolean; failed: boolean }) => void;
}

let activeRequestId: string | null = null;
let retryable = false;
let recovery: { requestId: string; busy: boolean; attempted: boolean } | null = null;
let handlers: InviteProgressHandlers | null = null;

function isProgressPayload(payload: unknown): payload is InviteProgressShowPayload {
  const candidate = payload as InviteProgressShowPayload | undefined;
  return (
    !!candidate &&
    typeof candidate.requestId === 'string' &&
    (candidate.phase === 'admission' ||
      candidate.phase === 'connecting' ||
      candidate.phase === 'opening')
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
    if (activeRequestId !== payload.requestId) {
      recovery = { requestId: payload.requestId, busy: false, attempted: false };
      handlers?.onRecoveryState?.({ busy: false, failed: false });
    }
    activeRequestId = payload.requestId;
    retryable = payload.phase === 'admission';
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
    // No preference mutation here: an already-enabled originating renderer can
    // acknowledge readiness after initial hydration without another user action.
    if (retryable && recovery && !recovery.attempted && multiplayerEnabled())
      void continueInvite(false);
  });

  const updateListenerId = api.on(INVITE_PROGRESS_CHANNELS.UPDATE, (payload: unknown) => {
    if (!isProgressPayload(payload)) {
      logger.warn('Ignoring malformed invite-progress update payload', {
        code: 'malformed-payload',
      });
      return;
    }
    if (activeRequestId === null || payload.requestId !== activeRequestId) return;
    retryable = payload.phase === 'admission';
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
  // Listeners now exist: main can replay an original admission dialog missed during startup.
  void syncCollaborationPolicy().catch(() => {});

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

/** Explicit positive action: persist SET true, then acknowledge this window's readiness. */
export async function retryInviteProgress(): Promise<void> {
  await continueInvite(true);
}

function multiplayerEnabled(): boolean {
  return selectLabsMultiplayerEnabled.select(appStore.state);
}

async function continueInvite(enable: boolean): Promise<void> {
  const api = electronAPI();
  const request = recovery;
  if (!api || !request || activeRequestId !== request.requestId || !retryable || request.busy)
    return;
  request.busy = true;
  request.attempted = true;
  const current = () => recovery === request && activeRequestId === request.requestId && retryable;
  handlers?.onRecoveryState?.({ busy: true, failed: false });
  let failed = false;
  try {
    if (enable) {
      // The canonical preference action and its root-owned saga perform the
      // synchronous localStorage write. Read back its result: that saga deliberately
      // swallows storage errors, so dispatch alone is not proof of persistence.
      appStore.dispatch(setLabsMultiplayerEnabled(true));
      if (safeLocalStorage.getJSON('labs:multiplayerEnabled') !== true)
        throw new Error('persistence-failed');
    }
    // Let the main show call finish installing its handle before policy can replay it.
    await Promise.resolve();
    if (!current()) return;
    if (!(await syncCollaborationPolicy())) throw new Error('policy-failed');
    if (!current()) return;
    if (!multiplayerEnabled()) throw new Error('readiness-changed');
    await api.invoke(INVITE_PROGRESS_CHANNELS.RESPONSE, {
      requestId: request.requestId,
      action: 'retry',
    });
  } catch {
    failed = true;
  } finally {
    request.busy = false;
    if (current()) handlers?.onRecoveryState?.({ busy: false, failed });
  }
}
