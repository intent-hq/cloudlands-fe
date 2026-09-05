import type { StoreState } from '$store/renderer/types';
import { selectAgentMessageById } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { agentScopedProposalKey } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
import { classifyPendingProposalRefs, missingPendingProposalMessageIds } from './pending-proposals';

export interface PendingProposalRecoveryRequest {
  messageId: string;
  shouldRequest: boolean;
  loading: boolean;
}

/** Describe targeted lookups needed for refs whose message is not loaded. */
export function derivePendingProposalRecoveryState(
  state: StoreState,
  agentId: string,
): PendingProposalRecoveryRequest[] {
  const session = state.agentSessions?.byAgentId[agentId];
  const refs = classifyPendingProposalRefs(session?.metadata?.pendingProposals);
  if (refs.length === 0) return [];
  const lifecycle = state.proposalLifecycle ?? {};
  const unresolved = refs.filter((ref) => {
    const status = lifecycle[agentScopedProposalKey(agentId, ref.proposalId)]?.status;
    return status !== 'applied' && status !== 'dismissed';
  });
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
