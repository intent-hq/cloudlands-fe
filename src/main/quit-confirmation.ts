/**
 * Confirm quit only when it interrupts agents on the app-managed sidecar.
 * Browser tabs and agents on external daemons do not trigger confirmation.
 * Shared by normal quit and update installation; concurrent callers share
 * one renderer prompt, with a native fallback if the renderer is unavailable.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { MessageBoxOptions, MessageBoxReturnValue, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';

import type { ConnectionMode } from '../features/backend/main/connection-mode';
import { getConnectionMode } from '../features/backend/main/connection-mode';
import { QUIT_CONFIRMATION_CHANNELS } from '../shared/ipc/channels';
import type {
  QuitAgentSummary,
  QuitConfirmationShowPayload,
} from '../shared/ipc/quit-confirmation';
import { Logger } from '../shared/logger';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import { QuitConfirmationAckSchema, QuitConfirmationResponseSchema } from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import { buildQuitDialogOptions } from './quit-dialog';
import {
  listRespondingAgents,
  type RespondingAgent,
  type RunningAgentsRpc,
} from './running-agents';
import { getMainWindow } from './state';

const logger = new Logger('QuitConfirmation');

/**
 * Overall budget for the short-lived startup-backend probe opened when no
 * window owns a pooled local client — connect plus every RPC it makes. The
 * quit prompt must not stall behind an unreachable socket, so the probe is
 * raced against this deadline and fails open.
 */
const LOCAL_PROBE_TIMEOUT_MS = 2_000;

/**
 * How long main waits for the renderer to acknowledge `quit-confirmation:show`
 * (the modal invokes `quit-confirmation:ack` as soon as it mounts). No ack
 * within this window means the renderer cannot render the prompt — fall back
 * to the native dialog. The DECISION carries no timeout: once acked, the user
 * may take as long as they like.
 */
const RENDERER_ACK_TIMEOUT_MS = 3_000;

/** Injectable collaborators (defaults wire up the real main-process ones). */
interface QuitBackendTarget {
  id: string;
  client: RunningAgentsRpc;
}

export interface QuitConfirmationDeps {
  /** Live pooled backends that still own at least one window. */
  getBackendTargets(): QuitBackendTarget[];
  getConnectionMode(): ConnectionMode;
  listRespondingAgents(client: RunningAgentsRpc): Promise<RespondingAgent[]>;
  /** Best-effort responding agents on the startup/default backend, via a throwaway client. */
  listLocalRespondingAgents(): Promise<RespondingAgent[]>;
  /**
   * Renderer round-trip: show the modal in `parent` and resolve the user's
   * decision (true = proceed). Resolves null when the renderer path is
   * unavailable (no window, send failed, or no ack in time) — the caller then
   * falls back to the native dialog.
   */
  confirmViaRenderer(
    parent: BrowserWindow | null,
    payload: QuitConfirmationShowPayload,
  ): Promise<boolean | null>;
  /** Native fallback copy for the sidecar agents quitting interrupts. */
  buildQuitDialogOptions(interrupted: RespondingAgent[]): MessageBoxOptions;
  /** Window to parent the dialog to (focused window, else main window). */
  getParentWindow(): BrowserWindow | null;
  showMessageBox(
    parent: BrowserWindow | null,
    options: MessageBoxOptions,
  ): Promise<MessageBoxReturnValue>;
}

/**
 * Query the startup/default backend — the target `resolveBackendConfig` derives
 * from the environment, normally the local daemon — through a short-lived
 * JSON-RPC client, raced against {@link LOCAL_PROBE_TIMEOUT_MS} and disposed on
 * every exit path. Used when the managed sidecar is running but no pooled
 * local client owns a window (e.g. only remote windows are open).
 */
async function defaultListLocalRespondingAgents(): Promise<RespondingAgent[]> {
  const [{ app }, { JsonRpcClient }, { resolveBackendConfig }] = await Promise.all([
    import('electron'),
    import('../features/backend/main/json-rpc-client'),
    import('../features/backend/main/backend-connection'),
  ]);
  const client = new JsonRpcClient({
    config: resolveBackendConfig(process.env, { isDev: !app.isPackaged }),
    // No heartbeat: the client lives for exactly one check.
    heartbeatIntervalMs: 0,
    requestTimeoutMs: LOCAL_PROBE_TIMEOUT_MS,
  });
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    // One deadline over connect + both RPCs; Promise.race handles the loser's
    // rejection, so neither branch can surface as an unhandled rejection.
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(
        () => reject(new Error('backend probe timed out')),
        LOCAL_PROBE_TIMEOUT_MS,
      );
    });
    const probe = (async () => {
      await new Promise<void>((resolve, reject) => {
        client.on('status', (status: string) => {
          if (status === 'connected') resolve();
        });
        client.on('error', reject);
        client.start();
      });
      return await listRespondingAgents(client);
    })();
    return await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(deadlineTimer);
    client.dispose();
  }
}

function defaultGetParentWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const main = getMainWindow();
  if (main && !main.isDestroyed()) return main;
  return null;
}

