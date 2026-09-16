/**
 * Renderer-rendered invite consent prompt for the main process.
 *
 * The `intent://invite` join (`features/deeplink/main/invite-deep-link.ts`)
 * asks the user to confirm their GitHub identity with a device code. This
 * module drives that prompt as a renderer modal over the `invite-consent:*`
 * channels (contract in `src/shared/ipc/invite-consent.ts`), modelled on
 * `quit-confirmation.ts`:
 *
 *   show → ack within {@link RENDERER_ACK_TIMEOUT_MS} → response → dismiss.
 *
 * The round-trip is fail-open: no live window, `send` throwing, no ack in
 * time, or the renderer dying before it answers all resolve the decision to
 * `null`, and the caller shows the existing native message box instead — so a
 * cold start from a link never hangs. Once acked, main waits indefinitely for
 * the decision. After `open` the modal stays up in a waiting state; a later
 * `cancel` settles {@link InviteConsentPrompt.cancelledWhileWaiting} so the
 * caller can abort the grant wait. Nothing secret crosses this boundary: the
 * payload carries the user code, the (already allowlisted) verification URL
 * and display labels only.
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { WebContents } from 'electron';

import { INVITE_CONSENT_CHANNELS } from '../shared/ipc/channels';
import type {
  InviteConsentAckPayload,
  InviteConsentAction,
  InviteConsentDismissPayload,
  InviteConsentOutcome,
  InviteConsentResponsePayload,
  InviteConsentShowPayload,
} from '../shared/ipc/invite-consent';
import { Logger } from '../shared/logger';
import { InviteConsentAckSchema, InviteConsentResponseSchema } from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import { getMainWindow } from './state';

const logger = new Logger('InviteConsent');

/**
 * How long main waits for the renderer to acknowledge `invite-consent:show`.
 * No ack within this window means the renderer cannot render the prompt (cold
 * start, no window yet, broken renderer) — fall back to the native dialog.
 */
const RENDERER_ACK_TIMEOUT_MS = 3_000;

/** A live consent request as seen from the caller. */
export interface InviteConsentPrompt {
  /**
   * The user's first decision: `open` / `cancel`, or `null` when the renderer
   * path is unavailable and the caller must show the native dialog instead.
   */
  readonly decision: Promise<InviteConsentAction | null>;
  /**
   * Settles when the user cancels from the waiting state (after `open`).
   * Never settles on any other path; race it against the grant wait.
   */
  readonly cancelledWhileWaiting: Promise<void>;
  /** Close the modal with the request's outcome; idempotent and safe after fallback. */
  dismiss(outcome: InviteConsentOutcome): void;
}

/** Injectable collaborators (defaults wire up the real main-process ones). */
export interface InviteConsentDeps {
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
  respond: (action: InviteConsentAction) => void;
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
    INVITE_CONSENT_CHANNELS.ACK,
    createValidatedHandler(
      InviteConsentAckSchema,
      async (_event, payload: InviteConsentAckPayload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          pendingRendererRequest.ack();
        }
        return { success: true };
      },
      INVITE_CONSENT_CHANNELS.ACK,
    ),
  );
  ipcMain.handle(
    INVITE_CONSENT_CHANNELS.RESPONSE,
    createValidatedHandler(
      InviteConsentResponseSchema,
      async (_event, payload: InviteConsentResponsePayload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          // A valid response proves the modal mounted — treat it as an
          // implicit ack so a lost ack invoke cannot let the timeout fire and
          // show the native dialog over an answered modal.
          pendingRendererRequest.ack();
          pendingRendererRequest.respond(payload.action);
        }
        return { success: true };
      },
      INVITE_CONSENT_CHANNELS.RESPONSE,
    ),
  );
}

/** Test-only: forget the renderer request main is waiting on. */
export function resetInviteConsentStateForTests(): void {
  pendingRendererRequest = null;
}

/** A prompt whose renderer path is unavailable: null decision, inert otherwise. */
const UNAVAILABLE_PROMPT: InviteConsentPrompt = {
  decision: Promise.resolve(null),
  cancelledWhileWaiting: new Promise<void>(() => {}),
  dismiss() {},
};

