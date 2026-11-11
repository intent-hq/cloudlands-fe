/**
 * Bulk workspace transfer saga.
 *
 * Open: fetch `workspace.transfer.plan` per workspace (a few at a time) for
 * the size estimates. Start: the main-process relay holds one session, so
 * each workspace runs `transfer:start` then `transfer:finalize` before the
 * next one begins. A failure marks that workspace and the run continues;
 * cancel stops the running transfer and skips the rest.
 */

import {
  all,
  call,
  put,
  race,
  take,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { backendRequest } from '$lib/client/live/backend-transport';
import { formatDate } from '$lib/i18n/format';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import type {
  SessionOwnershipErrorCode,
  TransferFinalizeResult,
  TransferProgressEvent,
  TransferStartResult,
} from '$shared/types/workspace-transfer';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { selectTransferTargetConnections } from '../../workspace-transfer/workspace-transfer-selectors';
import type { TransferPlanWireResult } from '../../workspace-transfer/workspace-transfer-types';
import {
  bulkTransferCancelRequested,
  bulkTransferFinished,
  bulkTransferItemFailed,
  bulkTransferItemStarted,
  bulkTransferItemSucceeded,
  bulkTransferProgressReceived,
  bulkTransferSizeFailed,
  bulkTransferSizeLoaded,
  bulkTransferStartRequested,
  closeBulkTransferModal,
  openBulkTransferModal,
} from '../workspace-bulk-transfer-slice';
import {
  selectBulkTransferCancelling,
  selectBulkTransferCurrentId,
  selectBulkTransferState,
} from '../workspace-bulk-transfer-selectors';

const logger = createLogger('WorkspaceBulkTransferSaga');
const TRANSFER = IPC_CHANNELS.TRANSFER;
const PLAN_CONCURRENCY = 3;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureMessage(result: { error?: string; code?: SessionOwnershipErrorCode }): string {
  if (result.code === 'not-session-owner') return m.workspace_transfer_notSessionOwner_error();
  return result.error ?? m.workspace_transfer_unknown_error();
}

async function invokeTransfer<T>(channel: string, params?: unknown): Promise<T> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('transfer bridge unavailable');
  return (await api.invoke(channel, params)) as T;
}

function* loadSize(workspaceId: string): SagaGenerator<void> {
  try {
    const { plan } = yield* call(
      backendRequest<TransferPlanWireResult>,
      'workspace.transfer.plan',
      { workspaceId },
    );
    yield* put(bulkTransferSizeLoaded({ workspaceId, sizeBytes: plan.totalSizeBytes }));
  } catch (error) {
    logger.warn('workspace.transfer.plan failed', { workspaceId, error });
    yield* put(bulkTransferSizeFailed({ workspaceId }));
  }
}

function* loadSizes(action: ReturnType<typeof openBulkTransferModal>): SagaGenerator<void> {
  const ids = action.payload[0].workspaces.map((workspace) => workspace.workspaceId);
  function* loadAll(): SagaGenerator<void> {
    for (let index = 0; index < ids.length; index += PLAN_CONCURRENCY) {
      yield* all(ids.slice(index, index + PLAN_CONCURRENCY).map((id) => call(loadSize, id)));
    }
  }
  yield* race([call(loadAll), take(closeBulkTransferModal)]);
}

function* destinationLabel(connectionId: string): SagaGenerator<string> {
  const connections = yield* selectTransferTargetConnections.effect();
  const record = connections.find((connection) => connection.id === connectionId);
  if (!record) return connectionId;
  return (
    record.hostname ||
    record.label ||
    (record.host ? `${record.host}:${record.port}` : connectionId)
  );
}

async function showResumeFailedToast(count: number): Promise<void> {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.warning(
      count === 1
        ? m.workspace_transfer_resumeFailed_one()
        : m.workspace_transfer_resumeFailed_many({ count }),
    );
  } catch (error) {
    logger.warn('Failed to surface resume-failure toast', { error });
  }
}

