import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { withRecoveryLifetime } from '$store/renderer/middlewares/event-recovery';
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
  selectTerminalsForWorkspace,
} from '../terminals-selectors';
import {
  addTerminal,
  createPanelTerminalRequested,
  createOverlayTerminalRequested,
  hydrateTerminalsRequested,
  openTerminalOverlay,
  removeTerminal,
  saveTerminalMetadata,
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
  authority?: RecoveryLifetime,
): SagaGenerator<void> {
  const [workspaceId, consumer] = action.payload;
  if (!consumer) return;
  const outcome = terminalCreationFinished({
    ...consumer,
    workspaceId,
    seq: action.seq,
    status,
    ...(terminalId ? { terminalId } : {}),
    ...(error?.message ? { error: error.message } : {}),
  });
  yield* put(authority ? withRecoveryLifetime(outcome, authority) : outcome);
}

function* createOverlayTerminalWorker(
  action: ReturnType<typeof createOverlayTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const authority = rendererEventRecovery.captureAuthority(
    'terminals:' + JSON.stringify([workspaceId]),
  );
  let settled = false;
  try {
    const context =
      workspaceId === ROOT_WORKSPACE_ID
        ? ROOT_WORKSPACE_ID
        : yield* selectWorkspaceActionContext.effect(workspaceId);
    if (!context || !authority.isCurrent()) {
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
    if (!authority.isCurrent() || context !== currentContext || !result.success || !result.id) {
      const error = new Error(result.error ?? m.terminal_adapter_openFailed_error());
      settled = true;
      yield* finishOverlayCreation(action, 'failure', undefined, error);
      yield* put(action.failure(error));
      return;
    }

    const consumerCurrent = yield* isOverlayConsumerCurrent(action);
    const terminals = yield* selectTerminalsForWorkspace.effect(workspaceId);
    yield* put(
      withRecoveryLifetime(
        addTerminal(
          workspaceId,
          result.id,
          m.terminal_quakeOverlay_terminalNumber_label({ number: terminals.length + 1 }),
        ),
        authority,
      ),
    );
    if (consumerCurrent) {
      if (!(yield* selectIsTerminalOverlayOpenForWorkspace.effect(workspaceId)))
        yield* put(withRecoveryLifetime(openTerminalOverlay(workspaceId, result.id), authority));
      if (!authority.isCurrent()) throw new Error(m.terminal_adapter_openFailed_error());
      yield* finishOverlayCreation(action, 'success', result.id, undefined, authority);
    }
    if (!authority.isCurrent()) throw new Error(m.terminal_adapter_openFailed_error());
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

function* createTerminalWorker(
  action: ReturnType<typeof createPanelTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId, targetPanelId] = action.payload;
  // `terminal.create` is owner-only (multiplayer w3): the global new-terminal
  // shortcut still dispatches here, so the request is dropped rather than refused.
  if (yield* selectIsWorkspaceCollaborator.effect(workspaceId)) return;
  const context = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!context) return;
  try {
    const result: Awaited<ReturnType<typeof appClient.terminals.create>> = yield* call(
      [appClient.terminals, appClient.terminals.create],
      { workspaceId, cols: 80, rows: 24 },
    );
    if (!context || context !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return;
    if (!result.success || !result.id) {
      logger.error('Failed to create terminal', { error: result.error });
      return;
    }

    logger.info('Created new terminal', { terminalId: result.id });
    yield* put(removeTerminal(workspaceId, result.id));
    yield* put(saveTerminalMetadata(workspaceId, result.id, undefined, new Date().toISOString()));

    yield* put(hydrateTerminalsRequested(workspaceId));

    const panelId = targetPanelId ?? (yield* selectFocusedPanelId.effect(workspaceId));
    yield* put(
      openTab(
        workspaceId,
        {
          type: 'terminal',
          title: m.layout_panelLayout_terminal_fallback(),
          terminalId: result.id,
          closable: true,
        },
        panelId ?? undefined,
      ),
    );
  } catch (error) {
    logger.error('Failed to create terminal', error);
  }
}

export function* terminalCreationSaga(): SagaGenerator<void> {
  yield* takeEvery(createOverlayTerminalRequested, createOverlayTerminalWorker);
  yield* takeEvery(createPanelTerminalRequested, createTerminalWorker);
}
