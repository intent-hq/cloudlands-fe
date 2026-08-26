/**
 * Workspace Transfer Saga
 *
 * Steps 1–2: fetches the read-only `workspace.transfer.plan` (PROTOCOL §5.1)
 * when the wizard advances to the confirm step (`takeLatest` so a Back → Next
 * cycle cancels the stale fetch instead of racing two responses).
 *
 * Steps 3–4: drives the main-process relay over the `transfer:*` IPC surface
 * — `transfer:start` runs export → chunk relay → import commit (or a local
 * download) entirely in main; this saga only observes `transfer:progress`
 * counter frames and the settled result. `transfer:finalize` settles the
 * source (archive + status message) and optionally resumes agents on the
 * target; a close mid-flight fires a best-effort `transfer:cancel`.
 */

import { all, call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { formatDate } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  SessionOwnershipErrorCode,
  TransferFinalizeResult,
  TransferProgressEvent,
  TransferStartResult,
} from '$shared/types/workspace-transfer';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { switchConnectionRequested } from '../../connections/connections-slice';
import {
  closeTransferModal,
  transferFinalizeFailed,
  transferFinalizeRequested,
  transferFinalizeSucceeded,
  transferPlanFailed,
  transferPlanLoaded,
  transferPlanRequested,
  transferProgressReceived,
  transferRunCancelled,
  transferRunFailed,
  transferRunSucceeded,
  transferStartRequested,
} from '../workspace-transfer-slice';
import {
  selectTransferArchiveSource,
  selectTransferDestinationValue,
  selectTransferRestartAgents,
  selectTransferTargetConnections,
  selectTransferWorkspaceId,
} from '../workspace-transfer-selectors';
import type { TransferPlanWireResult } from '../workspace-transfer-types';

const logger = createLogger('WorkspaceTransferSaga');
const TRANSFER = IPC_CHANNELS.TRANSFER;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Localized message for a failed relay result, keyed by machine code. */
function failureMessage(result: { error?: string; code?: SessionOwnershipErrorCode }): string {
  if (result.code === 'not-session-owner') return m.workspace_transfer_notSessionOwner_error();
  return result.error ?? m.workspace_transfer_unknown_error();
}

async function invokeTransfer<T>(channel: string, params?: unknown): Promise<T> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('transfer bridge unavailable');
  return (await api.invoke(channel, params)) as T;
}

function* fetchTransferPlan(): SagaGenerator<void> {
  const workspaceId = yield* selectTransferWorkspaceId.effect();
  if (!workspaceId) return;
  try {
    const result = yield* call(backendRequest<TransferPlanWireResult>, 'workspace.transfer.plan', {
      workspaceId,
    });
    yield* put(transferPlanLoaded(result.plan));
  } catch (error) {
    logger.error('workspace.transfer.plan failed', { workspaceId, error });
    yield* put(transferPlanFailed(toMessage(error)));
  }
}

/** Step 3: run the main-process relay and settle the run state. */
function* runTransfer(): SagaGenerator<void> {
  const workspaceId = yield* selectTransferWorkspaceId.effect();
  const destination = yield* selectTransferDestinationValue.effect();
  if (!workspaceId || !destination) return;
  try {
    const result = yield* call(invokeTransfer<TransferStartResult>, TRANSFER.START, {
      workspaceId,
      destination,
    });
    if (result.success) {
      yield* put(
        transferRunSucceeded({
          interruptedAgents: result.interruptedAgents ?? [],
          downloadFilePath: result.filePath ?? null,
        }),
      );
    } else if (result.canceled) {
      yield* put(transferRunCancelled());
    } else {
      yield* put(transferRunFailed(failureMessage(result)));
    }
  } catch (error) {
    logger.error('transfer:start failed', { workspaceId, error });
    yield* put(transferRunFailed(toMessage(error)));
  }
}