/** Transfer one workspace; returns the agents the destination could not resume. */
function* transferOne(
  workspaceId: string,
  connectionId: string,
  options: { restartAgents: boolean; archiveSource: boolean; finalStatusMessage?: string },
): SagaGenerator<{ cancelled: boolean; resumeFailed: number }> {
  yield* put(bulkTransferItemStarted(workspaceId));
  try {
    const outcome = yield* race({
      result: call(invokeTransfer<TransferStartResult>, TRANSFER.START, {
        workspaceId,
        destination: { kind: 'server', connectionId },
      }),
      cancelled: take(bulkTransferCancelRequested),
    });
    if (outcome.cancelled || !outcome.result) {
      try {
        yield* call(invokeTransfer, TRANSFER.CANCEL);
      } catch (error) {
        logger.warn('transfer:cancel failed (best-effort)', { error });
      }
      return { cancelled: true, resumeFailed: 0 };
    }
    if (!outcome.result.success) {
      yield* put(bulkTransferItemFailed({ workspaceId, error: failureMessage(outcome.result) }));
      return { cancelled: false, resumeFailed: 0 };
    }
    const finalized = yield* call(invokeTransfer<TransferFinalizeResult>, TRANSFER.FINALIZE, {
      archiveSource: options.archiveSource,
      restartAgents: options.restartAgents,
      ...(options.finalStatusMessage ? { finalStatusMessage: options.finalStatusMessage } : {}),
    });
    if (!finalized.success) {
      yield* put(bulkTransferItemFailed({ workspaceId, error: failureMessage(finalized) }));
      return { cancelled: false, resumeFailed: 0 };
    }
    yield* put(bulkTransferItemSucceeded(workspaceId));
    return { cancelled: false, resumeFailed: finalized.resumeFailed?.length ?? 0 };
  } catch (error) {
    logger.error('bulk transfer failed', { workspaceId, error });
    yield* put(bulkTransferItemFailed({ workspaceId, error: toMessage(error) }));
    return { cancelled: false, resumeFailed: 0 };
  }
}

function* runBulkTransfer(): SagaGenerator<void> {
  const state = yield* selectBulkTransferState.effect();
  const connectionId = state.connectionId;
  if (state.step !== 'transferring' || !connectionId) return;
  const { restartAgents, archiveSource } = state;
  const finalStatusMessage = archiveSource
    ? m.workspace_transfer_finalStatus_message({
        destination: yield* destinationLabel(connectionId),
        date: formatDate(new Date()),
      })
    : undefined;
  let resumeFailed = 0;
  for (const { workspaceId } of getItems(state.items)) {
    if (yield* selectBulkTransferCancelling.effect()) break;
    const outcome = yield* transferOne(workspaceId, connectionId, {
      restartAgents,
      archiveSource,
      finalStatusMessage,
    });
    resumeFailed += outcome.resumeFailed;
    if (outcome.cancelled) break;
  }
  yield* put(bulkTransferFinished());
  if (resumeFailed > 0) yield* call(showResumeFailedToast, resumeFailed);
}

function* handleProgress(event: TransferProgressEvent): SagaGenerator<void> {
  const currentId = yield* selectBulkTransferCurrentId.effect();
  if (!currentId || event.workspaceId !== currentId) return;
  yield* put(
    bulkTransferProgressReceived({
      phase: event.phase,
      stage: event.stage,
      bytesTotal: event.bytesTotal,
      bytesDown: event.bytesDown,
      bytesUp: event.bytesUp,
      chunksTotal: event.chunksTotal,
      chunksDone: event.chunksDone,
    }),
  );
}

export function* workspaceBulkTransferSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<TransferProgressEvent>(TRANSFER.PROGRESS, handleProgress);
  yield* all([
    takeLatest(openBulkTransferModal, loadSizes),
    takeLeading(bulkTransferStartRequested, runBulkTransfer),
  ]);
}
