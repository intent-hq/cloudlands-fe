/**
 * Running-agents quit confirmation for the main process.
 *
 * Shows the mode-branched "agents are still working" prompt (quit-dialog.ts)
 * when the daemon reports responding agents, and returns whether the caller
 * should proceed with quit/teardown. Shared by:
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
import { buildQuitDialogOptions } from './quit-dialog';
import {
  listRespondingAgents,
  type RespondingAgent,
  type RunningAgentsRpc,
} from './running-agents';
import { getMainWindow } from './state';

const logger = new Logger('QuitConfirmation');

/** Injectable collaborators (defaults wire up the real main-process ones). */
export interface QuitConfirmationDeps {
  getBackendClient(): RunningAgentsRpc;
  getConnectionMode(): ConnectionMode;
  listRespondingAgents(client: RunningAgentsRpc): Promise<RespondingAgent[]>;
  buildQuitDialogOptions(mode: ConnectionMode, agents: RespondingAgent[]): MessageBoxOptions;
  /** Window to parent the dialog to (focused window, else main window). */
  getParentWindow(): BrowserWindow | null;
  showMessageBox(
    parent: BrowserWindow | null,
    options: MessageBoxOptions,
  ): Promise<MessageBoxReturnValue>;
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
 * Show the running-agent confirmation prompt if any agents are active.
 *
 * Returns true if the caller should proceed with quit/teardown (no agents
 * running, or user confirmed), false if the user cancelled.
 */
export async function confirmQuitWithRunningAgents(
  overrides: Partial<QuitConfirmationDeps> = {},
): Promise<boolean> {
  const deps: QuitConfirmationDeps = {
    // Lazy so importing this module never pulls in the backend IPC chain
    // (JsonRpcClient, sidecar manager) — only invoking it does.
    getBackendClient:
      overrides.getBackendClient ??
      (await import('../features/backend/main/backend.ipc')).getBackendClient,
    getConnectionMode,
    listRespondingAgents,
    buildQuitDialogOptions,
    getParentWindow: defaultGetParentWindow,
    showMessageBox: defaultShowMessageBox,
    ...overrides,
  };

  const respondingAgents = await deps.listRespondingAgents(deps.getBackendClient());
  if (respondingAgents.length === 0) {
    return true;
  }

  logger.info('Active agents detected during quit attempt', {
    count: respondingAgents.length,
    agentIds: respondingAgents.map((s) => s.agentId),
  });

  // The dialog copy branches on the connection mode (see quit-dialog.ts):
  // in sidecar mode quitting shuts down the daemon and its running agents
  // (destructive framing, resume on next launch); in external mode the daemon
  // outlives the app, so closing is non-destructive and the copy lists the
  // agents that keep running in the background. Parent the dialog to the
  // focused/main window when available so it appears in front of the app.
  const result = await deps.showMessageBox(
    deps.getParentWindow(),
    deps.buildQuitDialogOptions(deps.getConnectionMode(), respondingAgents),
  );

  if (result.response === 1) {
    logger.info('User cancelled quit due to running agents');
    return false;
  }

  logger.info('User confirmed quit despite running agents');
  return true;
}
