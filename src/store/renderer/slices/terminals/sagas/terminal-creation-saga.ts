import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectFocusedPanelId } from '../../panel-layout/panel-layout-selectors';
import { openTab } from '../../panel-layout/panel-layout-slice';
import {
  createTerminalRequested,
  hydrateTerminalsRequested,
  removeTerminal,
  saveTerminalMetadata,
} from '../terminals-slice';

const logger = createLogger('TerminalCreationSaga');

function* createTerminalWorker(
  action: ReturnType<typeof createTerminalRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  try {
    const result: Awaited<ReturnType<typeof appClient.terminals.create>> = yield* call(
      [appClient.terminals, appClient.terminals.create],
      { workspaceId, cols: 80, rows: 24 },
    );
    if (!result.success || !result.id) {
      logger.error('Failed to create terminal', { error: result.error });
      return;
    }

    logger.info('Created new terminal', { terminalId: result.id });
    yield* put(removeTerminal(workspaceId, result.id));
    yield* put(saveTerminalMetadata(workspaceId, result.id, undefined, new Date().toISOString()));

    yield* put(hydrateTerminalsRequested(workspaceId));

    const panelId = yield* selectFocusedPanelId.effect(workspaceId);
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
  yield* takeEvery(createTerminalRequested, createTerminalWorker);
}
