import { call, cancelled, join, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { StoreAction } from '@themislib/themis/types';
import type { InteractiveTerminalsClient } from '../../../../../lib/client/terminal-client-types';
import type { TerminalOperation } from '../terminal-interaction-types';
import {
  terminalViewRefreshRequested,
  terminalReadStarted,
  terminalReadFinished,
  terminalViewRetired,
  terminalOperationRequested,
  terminalOperationStarted,
  terminalOperationFinished,
} from '../terminals-slice';
import { takeLatestInContext } from '../../../utils/context-saga-effects';

/** Canonical explicit operation owner; receipts survive view retirement, never replay requests. */
export function createTerminalInteractionSaga(deps: {
  context(workspaceId: string): string | null;
  viewId(workspaceId: string): string | undefined;
  operation(id: string): TerminalOperation | undefined;
  client(workspaceId: string, current: () => boolean): InteractiveTerminalsClient;
  dispatch(action: StoreAction<unknown>): unknown;
  error(): string;
}) {
  function* read(
    action:
      ReturnType<typeof terminalViewRefreshRequested> | ReturnType<typeof terminalViewRetired>,
  ): SagaGenerator<void> {
    if (action.type === terminalViewRetired.type) return;
    const [workspaceId, viewId] = action.payload;
    const context = deps.context(workspaceId);
    if (!context || deps.viewId(workspaceId) !== viewId) return;
    const requestId = crypto.randomUUID();
    let active = true;
    const current = () =>
      active && deps.context(workspaceId) === context && deps.viewId(workspaceId) === viewId;
    deps.dispatch(terminalReadStarted(workspaceId, context, requestId, viewId));
    try {
      const client = deps.client(workspaceId, current);
      const result = yield* call([client, client.list], workspaceId);
      if (current())
        deps.dispatch(terminalReadFinished(workspaceId, context, requestId, result.terminals));
    } catch (error) {
      if (current())
        deps.dispatch(
          terminalReadFinished(
            workspaceId,
            context,
            requestId,
            null,
            error instanceof Error ? error.message : deps.error(),
          ),
        );
    } finally {
      active = false;
    }
  }
  function* operate({
    payload: [requested],
  }: ReturnType<typeof terminalOperationRequested>): SagaGenerator<void> {
    const operation = deps.operation(requested.id);
    if (!operation || operation !== requested || operation.status !== 'queued') return;
    let active = true;
    const current = () =>
      active &&
      deps.viewId(operation.workspaceId) === operation.viewId &&
      !deps.operation(operation.id)?.retired &&
      deps.context(operation.workspaceId) === operation.context;
    const client = deps.client(operation.workspaceId, current);
    deps.dispatch(terminalOperationStarted(operation.id));
    const execute = async () => {
      if (!current()) return { success: false, error: deps.error() };
      if (operation.kind === 'close') {
        const terminalId = operation.terminalId;
        if (!terminalId) return { success: false, error: deps.error() };
        const listed = await client.list(operation.workspaceId);
        if (!current() || !listed.terminals.some((t) => t.id === operation.terminalId))
          return { success: false, error: deps.error() };
        return client.kill(terminalId, operation.workspaceId);
      }
      return client.create({
        workspaceId: operation.workspaceId,
        cwd: operation.root,
        cols: 80,
        rows: 24,
      });
    };
    // This promise retains the actual settlement after cancellation. Only receipt facts publish
    // outside the saga; a replacement view reads the daemon afresh and never resends the write.
    const pending = execute()
      .catch(() => ({ success: false, error: deps.error() }))
      .then((result) => {
        deps.dispatch(terminalOperationFinished(operation.id, result));
        if (result.success && current())
          deps.dispatch(terminalViewRefreshRequested(operation.workspaceId, operation.viewId));
      });
    try {
      yield* call(() => pending);
    } finally {
      if (yield* cancelled()) active = false;
    }
  }
  return function* terminalInteractionSaga(): SagaGenerator<void> {
    const reads = yield* takeLatestInContext(
      [terminalViewRefreshRequested, terminalViewRetired],
      (action) =>
        `${action.payload[0]}:${action.type === terminalViewRetired.type ? action.payload[2] : action.payload[1]}`,
      read,
    );
    yield* takeEvery(terminalOperationRequested, operate);
    yield* join(reads);
  };
}
