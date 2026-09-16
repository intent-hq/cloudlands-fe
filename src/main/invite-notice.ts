/**
 * Renderer-rendered invite notice for the main process.
 *
 * The `intent://invite` join (`features/deeplink/main/invite-deep-link.ts`)
 * ends with a one-button notice on two paths: the join failed, or the
 * credential had to be stored in plaintext. This module shows that notice as a
 * renderer modal over the `invite-notice:*` channels (contract in
 * `src/shared/ipc/invite-notice.ts`), modelled on `invite-consent.ts`:
 *
 *   show → ack within {@link RENDERER_ACK_TIMEOUT_MS} → response.
 *
 * The round-trip is fail-open: no live window, `send` throwing, no ack in
 * time, or the renderer dying before the user acknowledges all resolve to
 * `false`, and the caller shows the existing native message box instead — so
 * a cold start from a link never loses the notice. Once acked, main waits
 * indefinitely for the acknowledgement. Nothing secret crosses this boundary:
 * the payload carries a bounded kind/reason and display labels only.
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { WebContents } from 'electron';

import { INVITE_NOTICE_CHANNELS } from '../shared/ipc/channels';
import type {
  InviteNoticeAckPayload,
  InviteNoticeDismissPayload,
  InviteNoticeResponsePayload,
  InviteNoticeShowPayload,
} from '../shared/ipc/invite-notice';
import { Logger } from '../shared/logger';
import { InviteNoticeAckSchema, InviteNoticeResponseSchema } from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import { getMainWindow } from './state';

const logger = new Logger('InviteNotice');

/**
 * How long main waits for the renderer to acknowledge `invite-notice:show`.
 * No ack within this window means the renderer cannot render the notice (cold
 * start, no window yet, broken renderer) — fall back to the native dialog.
 */
const RENDERER_ACK_TIMEOUT_MS = 3_000;

/** Injectable collaborators (defaults wire up the real main-process ones). */
export interface InviteNoticeDeps {
  /** Window to show the modal in (focused window, else main window). */
  getParentWindow(): BrowserWindow | null;
}

function defaultGetParentWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const main = getMainWindow();
  if (main && !main.isDestroyed()) return main;
  return null;
}

/** The renderer request main is currently waiting on. */
interface PendingRendererRequest {
  requestId: string;
  ack: () => void;
  acknowledge: () => void;
}

let pendingRendererRequest: PendingRendererRequest | null = null;
let rendererHandlersRegistered = false;

/**
 * Register the ack/response invoke handlers once. Payloads are Zod-validated;
 * requests for an unknown/stale requestId are ignored (the modal for a
 * superseded request may still settle late).
 */
function registerRendererHandlers(): void {
  if (rendererHandlersRegistered) return;
  rendererHandlersRegistered = true;
  ipcMain.handle(
    INVITE_NOTICE_CHANNELS.ACK,
    createValidatedHandler(
      InviteNoticeAckSchema,
      async (_event, payload: InviteNoticeAckPayload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          pendingRendererRequest.ack();
        }
        return { success: true };
      },
      INVITE_NOTICE_CHANNELS.ACK,
    ),
  );
  ipcMain.handle(
    INVITE_NOTICE_CHANNELS.RESPONSE,
    createValidatedHandler(
      InviteNoticeResponseSchema,
      async (_event, payload: InviteNoticeResponsePayload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          // A valid response proves the modal mounted — treat it as an
          // implicit ack so a lost ack invoke cannot let the timeout fire and
          // show the native dialog over an answered modal.
          pendingRendererRequest.ack();
          pendingRendererRequest.acknowledge();
        }
        return { success: true };
      },
      INVITE_NOTICE_CHANNELS.RESPONSE,
    ),
  );
}

/** Test-only: forget the renderer request main is waiting on. */
export function resetInviteNoticeStateForTests(): void {
  pendingRendererRequest = null;
}

/**
 * Show the invite notice modal in the focused/main window. The show message
 * is sent synchronously (before this returns its promise), so a caller can
 * dismiss a modal that is still up afterwards without a frame in between.
 * Resolves `true` once the user acknowledged the renderer modal, and `false`
 * on every unavailable-renderer path — no window, `send` throwing, no ack
 * within {@link RENDERER_ACK_TIMEOUT_MS} (a dismiss is sent so a late-mounting
 * modal does not linger), or the renderer dying before it answers — in which
 * case the caller shows the native dialog instead.
 */
