/**
 * Running-agents quit confirmation for the main process.
 *
 * Shows the ownership-branched "agents are still working" prompt
 * (quit-dialog.ts) when a daemon reports responding agents, and returns whether
 * the caller should proceed with quit/teardown. Shared by:
 *   - `before-quit` (Cmd+Q) and the non-macOS `window-all-closed` path in
 *     `src/main/index.ts`;
 *   - `AutoUpdateService.installUpdate()`, which must confirm BEFORE calling
 *     `autoUpdater.quitAndInstall()` — on macOS quitAndInstall closes all
 *     windows before `before-quit` fires, so prompting there is too late.
 *
 * Live agent turns run inside the intentd daemon (agent.sendMessage, PROTOCOL
 * §5.5), so the daemon's per-agent `isResponding` flag is the source of truth
 * for "still running" (see running-agents.ts).
 *
 * Two daemons can be in play at once: when the live client is pinned to a
 * remote backend, the app may still supervise a spawned local sidecar that quit
 * shuts down. Both are queried and their agents grouped by whether quitting
 * stops their daemon — remote agents and agents on an adopted external local
 * daemon keep running, agents on our spawned sidecar are interrupted (see
 * quit-dialog.ts). The local query is best effort: any failure yields no local
 * agents so a dead/absent local daemon never blocks quit.
 *
 * Kept out of `src/main/index.ts` (heavy top-level side effects) so it is
 * unit-testable and importable from the auto-update service without a
 * circular import (index.ts imports auto-update.service.ts). Dependencies are
 * injectable for tests; `backend.ipc` is resolved lazily so importing this
 * module stays dependency-light.
 */

import { BrowserWindow, dialog } from 'electron';
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron';

import type { ConnectionMode } from '../features/backend/main/connection-mode';
import { getConnectionMode } from '../features/backend/main/connection-mode';
import { Logger } from '../shared/logger';
import { buildQuitDialogOptions, type QuitAgentGroups } from './quit-dialog';
import {
  listRespondingAgents,
  type RespondingAgent,
  type RunningAgentsRpc,
} from './running-agents';
import { getMainWindow } from './state';

const logger = new Logger('QuitConfirmation');

/**
 * Connect budget for the short-lived local-daemon client opened while a remote
 * backend is active. The quit prompt must not stall behind an unreachable local
 * socket, so the whole probe is bounded and fails open.
 */
const LOCAL_PROBE_TIMEOUT_MS = 2_000;

/** Injectable collaborators (defaults wire up the real main-process ones). */
export interface QuitConfirmationDeps {
  getBackendClient(): RunningAgentsRpc;
  getConnectionMode(): ConnectionMode;
  /** True when the live client is pinned to a remote backend (not the local daemon). */
  isRemoteBackendActive(): boolean;
  listRespondingAgents(client: RunningAgentsRpc): Promise<RespondingAgent[]>;
  /** Best-effort responding agents on the LOCAL daemon, via a throwaway client. */
  listLocalRespondingAgents(): Promise<RespondingAgent[]>;
  buildQuitDialogOptions(groups: QuitAgentGroups): MessageBoxOptions;
  /** Window to parent the dialog to (focused window, else main window). */
  getParentWindow(): BrowserWindow | null;
  showMessageBox(
    parent: BrowserWindow | null,
    options: MessageBoxOptions,
  ): Promise<MessageBoxReturnValue>;
}

/**
 * Query the LOCAL daemon through a short-lived JSON-RPC client, bounded by
 * {@link LOCAL_PROBE_TIMEOUT_MS} and disposed on every exit path. Only used
 * while the live client is pinned to a remote, where the local daemon is a
 * second, separate source of running agents.
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
  try {
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('local daemon connect timed out')),
        LOCAL_PROBE_TIMEOUT_MS,
      );
      client.on('status', (status: string) => {
        if (status !== 'connected') return;
        clearTimeout(timer);
        resolve();
      });
      client.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    client.start();
    await connected;
    return await listRespondingAgents(client);
  } finally {
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

/** Local-daemon query wrapper: any failure means "no local agents", never a throw. */
async function listLocalAgentsFailOpen(deps: QuitConfirmationDeps): Promise<RespondingAgent[]> {
  try {
    return await deps.listLocalRespondingAgents();
  } catch (error) {
    logger.warn('Local daemon query failed during quit check; assuming no local agents', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Show the running-agent confirmation prompt if any agents are active.
 *
 * Returns true if the caller should proceed with quit/teardown (no agents
 * running, or user confirmed), false if the user cancelled.
 */
export async function confirmQuitWithRunningAgents(
  overrides: Partial<QuitConfirmationDeps> = {},
): Promise<boolean> {
  // Lazy so importing this module never pulls in the backend IPC chain
  // (JsonRpcClient, sidecar manager) — only invoking it does, and only when
  // the caller has not injected both backend seams.
  const backendIpc =
    overrides.getBackendClient && overrides.isRemoteBackendActive
      ? null
      : await import('../features/backend/main/backend.ipc');
  const deps: QuitConfirmationDeps = {
    getBackendClient: overrides.getBackendClient ?? backendIpc!.getBackendClient,
    isRemoteBackendActive: overrides.isRemoteBackendActive ?? backendIpc!.isRemoteBackendActive,
    getConnectionMode,
    listRespondingAgents,
    listLocalRespondingAgents: defaultListLocalRespondingAgents,
    buildQuitDialogOptions,
    getParentWindow: defaultGetParentWindow,
    showMessageBox: defaultShowMessageBox,
    ...overrides,
  };

  // The active client is the remote one when a remote backend is pinned; a
  // spawned local sidecar is then a SECOND source of running agents that quit
  // still shuts down, so it is queried separately (fail-open) before the
  // zero-agent fast path.
  const remoteActive = deps.isRemoteBackendActive();
  const activeAgents = await deps.listRespondingAgents(deps.getBackendClient());
  const localAgents = remoteActive ? await listLocalAgentsFailOpen(deps) : [];

  // Framing depends only on whether quitting stops an agent's daemon: a remote
  // backend and an adopted external local daemon both outlive the app, our
  // spawned sidecar does not.
  const localKeepsRunning = deps.getConnectionMode() === 'external';
  const groups: QuitAgentGroups = remoteActive
    ? {
        keepRunning: localKeepsRunning ? [...activeAgents, ...localAgents] : activeAgents,
        interrupted: localKeepsRunning ? [] : localAgents,
      }
    : {
        keepRunning: localKeepsRunning ? activeAgents : [],
        interrupted: localKeepsRunning ? [] : activeAgents,
      };

  if (groups.keepRunning.length + groups.interrupted.length === 0) {
    return true;
  }

  logger.info('Active agents detected during quit attempt', {
    keepRunning: groups.keepRunning.length,
    interrupted: groups.interrupted.length,
    agentIds: [...groups.keepRunning, ...groups.interrupted].map((s) => s.agentId),
  });

  // Parent the dialog to the focused/main window when available so it appears
  // in front of the app.
  const result = await deps.showMessageBox(
    deps.getParentWindow(),
    deps.buildQuitDialogOptions(groups),
  );

  if (result.response === 1) {
    logger.info('User cancelled quit due to running agents');
    return false;
  }

  logger.info('User confirmed quit despite running agents');
  return true;
}
