/**
 * Renderer-rendered invite progress dialog for the main process.
 *
 * The `intent://invite` join (`features/deeplink/main/invite-deep-link.ts`)
 * has two silent phases — connecting to the host before the consent prompt
 * appears, and opening the guest window after the join is committed. This
 * module shows a progress dialog with a Cancel button for them as a renderer
 * modal over the `invite-progress:*` channels (contract in
 * `src/shared/ipc/invite-progress.ts`), modelled on `invite-consent.ts`:
 *
 *   show → ack within {@link RENDERER_ACK_TIMEOUT_MS} → (update)* → dismiss.
 *
 * There is no native fallback for progress: with no live window, `send`
 * throwing, no ack in time, or the renderer dying, the handle turns inert —
 * its `cancelled` never settles and `update` / `dismiss` do nothing — and the
 * join proceeds without progress UI. The renderer's `cancel` for the active
 * request settles {@link InviteProgressHandle.cancelled}; the caller decides
 * what cancelling means in its phase and ends the request with `dismiss()`.
 * Nothing secret crosses this boundary: payloads carry the phase and display
 * labels only — never the invite secret, the token, or a URL.
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { WebContents } from 'electron';

import { INVITE_PROGRESS_CHANNELS } from '../shared/ipc/channels';
import type {
  InviteProgressAckPayload,
  InviteProgressDismissPayload,
  InviteProgressPhase,
  InviteProgressResponsePayload,
  InviteProgressShowPayload,
  InviteProgressUpdatePayload,
} from '../shared/ipc/invite-progress';
import { Logger } from '../shared/logger';
import { InviteProgressAckSchema, InviteProgressResponseSchema } from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import { getMainWindow } from './state';

const logger = new Logger('InviteProgress');

/**
 * How long main waits for the renderer to acknowledge `invite-progress:show`.
 * No ack within this window means the renderer cannot render the dialog (cold
 * start, no window yet, broken renderer) — proceed without progress UI.
 */
const RENDERER_ACK_TIMEOUT_MS = 3_000;

/** Display labels a phase may carry (never the secret, token, or a URL). */
type InviteProgressLabels = Pick<InviteProgressShowPayload, 'hostLabel' | 'workspaceTitle'>;

/** A live progress request as seen from the caller. */
export interface InviteProgressHandle {
  /** Move the dialog to a new phase / labels; the `requestId` is kept. No-op once the request ended. */
  update(phase: InviteProgressPhase, labels?: InviteProgressLabels): void;
  /**
   * Settles when the user presses Cancel while this request is active. Never
   * settles on any unavailable-renderer path or after `dismiss()`.
   */
  readonly cancelled: Promise<void>;
  /** Close the dialog; idempotent and safe after every unavailable-renderer path. */
  dismiss(): void;
}

/** Injectable collaborators (defaults wire up the real main-process ones). */
export interface InviteProgressDeps {
  /** Window to show the dialog in (focused window, else main window). */
  getParentWindow(): BrowserWindow | null;
}

function defaultGetParentWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const main = getMainWindow();
  if (main && !main.isDestroyed()) return main;
  return null;
}

/** The renderer request main is currently showing. */
interface PendingRendererRequest {
  requestId: string;
  ack: () => void;
  cancel: () => void;
}

let pendingRendererRequest: PendingRendererRequest | null = null;
let rendererHandlersRegistered = false;

/**
 * Register the ack/response invoke handlers once. Payloads are Zod-validated;
 * requests for an unknown/stale requestId are ignored (the modal for a
 * finished request may still settle late).
 */
function registerRendererHandlers(): void {
  if (rendererHandlersRegistered) return;
  rendererHandlersRegistered = true;
  ipcMain.handle(
    INVITE_PROGRESS_CHANNELS.ACK,
    createValidatedHandler(
      InviteProgressAckSchema,
      async (_event, payload: InviteProgressAckPayload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          pendingRendererRequest.ack();
        }
        return { success: true };
      },
      INVITE_PROGRESS_CHANNELS.ACK,
    ),
  );
  ipcMain.handle(
    INVITE_PROGRESS_CHANNELS.RESPONSE,
    createValidatedHandler(
      InviteProgressResponseSchema,
      async (_event, payload: InviteProgressResponsePayload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          // A valid response proves the modal mounted — treat it as an
          // implicit ack so a lost ack invoke cannot abandon an answered modal.
          pendingRendererRequest.ack();
          pendingRendererRequest.cancel();
        }
        return { success: true };
      },
      INVITE_PROGRESS_CHANNELS.RESPONSE,
    ),
  );
}

/** Test-only: forget the renderer request main is showing. */
export function resetInviteProgressStateForTests(): void {
  pendingRendererRequest = null;
}