export function showInviteNotice(
  payload: InviteNoticeShowPayload,
  overrides: Partial<InviteNoticeDeps> = {},
): Promise<boolean> {
  const deps: InviteNoticeDeps = { getParentWindow: defaultGetParentWindow, ...overrides };
  const parent = deps.getParentWindow();
  if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed()) {
    logger.info('No window for the invite notice modal; using native dialog', {
      requestId: payload.requestId,
      kind: payload.kind,
    });
    return Promise.resolve(false);
  }
  registerRendererHandlers();
  const contents = parent.webContents;

  let ackReceived!: () => void;
  const acked = new Promise<void>((resolve) => {
    ackReceived = resolve;
  });
  let settleAcknowledged!: () => void;
  const acknowledged = new Promise<void>((resolve) => {
    settleAcknowledged = resolve;
  });
  const request: PendingRendererRequest = {
    requestId: payload.requestId,
    ack: ackReceived,
    acknowledge: settleAcknowledged,
  };
  pendingRendererRequest = request;

  // The modal lives in this webContents: destruction, a renderer crash, or a
  // main-frame navigation (reload included) all destroy it.
  let rendererGone!: () => void;
  let ended = false;
  /** Stop listening for this request; no further sends. */
  const abandon = (): void => {
    if (ended) return;
    ended = true;
    removeRendererGoneListeners(contents, rendererGone);
    if (pendingRendererRequest === request) pendingRendererRequest = null;
  };
  const gone = new Promise<'gone'>((resolve) => {
    rendererGone = () => {
      abandon();
      resolve('gone');
    };
  });
  contents.once('destroyed', rendererGone);
  contents.once('render-process-gone', rendererGone);
  contents.once('did-navigate', rendererGone);

  const dismiss = (): void => {
    if (ended) return;
    abandon();
    try {
      if (!parent.isDestroyed() && !contents.isDestroyed()) {
        const dismissPayload: InviteNoticeDismissPayload = { requestId: payload.requestId };
        contents.send(INVITE_NOTICE_CHANNELS.DISMISS, dismissPayload);
      }
    } catch {
      // The window is going away; nothing to dismiss.
    }
  };

  try {
    contents.send(INVITE_NOTICE_CHANNELS.SHOW, payload);
  } catch {
    // Bounded fields only: the throw's text is Electron/library-authored
    // free-form text and stays out of the invite flow's logs.
    logger.warn('Failed to send invite notice to renderer; using native dialog', {
      requestId: payload.requestId,
      code: 'renderer-send-failed',
    });
    abandon();
    return Promise.resolve(false);
  }

  return (async (): Promise<boolean> => {
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const ackTimeout = new Promise<'timeout'>((resolve) => {
      ackTimer = setTimeout(() => resolve('timeout'), RENDERER_ACK_TIMEOUT_MS);
    });
    try {
      const ackOutcome = await Promise.race([acked.then(() => 'acked' as const), ackTimeout, gone]);
      if (ackOutcome === 'gone') {
        logger.warn('Renderer went away before acknowledging invite notice; using native dialog', {
          requestId: payload.requestId,
        });
        return false;
      }
      if (ackOutcome === 'timeout') {
        logger.warn('Renderer did not acknowledge invite notice; using native dialog', {
          requestId: payload.requestId,
          timeoutMs: RENDERER_ACK_TIMEOUT_MS,
        });
        // Close a modal that mounts late for this now-abandoned request.
        dismiss();
        return false;
      }
      // Acked: the modal is up — wait for the user, however long they take.
      const outcome = await Promise.race([acknowledged.then(() => 'acknowledged' as const), gone]);
      if (outcome === 'gone') {
        logger.warn('Renderer went away while invite notice was open; using native dialog', {
          requestId: payload.requestId,
        });
        return false;
      }
      abandon();
      return true;
    } finally {
      clearTimeout(ackTimer);
    }
  })();
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
