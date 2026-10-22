import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ProposalActionDetail } from '$shared/types/proposal';
import type { TransferFinalizeResult, TransferStartResult } from '$shared/types/workspace-transfer';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { selectTransferTargetConnections } from '../../workspace-transfer/workspace-transfer-selectors';
import { proposalTransferCheckpoint } from '../proposal-lifecycle-slice';
import type { ProposalApplyResult } from '../proposal-lifecycle-types';
import { persistProposalLifecycleSaga } from './proposal-lifecycle-saga';

async function invokeTransfer<T>(channel: string, params: unknown): Promise<T> {
  if (!isElectronPlatform() || !window.electronAPI?.invoke) {
    throw new Error(m.chat_transfer_desktop_error());
  }
  return (await window.electronAPI.invoke(channel, params)) as T;
}

/** Checkpoints are written before export and after import so reload/retry cannot import twice. */
export function* applyWorkspaceTransferProposal(
  proposalId: string,
  detail: ProposalActionDetail,
  previous?: ProposalApplyResult,
): SagaGenerator<void> {
  if (!isElectronPlatform() || !window.electronAPI?.invoke)
    throw new Error(m.chat_transfer_desktop_error());
  const { proposal, editedFields } = detail;
  if (
    proposal.kind !== 'workspace-transfer' ||
    !proposal.applyToolCallId ||
    proposal.payload.operation !== 'workspace.transfer' ||
    !proposal.payload.workspaceId ||
    !proposal.payload.sourceWorkspacePath
  ) {
    throw new Error(m.chat_transfer_source_error());
  }
  let transfer = previous?.transfer;
  if (!transfer) {
    const sourceConnectionId = yield* selectCurrentConnectionId.effect();
    const connections = yield* selectTransferTargetConnections.effect();
    const destinationConnectionId = editedFields.destinationConnectionId;
    if (editedFields.sourceConnectionId !== sourceConnectionId) {
      throw new Error(m.chat_transfer_source_error());
    }
    if (
      typeof destinationConnectionId !== 'string' ||
      !connections.some((c) => c.id === destinationConnectionId)
    ) {
      throw new Error(m.chat_transfer_destination_error());
    }
    transfer = {
      workspaceId: proposal.payload.workspaceId,
      sourceWorkspacePath: proposal.payload.sourceWorkspacePath,
      sourceConnectionId,
      destinationConnectionId,
      phase: 'transferring',
    };
    yield* put(proposalTransferCheckpoint({ proposalId, transfer }));
    yield* call(persistProposalLifecycleSaga);
  }
  if (transfer.phase === 'transferring') {
    const result = yield* call(invokeTransfer<TransferStartResult>, IPC_CHANNELS.TRANSFER.START, {
      proposalId,
      workspaceId: transfer.workspaceId,
      sourceWorkspacePath: transfer.sourceWorkspacePath,
      sourceConnectionId: transfer.sourceConnectionId,
      destination: { kind: 'server', connectionId: transfer.destinationConnectionId },
    });
    if (!result.success) {
      if (result.failurePhase === 'preflight') {
        yield* put(proposalTransferCheckpoint({ proposalId }));
        yield* call(persistProposalLifecycleSaga);
      }
      throw new Error(result.error || m.workspace_transfer_unknown_error());
    }
    transfer = { ...transfer, phase: 'imported' };
    yield* put(proposalTransferCheckpoint({ proposalId, transfer }));
    yield* call(persistProposalLifecycleSaga);
  }
  const finalized = yield* call(
    invokeTransfer<TransferFinalizeResult>,
    IPC_CHANNELS.TRANSFER.FINALIZE,
    {
      proposalId,
      archiveSource: true,
      restartAgents: false,
    },
  );
  if (!finalized.success) throw new Error(finalized.error || m.workspace_transfer_unknown_error());
}