function defaultShowMessageBox(
  parent: BrowserWindow | null,
  options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

/** The renderer decision (or ack failure) for the request main is waiting on. */
interface PendingRendererRequest {
  requestId: string;
  acked: boolean;
  ack: () => void;
  settle: (proceed: boolean) => void;
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
    QUIT_CONFIRMATION_CHANNELS.ACK,
    createValidatedHandler(
      QuitConfirmationAckSchema,
      async (_event, payload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          pendingRendererRequest.acked = true;
          pendingRendererRequest.ack();
        }
        return { success: true };
      },
      QUIT_CONFIRMATION_CHANNELS.ACK,
    ),
  );
  ipcMain.handle(
    QUIT_CONFIRMATION_CHANNELS.RESPONSE,
    createValidatedHandler(
      QuitConfirmationResponseSchema,
      async (_event, payload) => {
        if (pendingRendererRequest?.requestId === payload.requestId) {
          // A valid response proves the modal mounted — treat it as an
          // implicit ack so a lost/rejected ack invoke cannot let the ack
          // timeout fire and show the native dialog over an answered modal.
          pendingRendererRequest.acked = true;
          pendingRendererRequest.ack();
          pendingRendererRequest.settle(payload.proceed);
        }
        return { success: true };
      },
      QUIT_CONFIRMATION_CHANNELS.RESPONSE,
    ),
  );
}

/** Test-only: forget the in-flight confirmation and renderer request. */
export function resetQuitConfirmationStateForTests(): void {
  pendingRendererRequest = null;
  inFlightConfirmation = null;
}

/**
 * Default renderer round-trip. Sends `quit-confirmation:show` to the parent
 * window and waits for the modal to ack, then for the decision. Every
 * unavailable-renderer path resolves null (fail open to the native dialog):
 * no live window, `send` throwing, no ack within
 * {@link RENDERER_ACK_TIMEOUT_MS} — in which case a dismiss is sent so a
 * late-mounting modal does not linger — or the renderer dying at any point
 * (webContents destroyed, render process gone, or a main-frame navigation
 * that wipes the modal). Without the death watch, a post-ack crash/reload
 * would leave the decision promise unsettled forever and the memoized
 * in-flight confirmation would wedge every subsequent quit attempt.
 */
async function defaultConfirmViaRenderer(
  parent: BrowserWindow | null,
  payload: QuitConfirmationShowPayload,
): Promise<boolean | null> {
  if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed()) {
    return null;
  }
  registerRendererHandlers();

  let ackReceived!: () => void;
  const acked = new Promise<void>((resolve) => {
    ackReceived = resolve;
  });
  let settle!: (proceed: boolean) => void;
  const decision = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const request: PendingRendererRequest = {
    requestId: payload.requestId,
    acked: false,
    ack: ackReceived,
    settle,
  };
  pendingRendererRequest = request;

  const contents = parent.webContents;
  // The modal lives in this webContents: destruction, a renderer crash, or a
  // main-frame navigation (reload included) all destroy it, so any of them
  // settles the wait and falls back to the native dialog.
  let rendererGone!: () => void;
  const gone = new Promise<'gone'>((resolve) => {
    rendererGone = () => resolve('gone');
  });
  contents.once('destroyed', rendererGone);
  contents.once('render-process-gone', rendererGone);
  contents.once('did-navigate', rendererGone);

  try {
    contents.send(QUIT_CONFIRMATION_CHANNELS.SHOW, payload);
  } catch (error) {
    logger.warn('Failed to send quit confirmation to renderer; using native dialog', {
      error: error instanceof Error ? error.message : String(error),
    });
    pendingRendererRequest = null;
    removeRendererGoneListeners(contents, rendererGone);
    return null;
  }

  let ackTimer: ReturnType<typeof setTimeout> | undefined;
  const ackTimeout = new Promise<'timeout'>((resolve) => {
    ackTimer = setTimeout(() => resolve('timeout'), RENDERER_ACK_TIMEOUT_MS);
  });
  try {
    const ackOutcome = await Promise.race([acked.then(() => 'acked' as const), ackTimeout, gone]);
    if (ackOutcome === 'gone') {
      logger.warn(
        'Renderer went away before acknowledging quit confirmation; using native dialog',
        {
          requestId: payload.requestId,
        },
      );
      return null;
    }
    if (ackOutcome === 'timeout') {
      logger.warn('Renderer did not acknowledge quit confirmation; using native dialog', {
        requestId: payload.requestId,
        timeoutMs: RENDERER_ACK_TIMEOUT_MS,
      });
      // Close a modal that mounts late for this now-abandoned request.
      try {
        if (!parent.isDestroyed() && !contents.isDestroyed()) {
          contents.send(QUIT_CONFIRMATION_CHANNELS.DISMISS, {
            requestId: payload.requestId,
          });
        }
      } catch {
        // The window is going away; nothing to dismiss.
      }
      return null;
    }
    // Acked: the modal is up — wait for the user, however long they take,
    // but settle if the renderer dies (crash/reload destroys the modal and
    // its state, so the decision would otherwise never arrive).
    const outcome = await Promise.race([decision.then((proceed) => ({ proceed })), gone]);
    if (outcome === 'gone') {
      logger.warn('Renderer went away while quit confirmation was open; using native dialog', {
        requestId: payload.requestId,
      });
      return null;
    }
    return outcome.proceed;
  } finally {
    clearTimeout(ackTimer);
    removeRendererGoneListeners(contents, rendererGone);
    if (pendingRendererRequest === request) pendingRendererRequest = null;
  }
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

