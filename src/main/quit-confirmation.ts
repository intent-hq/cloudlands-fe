/**
 * Running-agents quit confirmation for the main process.
 *
 * Shows the ownership-branched "agents are still working" prompt when a daemon
 * reports responding agents, and returns whether the caller should proceed
 * with quit/teardown. Shared by:
 *   - `before-quit` (Cmd+Q) and the non-macOS `window-all-closed` path in
 *     `src/main/index.ts`;
 *   - `AutoUpdateService.installUpdate()`, which must confirm BEFORE calling
 *     `autoUpdater.quitAndInstall()` — on macOS quitAndInstall closes all
 *     windows before `before-quit` fires, so prompting there is too late.
 *
 * The prompt renders in the RENDERER (a modal driven over the
 * `quit-confirmation:*` channels, contract in
 * `src/shared/ipc/quit-confirmation.ts`), enriched with the agent-owned
 * embedded browser tabs quitting would destroy — and shown whenever quitting
 * disrupts anything: responding agents OR agent-owned tabs (tabs alone
 * trigger the prompt too). The renderer round-trip is
 * fail-open: when no window is available, the renderer never acknowledges the
 * show request within {@link RENDERER_ACK_TIMEOUT_MS}, or sending fails, the
 * flow falls back to the native message box (quit-dialog.ts) so quit is never
 * blocked by a broken renderer. Once acknowledged, main waits indefinitely for
 * the user's decision — there is no timeout on a human — but renderer death
 * (webContents destroyed, render process gone, or a main-frame navigation
 * that wipes the modal) settles the wait and falls back to the native dialog,
 * so a crashed/reloaded renderer can never wedge quit. The tabs-only case
 * falls back to a dedicated native dialog (buildTabsOnlyQuitDialogOptions);
 * agent cases keep the existing agent copy.
 *
 * Re-entrancy: `before-quit` and the auto-updater can race into this at once;
 * concurrent calls share one in-flight confirmation instead of stacking
 * prompts.
 *
 * Live agent turns run inside the intentd daemon (agent.sendMessage, PROTOCOL
 * §5.5), so the daemon's per-agent `isResponding` flag is the source of truth
 * for "still running" (see running-agents.ts).
 *
 * Multiple daemons can be in play at once. Every live pooled backend with an
 * open window is queried, plus the local sidecar when it is still running.
 * Agents are grouped by whether quitting stops their daemon — remote agents and
 * agents on an adopted external local daemon keep running, while agents on our
 * spawned sidecar are interrupted (see quit-dialog.ts). The throwaway local
 * query is best effort, so a dead/absent daemon never blocks quit.
 *
 * Kept out of `src/main/index.ts` (heavy top-level side effects) so it is
 * unit-testable and importable from the auto-update service without a
 * circular import (index.ts imports auto-update.service.ts). Dependencies are
 * injectable for tests; `backend.ipc` and the embedded-browser service are
 * resolved lazily so importing this module stays dependency-light.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { MessageBoxOptions, MessageBoxReturnValue, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';

import type { ConnectionMode } from '../features/backend/main/connection-mode';
import { getConnectionMode } from '../features/backend/main/connection-mode';
import { QUIT_CONFIRMATION_CHANNELS } from '../shared/ipc/channels';
import type {
  QuitAgentSummary,
  QuitBrowserTabSummary,
  QuitConfirmationShowPayload,
} from '../shared/ipc/quit-confirmation';
import { Logger } from '../shared/logger';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import { QuitConfirmationAckSchema, QuitConfirmationResponseSchema } from './ipc-schemas';
import { createValidatedHandler } from './ipc-validation-middleware';
import {
  buildQuitDialogOptions,
  buildTabsOnlyQuitDialogOptions,
  type QuitAgentGroups,
} from './quit-dialog';
import {
  listRespondingAgents,
  type RespondingAgent,
  type RunningAgentsRpc,
} from './running-agents';
import { getMainWindow } from './state';

const logger = new Logger('QuitConfirmation');

/**
 * Overall budget for the short-lived startup-backend probe opened while a
 * remote backend is active — connect plus every RPC it makes. The quit prompt
 * must not stall behind an unreachable socket, so the probe is raced against
 * this deadline and fails open.
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
  /** Agent-owned embedded browser tabs that quitting destroys (best effort). */
  listDisruptedBrowserTabs(): Promise<QuitBrowserTabSummary[]>;
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
  buildQuitDialogOptions(groups: QuitAgentGroups): MessageBoxOptions;
  /** Native fallback copy when only browser tabs are disrupted (no agents). */
  buildTabsOnlyQuitDialogOptions(tabCount: number): MessageBoxOptions;
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
 * every exit path. Used when no pooled local client owns a window but a remote
 * window or managed sidecar means the local daemon remains relevant to quit.
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

/**
 * Enumerate agent-owned embedded browser tabs from the CDP service's
 * main-process state. Lazy import keeps this module dependency-light — the
 * service module registers ipcMain handlers on load, which real main already
 * did; tests inject this seam instead.
 */