/** `transfer:progress` counter frames from main → progress dispatches. */
function* handleTransferProgress(event: TransferProgressEvent): SagaGenerator<void> {
  const workspaceId = yield* selectTransferWorkspaceId.effect();
  if (!workspaceId || event.workspaceId !== workspaceId) return;
  yield* put(
    transferProgressReceived({
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

/** Fail-soft warning toast when the target could not resume some agents. */
async function showResumeFailedToast(count: number): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.warning(
      count === 1
        ? m.workspace_transfer_resumeFailed_one()
        : m.workspace_transfer_resumeFailed_many({ count }),
    );
  } catch (error) {
    logger.warn('Failed to surface resume-failure toast', { error });
  }
}

/** Human label for the final status message ("Transferred to <target> …"). */
function* resolveDestinationLabel(): SagaGenerator<string> {
  const destination = yield* selectTransferDestinationValue.effect();
  if (!destination || destination.kind === 'download') {
    return m.workspace_transfer_destinationDownload_label();
  }
  const connections = yield* selectTransferTargetConnections.effect();
  const record = connections.find((c) => c.id === destination.connectionId);
  if (!record) return destination.connectionId;
  return (
    record.hostname ||
    record.label ||
    (record.host ? `${record.host}:${record.port}` : destination.connectionId)
  );
}

/** Step 4: settle the source, optionally resume target agents + switch. */
function* finalizeTransfer(
  action: ReturnType<typeof transferFinalizeRequested>,
): SagaGenerator<void> {
  const [{ switchToTarget }] = action.payload;
  const destination = yield* selectTransferDestinationValue.effect();
  const archiveSource = yield* selectTransferArchiveSource.effect();
  const restartAgents = yield* selectTransferRestartAgents.effect();
  const label = yield* resolveDestinationLabel();
  const finalStatusMessage =
    destination?.kind === 'server' && archiveSource
      ? m.workspace_transfer_finalStatus_message({
          destination: label,
          date: formatDate(new Date()),
        })
      : undefined;
  try {
    const result = yield* call(invokeTransfer<TransferFinalizeResult>, TRANSFER.FINALIZE, {
      // Archiving the source only makes sense for server transfers; a download
      // leaves the workspace in place, so the flag is forced off there.
      archiveSource: destination?.kind === 'server' ? archiveSource : false,
      restartAgents: destination?.kind === 'server' ? restartAgents : false,
      ...(finalStatusMessage ? { finalStatusMessage } : {}),
    });
    if (!result.success) {
      yield* put(transferFinalizeFailed(failureMessage(result)));
      return;
    }
    yield* put(transferFinalizeSucceeded());
    // A successful finalize can still carry agents the target failed to
    // resume — surface them instead of silently closing over the promise
    // that in-flight agents restart.
    const resumeFailed = result.resumeFailed ?? [];
    if (resumeFailed.length > 0) {
      yield* call(showResumeFailedToast, resumeFailed.length);
    }
    yield* put(closeTransferModal());
    if (switchToTarget && destination?.kind === 'server') {
      yield* put(switchConnectionRequested(destination.connectionId));
    }
  } catch (error) {
    logger.error('transfer:finalize failed', { error });
    yield* put(transferFinalizeFailed(toMessage(error)));
  }
}

/**
 * Best-effort relay cleanup when the wizard closes: cancels an in-flight run
 * and aborts a committed-but-unfinalized export's staging on the source.
 * Idempotent in main — a close with no live session is a no-op.
 */
function* cancelTransferOnClose(): SagaGenerator<void> {
  try {
    yield* call(invokeTransfer, TRANSFER.CANCEL);
  } catch (error) {
    logger.warn('transfer:cancel failed (best-effort)', { error });
  }
}

export function* workspaceTransferSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<TransferProgressEvent>(
    TRANSFER.PROGRESS,
    handleTransferProgress,
  );
  yield* all([
    takeLatest(transferPlanRequested, fetchTransferPlan),
    takeLatest(transferStartRequested, runTransfer),
    takeLatest(transferFinalizeRequested, finalizeTransfer),
    takeEvery(closeTransferModal, cancelTransferOnClose),
  ]);
}
