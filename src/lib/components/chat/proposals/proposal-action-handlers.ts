import type { PendingProposalRef } from '$shared/types';
import type { Proposal, ProposalActionDetail } from '$shared/types/proposal';
import { agentProposalResolveRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
import type {
  ProposalLifecycleEntry,
  ProposalLifecycleState,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-types';
import { agentScopedProposalKey } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
import { applyWorkspaceProposal } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import { store as appStore } from '$store/renderer/store';
import type { PendingProposalEntry } from './pending-proposals';
import { pendingProposalKeyOf } from './pending-proposals';
import { getProposalId } from './proposal-id';
import { clearProposalDraft } from './proposal-draft-storage';
import { applySettingsProposal, undoSettingsProposal } from './settings-proposal-actions';
import { applySpecialistProposal, undoSpecialistProposal } from './specialist-proposal-actions';

const localProposalIds = new Map<string, string>();
const resolutionRequests = new Map<string, Promise<void>>();

function proposalKey(agentId: string, proposalId: string): string {
  return `${agentId}::${proposalId}`;
}

function entryTimestamp(entry: ProposalLifecycleEntry): number {
  return entry.completedAt ?? entry.startedAt ?? 0;
}

export function rememberProposalIdentity(
  agentId: string,
  proposalId: string,
  proposal: Proposal,
): void {
  localProposalIds.set(proposalKey(agentId, proposalId), getProposalId(proposal));
}

export function getProposalLifecycleEntry(
  lifecycle: ProposalLifecycleState,
  agentId: string,
  proposalId: string,
  proposal: Proposal,
): ProposalLifecycleEntry | undefined {
  const localId = localProposalIds.get(proposalKey(agentId, proposalId)) ?? getProposalId(proposal);
  const local = lifecycle[localId];
  const scoped = lifecycle[agentScopedProposalKey(agentId, proposalId)];
  if (!local) return scoped;
  if (!scoped || entryTimestamp(local) > entryTimestamp(scoped)) return local;
  return { ...local, ...scoped, result: scoped.result ?? local.result };
}

export function applyProposal(agentId: string, detail: ProposalActionDetail): void {
  const { proposal } = detail;
  rememberProposalIdentity(agentId, pendingProposalKeyOf(proposal), proposal);
  if (proposal.kind === 'workspace-create' || proposal.kind === 'bulk-op') {
    appStore.dispatch(
      applyWorkspaceProposal({
        proposal,
        editedFields: detail.editedFields,
        selectedBulkItemIds: detail.selectedBulkItemIds,
      }),
    );
    return;
  }
  if (applySpecialistProposal(detail)) return;
  applySettingsProposal(detail);
}

export function undoProposal(proposalId: string): void {
  if (undoSpecialistProposal(proposalId)) return;
  undoSettingsProposal(proposalId);
}

function requestResolution(input: {
  agentId: string;
  workspaceId: string;
  proposalId: string;
  outcome: 'applied' | 'dismissed';
  detail?: string;
  clearDraftBeforeRequest?: boolean;
}): Promise<void> {
  const key = proposalKey(input.agentId, input.proposalId);
  const existing = resolutionRequests.get(key);
  if (existing) return existing;
  if (input.clearDraftBeforeRequest) clearProposalDraft(input.agentId, input.proposalId);
  const action = agentProposalResolveRequested(input.agentId, input.workspaceId, {
    proposalId: input.proposalId,
    outcome: input.outcome,
    ...(input.detail ? { detail: input.detail } : {}),
  });
  appStore.dispatch(action);
  const request = action.promise
    .then(() => {
      if (!input.clearDraftBeforeRequest) clearProposalDraft(input.agentId, input.proposalId);
    })
    .catch((error) => {
      resolutionRequests.delete(key);
      throw error;
    });
  resolutionRequests.set(key, request);
  return request;
}

export function dismissProposal(
  agentId: string,
  workspaceId: string,
  entry: PendingProposalEntry,
): Promise<void> {
  return requestResolution({
    agentId,
    workspaceId,
    proposalId: entry.proposalId,
    outcome: 'dismissed',
  });
}

export function reconcileAppliedProposals(input: {
  agentId: string;
  workspaceId: string;
  refs: readonly PendingProposalRef[];
  lifecycle: ProposalLifecycleState;
}): void {
  for (const ref of input.refs) {
    const localId = localProposalIds.get(proposalKey(input.agentId, ref.proposalId));
    const scoped = input.lifecycle[agentScopedProposalKey(input.agentId, ref.proposalId)];
    const local = localId ? input.lifecycle[localId] : undefined;
    const applied =
      scoped?.status === 'applied' ? scoped : local?.status === 'applied' ? local : null;
    if (!applied) continue;
    const workspaceId = applied.result?.workspaceId ?? local?.result?.workspaceId;
    // i18n-ignore (wire detail appended to the model notice, not UI copy)
    const detail = workspaceId ? `Created workspace ${workspaceId}.` : undefined;
    void requestResolution({
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      proposalId: ref.proposalId,
      outcome: 'applied',
      detail,
      clearDraftBeforeRequest: true,
    }).catch(() => {});
  }
}
