import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { selectFocusedPanelId } from '../../panel-layout/panel-layout-selectors';
import { openTab } from '../../panel-layout/panel-layout-slice';
import {
  selectIsWorkspaceCollaborator,
  selectWorkspaceActionContext,
} from '../../workspace/workspace-selectors';
import {
  selectIsTerminalOverlayOpenForWorkspace,
  selectTerminalCreationOutcome,
  selectTerminalDisplayName,
  selectTerminalsForWorkspace,
  selectWorkspaceTerminalState,
} from '../terminals-selectors';
import {
  addTerminal,
  closeTerminalOverlay,
  createPanelTerminalRequested,
  createOverlayTerminalRequested,
  hydrateTerminalsRequested,
  loadWorkspaceTerminals,
  openFirstPanelTerminalRequested,
  openTerminalOverlay,
  removeTerminal,
  saveTerminalMetadata,
  setTerminalPlacement,
  terminalCreationFinished,
  type TerminalCreationOutcome,
} from '../terminals-slice';

const logger = createLogger('TerminalCreationSaga');

function* isOverlayConsumerCurrent(
  action: ReturnType<typeof createOverlayTerminalRequested>,
): SagaGenerator<boolean> {
  const [workspaceId, consumer] = action.payload;
  if (!consumer) return true;
  const current = yield* selectTerminalCreationOutcome.effect(
    consumer.id,
    workspaceId,
    consumer.resourceId,
  );
  return current?.seq === action.seq && current.status === 'pending';
}

function* finishOverlayCreation(
  action: ReturnType<typeof createOverlayTerminalRequested>,
  status: TerminalCreationOutcome['status'],
  terminalId?: string,
  error?: Error,
): SagaGenerator<void> {
  const [workspaceId, consumer] = action.payload;
  if (!consumer) return;
  yield* put(
    terminalCreationFinished({
      ...consumer,
      workspaceId,
      seq: action.seq,
      status,
      ...(terminalId ? { terminalId } : {}),
      ...(error?.message ? { error: error.message } : {}),
    }),
  );
}

function* createOverlayTerminalWorker(
  action: ReturnType<typeof createOverlayTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  let settled = false;
  try {
    const context =
      workspaceId === ROOT_WORKSPACE_ID
        ? ROOT_WORKSPACE_ID
        : yield* selectWorkspaceActionContext.effect(workspaceId);
    if (!context) {
      const error = new Error(m.terminal_adapter_openFailed_error());
      settled = true;
      yield* finishOverlayCreation(action, 'failure', undefined, error);
      yield* put(action.failure(error));
      return;
    }

    const result: Awaited<ReturnType<typeof appClient.terminals.create>> = yield* call(
      [appClient.terminals, appClient.terminals.create],
      { workspaceId, cols: 80, rows: 24 },
    );
    const currentContext =
      workspaceId === ROOT_WORKSPACE_ID
        ? ROOT_WORKSPACE_ID
        : yield* selectWorkspaceActionContext.effect(workspaceId);
    if (context !== currentContext || !result.success || !result.id) {
      const error = new Error(result.error ?? m.terminal_adapter_openFailed_error());
      settled = true;
      yield* finishOverlayCreation(action, 'failure', undefined, error);
      yield* put(action.failure(error));
      return;
    }

    const consumerCurrent = yield* isOverlayConsumerCurrent(action);
    const terminals = yield* selectTerminalsForWorkspace.effect(workspaceId);
    yield* put(
      addTerminal(
        workspaceId,
        result.id,
        m.terminal_quakeOverlay_terminalNumber_label({ number: terminals.length + 1 }),
      ),
    );
    if (consumerCurrent) {
      if (!(yield* selectIsTerminalOverlayOpenForWorkspace.effect(workspaceId)))
        yield* put(openTerminalOverlay(workspaceId, result.id));
      yield* finishOverlayCreation(action, 'success', result.id);
    }
    settled = true;
    yield* put(action.success(result.id));
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error(m.terminal_adapter_openFailed_error());
    settled = true;
    yield* finishOverlayCreation(action, 'failure', undefined, failure);
    yield* put(action.failure(failure));
  } finally {
    if (!settled && (yield* cancelled())) {
      const error = new Error(m.terminal_adapter_openFailed_error());
      yield* finishOverlayCreation(action, 'cancelled', undefined, error);
      yield* put(action.failure(error));
    }
  }
}

function* openPanelTerminalTab(
  workspaceId: string,
  terminalId: string,
  title: string,
  targetPanelId: string | undefined,
): SagaGenerator<void> {
  const panelId = targetPanelId ?? (yield* selectFocusedPanelId.effect(workspaceId));
  yield* put(
    openTab(
      workspaceId,
      { type: 'terminal', title, terminalId, closable: true },
      panelId ?? undefined,
    ),
  );
}