async function defaultListDisruptedBrowserTabs(): Promise<QuitBrowserTabSummary[]> {
  const { embeddedBrowserCdp } =
    await import('../features/browser/main/embedded-browser-cdp-service');
  return embeddedBrowserCdp.listAgentOwnedTabs();
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

/** First occurrence per `agentId` wins; the two sources can resolve to one daemon. */
function dedupeByAgentId(agents: RespondingAgent[]): RespondingAgent[] {
  const seen = new Set<string>();
  return agents.filter((agent) => {
    if (seen.has(agent.agentId)) return false;
    seen.add(agent.agentId);
    return true;
  });
}

/** Tab enumeration wrapper: any failure means "no tab data", never a throw. */
async function listDisruptedTabsFailOpen(
  deps: QuitConfirmationDeps,
): Promise<QuitBrowserTabSummary[]> {
  try {
    return await deps.listDisruptedBrowserTabs();
  } catch (error) {
    logger.warn('Browser tab enumeration failed during quit check; omitting tab data', {
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

/** Annotate tab summaries with their owner's name when the owner is known. */
function withOwnerNames(
  tabs: QuitBrowserTabSummary[],
  agents: RespondingAgent[],
): QuitBrowserTabSummary[] {
  const namesById = new Map(agents.map((agent) => [agent.agentId, agent.name]));
  return tabs.map((tab) => {
    const ownerAgentName = namesById.get(tab.ownerAgentId);
    return ownerAgentName !== undefined ? { ...tab, ownerAgentName } : tab;
  });
}

/**
 * Concurrent callers (before-quit racing the auto-updater) share one in-flight
 * confirmation instead of stacking prompts.
 */
let inFlightConfirmation: Promise<boolean> | null = null;

/**
 * Show the quit confirmation prompt if quitting disrupts anything — active
 * agents or agent-owned embedded browser tabs.
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
    listDisruptedBrowserTabs: defaultListDisruptedBrowserTabs,
    confirmViaRenderer: defaultConfirmViaRenderer,
    buildQuitDialogOptions,
    buildTabsOnlyQuitDialogOptions,
    getParentWindow: defaultGetParentWindow,
    showMessageBox: defaultShowMessageBox,
    ...overrides,
  };

  const targets = deps.getBackendTargets();
  const hasLocalTarget = targets.some((target) => target.id === LOCAL_CONNECTION_ID);
  const hasRemoteTarget = targets.some((target) => target.id !== LOCAL_CONNECTION_ID);
  const localProbeNeeded =
    !hasLocalTarget && (hasRemoteTarget || deps.getConnectionMode() === 'sidecar');
  const [targetAgents, probedLocalAgents, disruptedBrowserTabs] = await Promise.all([
    Promise.all(
      targets.map(async (target) => ({
        id: target.id,
        agents: await deps.listRespondingAgents(target.client),
      })),
    ),
    localProbeNeeded ? listLocalAgentsFailOpen(deps) : Promise.resolve<RespondingAgent[]>([]),
    listDisruptedTabsFailOpen(deps),
  ]);
  const remoteAgents = targetAgents
    .filter((target) => target.id !== LOCAL_CONNECTION_ID)
    .flatMap((target) => target.agents);
  const localAgents = [
    ...targetAgents
      .filter((target) => target.id === LOCAL_CONNECTION_ID)
      .flatMap((target) => target.agents),
    ...probedLocalAgents,
  ];

  // Framing depends only on whether quitting stops an agent's daemon: a remote
  // backend and an adopted external local daemon both outlive the app, our
  // spawned sidecar does not.
  const localKeepsRunning = deps.getConnectionMode() === 'external';
  const keepRunning = dedupeByAgentId(
    localKeepsRunning ? [...remoteAgents, ...localAgents] : remoteAgents,
  );
  const keepRunningIds = new Set(keepRunning.map((agent) => agent.agentId));
  const interrupted = dedupeByAgentId(localKeepsRunning ? [] : localAgents).filter(
    (agent) => !keepRunningIds.has(agent.agentId),
  );
  const groups: QuitAgentGroups = { keepRunning, interrupted };

  // Prompt when quitting disrupts anything: running agent work OR agent-owned
  // browser tabs (tabs alone trigger the prompt too — destroying them mid-use
  // is disruptive even with zero responding agents). Both empty → quit
  // silently.
  const agentCount = groups.keepRunning.length + groups.interrupted.length;
  if (agentCount === 0 && disruptedBrowserTabs.length === 0) {
    return true;
  }

  logger.info('Disruptive quit attempt detected', {
    keepRunning: groups.keepRunning.length,
    interrupted: groups.interrupted.length,
    agentIds: [...groups.keepRunning, ...groups.interrupted].map((s) => s.agentId),
    disruptedBrowserTabs: disruptedBrowserTabs.length,
  });

  const parent = deps.getParentWindow();
  const allAgents = [...groups.keepRunning, ...groups.interrupted];
  const payload: QuitConfirmationShowPayload = {
    requestId: randomUUID(),
    keepRunning: toAgentSummaries(groups.keepRunning),
    interrupted: toAgentSummaries(groups.interrupted),
    disruptedBrowserTabs: withOwnerNames(disruptedBrowserTabs, allAgents),
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

  // Renderer path unavailable — fall back to the native message box so quit
  // is never blocked by a broken/missing renderer. Tabs-only (no agents) gets
  // dedicated native copy; agent cases keep the existing agent copy.
  const options =
    agentCount === 0
      ? deps.buildTabsOnlyQuitDialogOptions(disruptedBrowserTabs.length)
      : deps.buildQuitDialogOptions(groups);
  const result = await deps.showMessageBox(parent, options);

  if (result.response === 1) {
    logger.info('User cancelled quit from the native fallback dialog');
    return false;
  }

  logger.info('User confirmed quit from the native fallback dialog');
  return true;
}