/**
 * Show the invite consent modal in the focused/main window. Returns
 * immediately with the request handle; `decision` resolves once the renderer
 * answers (or `null` on every unavailable-renderer path — no window, `send`
 * throwing, no ack within {@link RENDERER_ACK_TIMEOUT_MS} (a dismiss is sent
 * so a late-mounting modal does not linger), or the renderer dying before it
 * answers). After `open`, the request stays live so a `cancel` from the
 * waiting state reaches `cancelledWhileWaiting`; the caller ends it with
 * `dismiss`. Renderer death after `open` only silences the request — the
 * join itself is not the renderer's to keep alive.
 */
export function showInviteConsent(
  payload: InviteConsentShowPayload,
  overrides: Partial<InviteConsentDeps> = {},
): InviteConsentPrompt {
  const deps: InviteConsentDeps = { getParentWindow: defaultGetParentWindow, ...overrides };
  const parent = deps.getParentWindow();
  if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed()) {
    logger.info('No window for the invite consent modal; using native dialog', {
      requestId: payload.requestId,
    });
    return UNAVAILABLE_PROMPT;
  }
  registerRendererHandlers();
  const contents = parent.webContents;

  let ackReceived!: () => void;
  const acked = new Promise<void>((resolve) => {
    ackReceived = resolve;
  });
  let decided = false;
  let settleFirst!: (action: InviteConsentAction) => void;
  const firstResponse = new Promise<InviteConsentAction>((resolve) => {
    settleFirst = resolve;
  });
  let settleCancelledWhileWaiting!: () => void;
  const cancelledWhileWaiting = new Promise<void>((resolve) => {
    settleCancelledWhileWaiting = resolve;
  });
  const request: PendingRendererRequest = {
    requestId: payload.requestId,
    ack: ackReceived,
    respond: (action) => {
      if (!decided) {
        decided = true;
        settleFirst(action);
      } else if (action === 'cancel') {
        settleCancelledWhileWaiting();
      }
    },
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

  const dismiss = (outcome: InviteConsentOutcome): void => {
    if (ended) return;
    abandon();
    try {
      if (!parent.isDestroyed() && !contents.isDestroyed()) {
        const dismissPayload: InviteConsentDismissPayload = {
          requestId: payload.requestId,
          outcome,
        };
        contents.send(INVITE_CONSENT_CHANNELS.DISMISS, dismissPayload);
      }
    } catch {
      // The window is going away; nothing to dismiss.
    }
  };

  const decision = (async (): Promise<InviteConsentAction | null> => {
    try {
      contents.send(INVITE_CONSENT_CHANNELS.SHOW, payload);
    } catch (error) {
      logger.warn('Failed to send invite consent to renderer; using native dialog', {
        error: error instanceof Error ? error.message : String(error),
      });
      abandon();
      return null;
    }

    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const ackTimeout = new Promise<'timeout'>((resolve) => {
      ackTimer = setTimeout(() => resolve('timeout'), RENDERER_ACK_TIMEOUT_MS);
    });
    try {
      const ackOutcome = await Promise.race([acked.then(() => 'acked' as const), ackTimeout, gone]);
      if (ackOutcome === 'gone') {
        logger.warn('Renderer went away before acknowledging invite consent; using native dialog', {
          requestId: payload.requestId,
        });
        return null;
      }
      if (ackOutcome === 'timeout') {
        logger.warn('Renderer did not acknowledge invite consent; using native dialog', {
          requestId: payload.requestId,
          timeoutMs: RENDERER_ACK_TIMEOUT_MS,
        });
        // Close a modal that mounts late for this now-abandoned request.
        dismiss('cancelled');
        return null;
      }
      // Acked: the modal is up — wait for the user, however long they take.
      const outcome = await Promise.race([firstResponse.then((action) => ({ action })), gone]);
      if (outcome === 'gone') {
        logger.warn('Renderer went away while invite consent was open; using native dialog', {
          requestId: payload.requestId,
        });
        return null;
      }
      return outcome.action;
    } finally {
      clearTimeout(ackTimer);
    }
  })();

  return { decision, cancelledWhileWaiting, dismiss };
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