/** Creates a PTY and opens it as a panel tab; returns its id, or null when dropped/failed. */
function* createPanelTerminal(
  workspaceId: string,
  context: string,
  targetPanelId: string | undefined,
): SagaGenerator<string | null> {
  try {
    const result: Awaited<ReturnType<typeof appClient.terminals.create>> = yield* call(
      [appClient.terminals, appClient.terminals.create],
      { workspaceId, cols: 80, rows: 24 },
    );
    if (context !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return null;
    if (!result.success || !result.id) {
      logger.error('Failed to create terminal', { error: result.error });
      return null;
    }

    logger.info('Created new terminal', { terminalId: result.id });
    yield* put(removeTerminal(workspaceId, result.id));
    yield* put(saveTerminalMetadata(workspaceId, result.id, undefined, new Date().toISOString()));

    yield* put(hydrateTerminalsRequested(workspaceId));

    yield* openPanelTerminalTab(
      workspaceId,
      result.id,
      m.layout_panelLayout_terminal_fallback(),
      targetPanelId,
    );
    return result.id;
  } catch (error) {
    logger.error('Failed to create terminal', error);
    return null;
  }
}

function* createTerminalWorker(
  action: ReturnType<typeof createPanelTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId, targetPanelId] = action.payload;
  // `terminal.create` is owner-only (multiplayer w3): the global new-terminal
  // shortcut still dispatches here, so the request is dropped rather than refused.
  if (yield* selectIsWorkspaceCollaborator.effect(workspaceId)) return;
  const context = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!context) return;
  yield* createPanelTerminal(workspaceId, context, targetPanelId);
}

/**
 * Hydrates an empty local list from `terminal.list` first so an existing PTY
 * is reused rather than duplicated. Returns false when the list read failed or
 * the workspace context changed underneath it.
 */
function* ensureTerminalsListed(workspaceId: string, context: string): SagaGenerator<boolean> {
  if ((yield* selectTerminalsForWorkspace.effect(workspaceId)).length > 0) return true;
  try {
    const result: Awaited<ReturnType<typeof appClient.terminals.list>> = yield* call(
      [appClient.terminals, appClient.terminals.list],
      workspaceId,
    );
    if (context !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return false;
    yield* put(
      Array.isArray(result)
        ? loadWorkspaceTerminals(workspaceId, result)
        : loadWorkspaceTerminals(workspaceId, result.terminals, null, result.daemonBootId),
    );
    return true;
  } catch (error) {
    logger.error('Failed to list terminals', error);
    return false;
  }
}

function* showTerminalInPanel(workspaceId: string, terminalId: string): SagaGenerator<void> {
  yield* put(setTerminalPlacement(workspaceId, terminalId, 'panel'));
  const state = yield* selectWorkspaceTerminalState.effect(workspaceId);
  if (state.isOpen && state.selectedScriptId === null && state.activeTerminalId === terminalId)
    yield* put(closeTerminalOverlay(workspaceId));
}

function* openFirstTerminalWorker(
  inFlight: Set<string>,
  action: ReturnType<typeof openFirstPanelTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId, targetPanelId] = action.payload;
  // Rapid activations coalesce onto the in-flight attempt; a finished or
  // failed attempt releases the slot so the next activation retries.
  if (inFlight.has(workspaceId)) return;
  if (yield* selectIsWorkspaceCollaborator.effect(workspaceId)) return;
  const context = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!context) return;
  inFlight.add(workspaceId);
  try {
    if (!(yield* ensureTerminalsListed(workspaceId, context))) return;
    const [first] = yield* selectTerminalsForWorkspace.effect(workspaceId);
    if (first) {
      yield* openPanelTerminalTab(
        workspaceId,
        first.id,
        yield* selectTerminalDisplayName.effect(workspaceId, first.id),
        targetPanelId,
      );
      yield* showTerminalInPanel(workspaceId, first.id);
      return;
    }
    const createdId = yield* createPanelTerminal(workspaceId, context, targetPanelId);
    if (createdId) yield* showTerminalInPanel(workspaceId, createdId);
  } finally {
    inFlight.delete(workspaceId);
  }
}

export function* terminalCreationSaga(): SagaGenerator<void> {
  yield* takeEvery(createOverlayTerminalRequested, createOverlayTerminalWorker);
  yield* takeEvery(createPanelTerminalRequested, createTerminalWorker);
  yield* takeEvery(openFirstPanelTerminalRequested, openFirstTerminalWorker, new Set<string>());
}
