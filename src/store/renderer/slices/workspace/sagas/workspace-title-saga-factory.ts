import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceUpdateResult } from '$lib/client/workspaces-client-types';
import type {
  RenameWorkspaceTitleResult,
  WorkspaceTitleSagaDependencies,
} from '../workspace-types';
import {
  beginWorkspaceTitleMutation,
  completeWorkspaceTitleMutation,
  failWorkspaceTitleMutation,
  renameWorkspaceTitleRequested,
  workspaceTitleOperationQueued,
  workspaceTitleOperationStarted,
  workspaceTitleOperationSettled,
} from '../workspace-slice';

/** One title mutation owner. Source keeps its optimistic policy; guarded hosts retain receipts. */
export function createWorkspaceTitleSaga(deps: WorkspaceTitleSagaDependencies) {
  const failureMessage = (error?: string) =>
    error?.trim() || m.workspace_client_updateFailed_error();

  function* renameTitle(
    action: ReturnType<typeof renameWorkspaceTitleRequested>,
  ): SagaGenerator<void> {
    const [request] = action.payload;
    const { workspaceId, token, previousTitle, requestId, authority, viewId } = request;
    const title = request.title.trim();
    const admission = deps.admission;
    let active = true;
    let dispatched = false;
    let queued = false;
    let settled = false;
    let began = false;
    let observedRevision: number | undefined;
    let result: RenameWorkspaceTitleResult = { ok: false, error: failureMessage() };
    const isCurrent = () =>
      active &&
      (!admission ||
        (admission.isCurrent(request) &&
          (observedRevision === undefined ||
            admission.readRevision(workspaceId) === observedRevision)));
    try {
      const workspace = yield* deps.selectWorkspace(workspaceId);
      if (admission && (!requestId || !authority || !viewId || !workspace || !isCurrent())) return;
      if (!title || title === workspace?.title || title === previousTitle.trim()) {
        result = { ok: true };
        return;
      }
      if (admission) {
        if (!requestId || !authority || !viewId || !workspace || !isCurrent()) return;
        const operations = yield* admission.selectOperations(workspaceId);
        if (
          operations.some(
            (op) =>
              op.requestId === requestId ||
              op.status === 'queued' ||
              op.status === 'running' ||
              op.status === 'unknown',
          )
        )
          return;
        observedRevision = yield* admission.selectRevision(workspaceId);
        if (!isCurrent()) return;
        // All authority values were supplied by the original callback, before dispatch.
        admission.dispatch(
          workspaceTitleOperationQueued({
            requestId,
            workspaceId,
            authority,
            viewId,
            title,
            baseTitle: workspace.title,
            observedRevision,
            status: 'queued',
          }),
        );
        queued = true;
        if (workspace.title !== previousTitle || request.expectedRevision !== observedRevision) {
          result = {
            ok: false,
            error: m.ui_reversibleActions_cancelled_message(),
            outcome: 'failed',
          };
          admission.dispatch(
            workspaceTitleOperationSettled(
              requestId,
              'failed',
              m.ui_reversibleActions_cancelled_message(),
            ),
          );
          settled = true;
          return;
        }
      } else {
        // A guarded request must never fall through to legacy source policy.
        if (
          requestId ||
          authority ||
          viewId ||
          request.context ||
          request.expectedRevision !== undefined
        )
          return;
        yield* put(beginWorkspaceTitleMutation(workspaceId, token, title, previousTitle));
        began = true;
      }

      const execute = async (): Promise<WorkspaceUpdateResult> => {
        let receipt: WorkspaceUpdateResult;
        try {
          if (!isCurrent()) throw new Error(m.ui_reversibleActions_cancelled_message());
          receipt = admission
            ? await deps.update(
                { id: workspaceId, title },
                {
                  requireTitleReceipt: true,
                  onDispatch: () => {
                    if (!requestId || !isCurrent() || dispatched)
                      throw new Error(m.ui_reversibleActions_cancelled_message());
                    admission.dispatch(workspaceTitleOperationStarted(requestId));
                    // Synchronous observers of the phase marker may retire authority.
                    if (!isCurrent()) throw new Error(m.ui_reversibleActions_cancelled_message());
                    dispatched = true;
                  },
                },
              )
            : await deps.update({ id: workspaceId, title });
        } catch (error) {
          deps.onError?.(error);
          receipt = {
            success: false,
            error: failureMessage(),
            titleOutcome: dispatched ? 'unknown' : 'failed',
          };
        }
        if (admission && requestId) {
          // A matching receipt is necessary even for a custom client binding. The
          // transport promise retains settlement after saga/view cancellation.
          const confirmed =
            dispatched &&
            receipt.success &&
            receipt.titleOutcome === 'confirmed' &&
            receipt.workspace?.id === workspaceId &&
            receipt.workspace.title === title;
          const status = confirmed
            ? 'confirmed'
            : receipt.titleOutcome === 'failed'
              ? 'failed'
              : 'unknown';
          admission.dispatch(
            workspaceTitleOperationSettled(
              requestId,
              status,
              receipt.error,
              confirmed && admission.canPublish(request),
            ),
          );
          settled = true;
          return { ...receipt, success: confirmed, titleOutcome: status };
        }
        return receipt;
      };
      const receipt = yield* call(execute);
      if (receipt.success && receipt.workspace) {
        if (!admission)
          yield* put(completeWorkspaceTitleMutation(workspaceId, token, receipt.workspace));
        result = { ok: true };
      } else {
        const error = failureMessage(receipt.error);
        result = {
          ok: false,
          error,
          ...(admission
            ? {
                outcome:
                  receipt.titleOutcome === 'failed' ? ('failed' as const) : ('unknown' as const),
              }
            : {}),
        };
        if (!admission && (yield* deps.selectPendingToken(workspaceId)) === token) {
          yield* put(failWorkspaceTitleMutation(workspaceId, token));
          try {
            if (deps.showError) yield* call(deps.showError, error);
          } catch (error) {
            deps.onError?.(error);
          }
        }
      }
    } catch (error) {
      deps.onError?.(error);
      if (admission && queued && requestId && !settled) {
        admission.dispatch(
          workspaceTitleOperationSettled(requestId, dispatched ? 'unknown' : 'failed'),
        );
      }
    } finally {
      if (yield* cancelled()) {
        active = false;
        if (admission && queued && requestId && !settled) {
          admission.dispatch(
            workspaceTitleOperationSettled(requestId, dispatched ? 'unknown' : 'failed'),
          );
        } else if (!admission && began) {
          yield* put(failWorkspaceTitleMutation(workspaceId, token));
        }
        yield* put(action.failure(new Error(m.ui_reversibleActions_cancelled_message())));
      } else {
        yield* put(action.success(result));
      }
    }
  }

  return function* workspaceTitleSaga(): SagaGenerator<void> {
    // Every request is admitted or explicitly settled; no takeLeading promise gaps.
    yield* takeEvery(renameWorkspaceTitleRequested, renameTitle);
  };
}