/** Probe wrapper: any failure means "no agents from that backend", never a throw. */
async function listLocalAgentsFailOpen(deps: QuitConfirmationDeps): Promise<RespondingAgent[]> {
  try {
    return await deps.listLocalRespondingAgents();
  } catch (error) {
    logger.warn('Backend probe failed during quit check; assuming no agents there', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Project RespondingAgent rows into the wire summaries the renderer shows. */
function toAgentSummaries(agents: RespondingAgent[]): QuitAgentSummary[] {
  return agents.map((agent) => ({
    agentId: agent.agentId,
    agentName: agent.name,
    workspaceId: agent.workspaceId,
  }));
}

/**
 * Concurrent callers (before-quit racing the auto-updater) share one in-flight
 * confirmation instead of stacking prompts.
 */
let inFlightConfirmation: Promise<boolean> | null = null;

/**
 * Show the quit confirmation prompt for agents on the spawned sidecar.
 *
 * Returns true if the caller should proceed with quit/teardown (nothing
 * disrupted, or user confirmed), false if the user cancelled.
 */
export async function confirmQuitWithRunningAgents(
  overrides: Partial<QuitConfirmationDeps> = {},
): Promise<boolean> {
  if (inFlightConfirmation) return inFlightConfirmation;
  const run = confirmQuitInner(overrides).finally(() => {
    inFlightConfirmation = null;
  });
  inFlightConfirmation = run;
  return run;
}

async function confirmQuitInner(overrides: Partial<QuitConfirmationDeps>): Promise<boolean> {
  // Lazy so importing this module never pulls in the backend IPC chain
  // (JsonRpcClient, sidecar manager) — only invoking it does, and only when
  // the caller has not injected the backend-target seam.
  const backendIpc = overrides.getBackendTargets
    ? null
    : await import('../features/backend/main/backend.ipc');
  const deps: QuitConfirmationDeps = {
    getBackendTargets:
      overrides.getBackendTargets ??
      (() => {
        if (!backendIpc) return [];
        const seen = new Set<string>();
        const targets: QuitBackendTarget[] = [];
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed()) continue;
          const id = backendIpc.getBackendIdForIpcSender(window.webContents);
          if (seen.has(id)) continue;
          seen.add(id);
          const pooledClient = backendIpc.getBackendClientForConnection(id);
          if (pooledClient) targets.push({ id, client: pooledClient });
        }
        return targets;
      }),
    getConnectionMode,
    listRespondingAgents,
    listLocalRespondingAgents: defaultListLocalRespondingAgents,
    confirmViaRenderer: defaultConfirmViaRenderer,
    buildQuitDialogOptions,
    getParentWindow: defaultGetParentWindow,
    showMessageBox: defaultShowMessageBox,
    ...overrides,
  };

  const targets = deps.getBackendTargets();
  // Only agents on the daemon quitting shuts down are interrupted: a remote
  // backend and an adopted external local daemon both outlive the app, so
  // their agents are never queried. The spawned sidecar is asked through its
  // pooled client when a window still owns one, else through the throwaway
  // probe.
  const sidecarActive = deps.getConnectionMode() === 'sidecar';
  const localTarget = targets.find((target) => target.id === LOCAL_CONNECTION_ID);
  const interrupted = !sidecarActive
    ? []
    : localTarget
      ? await deps.listRespondingAgents(localTarget.client)
      : await listLocalAgentsFailOpen(deps);

  if (interrupted.length === 0) {
    return true;
  }

  logger.info('Disruptive quit attempt detected', {
    interrupted: interrupted.length,
    agentIds: interrupted.map((agent) => agent.agentId),
  });

  const parent = deps.getParentWindow();
  const payload: QuitConfirmationShowPayload = {
    requestId: randomUUID(),
    interrupted: toAgentSummaries(interrupted),
    disruptedBrowserTabs: [],
  };

  const rendererDecision = await deps.confirmViaRenderer(parent, payload);
  if (rendererDecision !== null) {
    logger.info(
      rendererDecision
        ? 'User confirmed quit despite running agents (renderer)'
        : 'User cancelled quit due to running agents (renderer)',
    );
    return rendererDecision;
  }

  const options = deps.buildQuitDialogOptions(interrupted);
  const result = await deps.showMessageBox(parent, options);

  if (result.response === 1) {
    logger.info('User cancelled quit from the native fallback dialog');
    return false;
  }

  logger.info('User confirmed quit from the native fallback dialog');
  return true;
}
