import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
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
  createPanelTerminalRequested,
  createOverlayTerminalRequested,
  hydrateTerminalsRequested,
  removeTerminal,
  saveTerminalMetadata,
} from '../terminals-slice';

const logger = createLogger('TerminalCreationSaga');

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
      settled = true;
      yield* put(action.failure(new Error(m.terminal_adapter_openFailed_error())));
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
      settled = true;
      yield* put(action.failure(new Error(result.error ?? m.terminal_adapter_openFailed_error())));
      return;
    }

    settled = true;
    yield* put(action.success(result.id));
  } catch (error) {
    settled = true;
    yield* put(
      action.failure(
        error instanceof Error ? error : new Error(m.terminal_adapter_openFailed_error()),
      ),
    );
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.terminal_adapter_openFailed_error())));
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