/** A handle whose renderer path is unavailable: never cancels, inert otherwise. */
const UNAVAILABLE_HANDLE: InviteProgressHandle = {
  update() {},
  cancelled: new Promise<void>(() => {}),
  dismiss() {},
};

/**
 * Show the invite progress dialog in the focused/main window. Returns
 * immediately with the request handle. On every unavailable-renderer path —
 * no window, `send` throwing, no ack within {@link RENDERER_ACK_TIMEOUT_MS}
 * (a dismiss is sent so a late-mounting modal does not linger), or the
 * renderer dying — the handle turns inert: `cancelled` never settles and
 * `update` / `dismiss` do nothing. Once acked, the request stays live until
 * the caller ends it with `dismiss()`; a `cancel` from the renderer in the
 * meantime settles `cancelled`.
 */
export function showInviteProgress(
  payload: InviteProgressShowPayload,
  overrides: Partial<InviteProgressDeps> = {},
): InviteProgressHandle {
  const deps: InviteProgressDeps = { getParentWindow: defaultGetParentWindow, ...overrides };
  const parent = deps.getParentWindow();
  if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed()) {
    logger.info('No window for the invite progress dialog; proceeding without it', {
      requestId: payload.requestId,
    });
    return UNAVAILABLE_HANDLE;
  }
  registerRendererHandlers();
  const contents = parent.webContents;
  const { requestId } = payload;

  let ackReceived!: () => void;
  const acked = new Promise<void>((resolve) => {
    ackReceived = resolve;
  });
  let settleCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    settleCancelled = resolve;
  });
  const request: PendingRendererRequest = {
    requestId,
    ack: ackReceived,
    cancel: settleCancelled,
  };
  pendingRendererRequest = request;

  // The modal lives in this webContents: destruction, a renderer crash, or a
  // main-frame navigation (reload included) all destroy it.
  let ended = false;
  /** Stop listening for this request; no further sends. */
  const abandon = (): void => {
    if (ended) return;
    ended = true;
    clearTimeout(ackTimer);
    removeRendererGoneListeners(contents, rendererGone);
    if (pendingRendererRequest === request) pendingRendererRequest = null;
  };
  const rendererGone = (): void => {
    if (ended) return;
    logger.warn('Renderer went away while the invite progress dialog was up', { requestId });
    abandon();
  };
  contents.once('destroyed', rendererGone);
  contents.once('render-process-gone', rendererGone);
  contents.once('did-navigate', rendererGone);

  const send = (channel: string, data: unknown): boolean => {
    try {
      if (parent.isDestroyed() || contents.isDestroyed()) return false;
      contents.send(channel, data);
      return true;
    } catch {
      // The window is going away; nothing left to show.
      return false;
    }
  };

  const sendDismiss = (): void => {
    const dismissPayload: InviteProgressDismissPayload = { requestId };
    send(INVITE_PROGRESS_CHANNELS.DISMISS, dismissPayload);
  };

  const dismiss = (): void => {
    if (ended) return;
    abandon();
    sendDismiss();
  };

  const update = (phase: InviteProgressPhase, labels: InviteProgressLabels = {}): void => {
    if (ended) return;
    const updatePayload: InviteProgressUpdatePayload = { ...labels, requestId, phase };
    send(INVITE_PROGRESS_CHANNELS.UPDATE, updatePayload);
  };

  // Armed before the show is sent so a failed send clears it via abandon().
  const ackTimer = setTimeout(() => {
    if (ended) return;
    logger.warn('Renderer did not acknowledge invite progress; proceeding without it', {
      requestId,
      timeoutMs: RENDERER_ACK_TIMEOUT_MS,
    });
    abandon();
    // Close a modal that mounts late for this now-abandoned request.
    sendDismiss();
  }, RENDERER_ACK_TIMEOUT_MS);
  void acked.then(() => clearTimeout(ackTimer));

  if (!send(INVITE_PROGRESS_CHANNELS.SHOW, payload)) {
    // Bounded fields only: the throw's text is Electron/library-authored
    // free-form text and stays out of the invite flow's logs.
    logger.warn('Failed to send invite progress to renderer; proceeding without it', {
      requestId,
      code: 'renderer-send-failed',
    });
    abandon();
    return UNAVAILABLE_HANDLE;
  }

  return { update, cancelled, dismiss };
}

/** Detach the renderer-death listeners; tolerate an already-destroyed target. */
function removeRendererGoneListeners(contents: WebContents, listener: () => void): void {
  try {
    contents.removeListener('destroyed', listener);
    contents.removeListener('render-process-gone', listener);
    contents.removeListener('did-navigate', listener);
  } catch {
    // Destroyed emitters can throw on removeListener; nothing left to detach.
  }
}
