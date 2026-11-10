import type { PendingProposalRef } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import type { StoreState } from '$store/renderer/types';
import { selectAgentMessageById } from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  classifyPendingProposalRefs,
  effectivelyPendingProposalRefs,
  missingPendingProposalMessageIds,
  proposalsOf,
} from './pending-proposals';
import { rememberedProposalIdentity } from './proposal-action-handlers';
import { getCardProposalId } from './proposal-id';

export interface PendingProposalRecoveryRequest {
  messageId: string;
  shouldRequest: boolean;
  loading: boolean;
}

function refProposalBody(
  state: StoreState,
  agentId: string,
  ref: PendingProposalRef,
): Proposal | undefined {
  const message = selectAgentMessageById.select(state, agentId, ref.messageId);
  if (message) return proposalsOf(message).get(ref.proposalId);
  return state.chatState?.byAgentId[agentId]?.pendingProposalRecovery?.[
    ref.messageId
  ]?.proposals?.find((entry) => entry.proposalId === ref.proposalId)?.proposal;
}

/**
 * Card-keyed lifecycle id for a metadata ref: derived from the ref's proposal
 * body (resident row or recovery cache) exactly as the card derives it, else
 * the identity a card rendered from the ref's carrying message remembered (a
 * same-key card in another message never lends its lifecycle).
 */
export function pendingProposalLocalIdResolver(
  state: StoreState,
  agentId: string,
): (ref: PendingProposalRef) => string | undefined {
  return (ref) => {
    const proposal = refProposalBody(state, agentId, ref);
    return proposal
      ? getCardProposalId(proposal, agentId, ref.messageId)
      : rememberedProposalIdentity(agentId, ref);
  };
}

/**
 * The agent's metadata refs filtered by the same rule the inline card uses
 * (`isPendingProposalCard`): a ref with an applied/dismissed outcome — local
 * lifecycle under either identity, or daemon `proposalResolutions` — is not
 * pending.
 */
function selectEffectivelyPendingProposalRefs(
  state: StoreState,
  agentId: string,
): PendingProposalRef[] {
  const session = state.agentSessions?.byAgentId[agentId];
  const refs = classifyPendingProposalRefs(session?.metadata?.pendingProposals);
  if (refs.length === 0) return [];
  return effectivelyPendingProposalRefs(
    agentId,
    refs,
    { lifecycle: state.proposalLifecycle, resolutions: session?.metadata?.proposalResolutions },
    pendingProposalLocalIdResolver(state, agentId),
  );
}

/** Describe targeted lookups needed for refs whose message is not loaded. */
export function derivePendingProposalRecoveryState(
  state: StoreState,
  agentId: string,
): PendingProposalRecoveryRequest[] {
  const unresolved = selectEffectivelyPendingProposalRefs(state, agentId);
  if (unresolved.length === 0) return [];
  const missing = missingPendingProposalMessageIds(
    unresolved,
    (messageId) => selectAgentMessageById.select(state, agentId, messageId) !== undefined,
  );
  const recovery = state.chatState?.byAgentId[agentId]?.pendingProposalRecovery;
  return missing.map((messageId) => {
    const entry = recovery?.[messageId];
    if (entry) {
      const recovered = entry.status === 'found' && (entry.proposals?.length ?? 0) > 0;
      return { messageId, shouldRequest: false, loading: !recovered && entry.status === 'loading' };
    }
    return { messageId, shouldRequest: true, loading: true };
  });
}
