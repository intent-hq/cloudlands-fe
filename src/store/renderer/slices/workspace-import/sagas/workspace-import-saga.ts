/**
 * Workspace Import Saga
 *
 * Drives the main-process import relay over the `transfer:import-*` IPC
 * surface. The File menu's `menu:import-workspace` push opens the wizard and
 * dispatches the start; `transfer:import-start` runs dialog → manifest read
 * → sha256 → chunked `workspace.import.*` upload entirely in main; this saga
 * only observes `transfer:import-progress` counter frames and the settled
 * result. A close mid-flight fires a best-effort `transfer:import-cancel`;
 * a dismissed dialog closes the wizard silently.
 */

import { all, call, put, takeEvery, takeLeading, type SagaGenerator } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ImportProgressEvent, ImportStartResult } from '$shared/types/workspace-transfer';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  closeImportModal,
  importOpenWorkspaceRequested,
  importProgressReceived,
  importRunCancelled,
  importRunFailed,
  importRunSucceeded,
  importStartRequested,
} from '../workspace-import-slice';
import {
  selectImportRunStatus,
  selectImportStep,
  selectImportWorkspaceId,
} from '../workspace-import-selectors';

const logger = createLogger('WorkspaceImportSaga');
const TRANSFER = IPC_CHANNELS.TRANSFER;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function invokeImport<T>(channel: string, params?: unknown): Promise<T> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('import bridge unavailable');
  return (await api.invoke(channel, params)) as T;
}

/** Run the main-process import and settle the run state. */
function* runImport(action: ReturnType<typeof importStartRequested>): SagaGenerator<void> {
  // Only run when the reducer accepted the start (wizard open + running);
  // otherwise a start fired against a settled success screen would launch a
  // headless import whose dispatches the reducer guards drop.
  const step = yield* selectImportStep.effect();
  const runStatus = yield* selectImportRunStatus.effect();
  if (step !== 'importing' || runStatus !== 'running') return;
  const [{ reuseLastFile }] = action.payload;
  try {
    const result = yield* call(invokeImport<ImportStartResult>, TRANSFER.IMPORT_START, {
      reuseLastFile,
    });
    if (result.success) {
      yield* put(
        importRunSucceeded({
          workspaceId: result.workspaceId ?? null,
          workspaceTitle: result.workspaceTitle ?? '',
          interruptedAgents: result.interruptedAgents ?? [],
        }),
      );
    } else if (result.canceled) {
      yield* put(importRunCancelled());
    } else {
      yield* put(importRunFailed(result.error ?? m.workspace_transfer_unknown_error()));
    }
  } catch (error) {
    logger.error('transfer:import-start failed', { error });
    yield* put(importRunFailed(toMessage(error)));
  }
}

/** `transfer:import-progress` counter frames from main → progress dispatches. */
function* handleImportProgress(event: ImportProgressEvent): SagaGenerator<void> {
  yield* put(
    importProgressReceived({
      phase: event.phase,
      bytesTotal: event.bytesTotal,
      bytesUp: event.bytesUp,
      chunksTotal: event.chunksTotal,
      chunksDone: event.chunksDone,
    }),
  );
}

/** File menu push: open the wizard and start the import (dialog first). */
function* handleImportMenu(): SagaGenerator<void> {
  yield* put(importStartRequested({ reuseLastFile: false }));
}

/** Best-effort relay cancel when the wizard closes mid-run. */
function* cancelImportOnClose(): SagaGenerator<void> {
  try {
    yield* call(invokeImport, TRANSFER.IMPORT_CANCEL);
  } catch (error) {
    logger.warn('transfer:import-cancel failed (best-effort)', { error });
  }
}

/** Success screen: navigate to the imported workspace and close the wizard. */
function* openImportedWorkspace(): SagaGenerator<void> {
  const runStatus = yield* selectImportRunStatus.effect();
  const workspaceId = yield* selectImportWorkspaceId.effect();
  if (runStatus !== 'succeeded' || !workspaceId) return;
  yield* put(closeImportModal());
  try {
    yield* call(navigateToRoute, `/workspace/${workspaceId}`);
  } catch (error) {
    logger.warn('Failed to navigate to the imported workspace', { workspaceId, error });
  }
}

export function* workspaceImportSaga(): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<null>('menu:import-workspace', handleImportMenu, {
    bufferPolicy: {
      kind: 'lossless',
      rationale: 'Discrete menu commands must retain arrival order and must not be dropped.',
    },
  });
  yield* takeEveryFromElectronChannel<ImportProgressEvent>(
    TRANSFER.IMPORT_PROGRESS,
    handleImportProgress,
  );
  yield* all([
    takeLeading(importStartRequested, runImport),
    takeEvery(closeImportModal, cancelImportOnClose),
    takeLeading(importOpenWorkspaceRequested, openImportedWorkspace),
  ]);
}
