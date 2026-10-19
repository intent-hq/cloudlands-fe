import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
import { selectActiveTerminalIdForWorkspace } from '../terminals-selectors';
import {
  closeActiveTerminalRequested,
  createTerminalRequested,
  killRestoredTerminalRequested,
  removeTerminal,
} from '../terminals-slice';

const logger = createLogger('TerminalCommandsSaga');

/**
 * Creation presentation stays overlay-owned: the quake overlay listens for
 * this window event (Cmd+T path) and dispatches the saga-owned create request;
 * terminalCreationSaga adds the daemon-keyed tab returned by that request.
 * Terminals are owner-only (multiplayer w3): a collaborator's request is
 * dropped here so the menu / palette paths never reach `terminal.create`.
 */
function* createTerminalWorker(
  action: ReturnType<typeof createTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!(yield* selectWorkspaceActionContext.effect(workspaceId))) return;
  yield* call(() => dispatchWindowEvent('workspace:new-terminal', { workspaceId }));
}

/** Lazy import mirrors `daemon-events-bridge.client.ts`: the manager module touches `window` at load. */
async function disposeTerminal(terminalId: string, workspaceId: string): Promise<void> {
  const { terminalManager } = await import('$features/terminal/terminal-manager.svelte');
  terminalManager.disposeTerminal(terminalId, workspaceId);
}

/** Same path as the overlay's close button: drop the tab, then dispose the PTY. */
function* closeActiveTerminalWorker(
  action: ReturnType<typeof closeActiveTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!(yield* selectWorkspaceActionContext.effect(workspaceId))) return;
  const terminalId = yield* selectActiveTerminalIdForWorkspace.effect(workspaceId);
  if (!terminalId) return;
  yield* put(removeTerminal(workspaceId, terminalId));
  yield* call(disposeTerminal, terminalId, workspaceId);
}

function* killRestoredTerminalWorker(
  action: ReturnType<typeof killRestoredTerminalRequested>,
): SagaGenerator<void> {
  const [terminalId, workspaceId] = action.payload;
  try {
    const result: Awaited<ReturnType<typeof appClient.terminals.kill>> = yield* call(
      [appClient.terminals, appClient.terminals.kill],
      terminalId,
      workspaceId,
    );
    if (!result.success) logger.error('Error killing terminal:', result.error);
  } catch (error) {
    logger.error('Error killing terminal:', error);
  }
}

export function* terminalCommandsSaga(): SagaGenerator<void> {
  yield* takeEvery(createTerminalRequested, createTerminalWorker);
  yield* takeEvery(closeActiveTerminalRequested, closeActiveTerminalWorker);
  yield* takeEvery(killRestoredTerminalRequested, killRestoredTerminalWorker);
}
