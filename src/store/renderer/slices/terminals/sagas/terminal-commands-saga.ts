import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { dispatchWindowEvent } from '$lib/utils/window-events';
import { selectIsWorkspaceCollaborator } from '../../workspace/workspace-selectors';
import { selectActiveTerminalIdForWorkspace } from '../terminals-selectors';
import {
  closeActiveTerminalRequested,
  createTerminalRequested,
  removeTerminal,
} from '../terminals-slice';

/**
 * Creation stays overlay-owned: the quake overlay listens for this window
 * event (Cmd+T path), calls `terminal.create`, and adds the daemon-keyed tab.
 * Terminals are owner-only (multiplayer w3): a collaborator's request is
 * dropped here so the menu / palette paths never reach `terminal.create`.
 */
function* createTerminalWorker(
  action: ReturnType<typeof createTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (yield* selectIsWorkspaceCollaborator.effect(workspaceId)) return;
  yield* call(() => dispatchWindowEvent('workspace:new-terminal', { workspaceId }));
}

/** Lazy import mirrors `daemon-events-bridge.client.ts`: the manager module touches `window` at load. */
async function disposeTerminal(terminalId: string): Promise<void> {
  const { terminalManager } = await import('$features/terminal/terminal-manager.svelte');
  terminalManager.disposeTerminal(terminalId);
}

/** Same path as the overlay's close button: drop the tab, then dispose the PTY. */
function* closeActiveTerminalWorker(
  action: ReturnType<typeof closeActiveTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const terminalId = yield* selectActiveTerminalIdForWorkspace.effect(workspaceId);
  if (!terminalId) return;
  yield* put(removeTerminal(workspaceId, terminalId));
  yield* call(disposeTerminal, terminalId);
}

export function* terminalCommandsSaga(): SagaGenerator<void> {
  yield* takeEvery(createTerminalRequested, createTerminalWorker);
  yield* takeEvery(closeActiveTerminalRequested, closeActiveTerminalWorker);
}
