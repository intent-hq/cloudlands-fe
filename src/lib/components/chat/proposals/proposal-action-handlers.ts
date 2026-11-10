import type { PendingProposalRef } from '$shared/types';
import type { ProposalActionDetail } from '$shared/types/proposal';
import { agentProposalResolveRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
import type { ProposalLifecycleState } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-types';
import {
  applyProposalRequested,
  agentScopedProposalKey,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
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

// A legacy (title-keyed) ref key can repeat across messages, so the remembered
// card identity is scoped to the carrying message: a new card must never
// inherit an earlier card's applied/dismissed lifecycle through a shared key.
function localIdentityKey(agentId: string, ref: PendingProposalRef): string {
  return `${proposalKey(agentId, ref.proposalId)}@${ref.messageId}`;
}

export function rememberProposalIdentity(
  agentId: string,
  ref: PendingProposalRef,
  localId: string,
): void {
  localProposalIds.set(localIdentityKey(agentId, ref), localId);
}

/** Card-keyed lifecycle id a card rendered from the ref's carrying message recorded. */
export function rememberedProposalIdentity(
  agentId: string,
  ref: PendingProposalRef,
): string | undefined {
  return localProposalIds.get(localIdentityKey(agentId, ref));
}

// The daemon rejects a blank or over-256-byte origin id with -32602 before
// creating anything (PROTOCOL §5.1 "Proposal origin"). A title-keyed card can
// carry such a key; send no origin for it and keep the chat fallback instead.
const MAX_ORIGIN_ID_BYTES = 256;
function isSendableOriginId(id: string): boolean {
  return id.trim() !== '' && new TextEncoder().encode(id).length <= MAX_ORIGIN_ID_BYTES;
}

export function applyProposal(
  agentId: string,
  detail: ProposalActionDetail,
  messageId?: string,
): void {
  const { proposal } = detail;
  const proposalId = pendingProposalKeyOf(proposal);
  if (messageId) {
    rememberProposalIdentity(
      agentId,
      { proposalId, messageId },
      detail.lifecycleId ?? getProposalId(proposal),
    );
  }
  if (proposal.kind === 'workspace-transfer') {
    appStore.dispatch(
      applyProposalRequested({ proposalId: getProposalId(proposal), kind: proposal.kind, detail }),
    );
    return;
  }
  if (proposal.kind === 'workspace-create' || proposal.kind === 'bulk-op') {
    appStore.dispatch(
      applyWorkspaceProposal({
        proposal,
        editedFields: detail.editedFields,
        selectedBulkItemIds: detail.selectedBulkItemIds,
        ...(detail.lifecycleId ? { lifecycleId: detail.lifecycleId } : {}),
        // The daemon resolves the card as part of the create (intent-hq/intent#8086),
        // so the proposing agent hears about it even when this chat is closed.
        ...(proposal.kind === 'workspace-create' && agentId && isSendableOriginId(proposalId)
          ? { origin: { kind: 'proposal' as const, agentId, proposalId } }
          : {}),
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
  const request = appStore
    .dispatch(action)
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
    const localId = rememberedProposalIdentity(input.agentId, ref);
    const scoped = input.lifecycle[agentScopedProposalKey(input.agentId, ref.proposalId)];
    const local = localId ? input.lifecycle[localId] : undefined;
    const applied =
      scoped?.status === 'applied' ? scoped : local?.status === 'applied' ? local : null;
    if (!applied) continue;
    // A daemon that handles `workspace.create` `origin` reports it on the
    // result: it resolved the card itself, or declined it on purpose (e.g. a
    // replay naming another card) — resolving it here would undo that.
    // Only an older daemon (no report) needs this client-side fallback.
    if (applied.result?.proposalOrigin ?? local?.result?.proposalOrigin) continue;
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
