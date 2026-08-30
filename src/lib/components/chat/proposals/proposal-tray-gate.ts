import type { AgentMessage } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import type { StoreState } from '$store/renderer/types';
import { selectAgentMessageById } from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  classifyPendingProposalRefs,
  derivePendingProposals,
  missingPendingProposalMessageIds,
  proposalsOf,
  type PendingProposalEntry,
} from './pending-proposals';

/**
 * Production tray gate: derive the ordered pending-proposal entries for the
 * composer-slot tray from the daemon's `pendingProposals` session metadata
 * (PROTOCOL §5.5) intersected with transcript proposal resource blocks and
 * the targeted-recovery cache. Deliberately NO turn-active gating (unlike
 * `deriveWizardPendingQuestions`): proposals do not hold deliveries, so the
 * set stays pending while the agent runs later turns — pendingness clears
 * only on `agent.resolveProposal`. Locally resolved entries (lifecycle
 * 'applied'/'dismissed', reconciled from the wire ack or from other clients'
 * resolutions via `agent:updated`) retire immediately without waiting for
 * the metadata convergence. Absent metadata (old daemon) derives to empty —
 * the tray degrades to today's transcript-only cards. Lives outside
 * pending-proposals.ts so that module stays dependency-light (no stores).
 */
export function deriveTrayPendingProposals(
  state: StoreState,
  agentId: string,
  messages: readonly AgentMessage[],
): PendingProposalEntry[] {
  const session = state.agentSessions?.byAgentId[agentId];
  const refs = classifyPendingProposalRefs(session?.metadata?.pendingProposals);
  if (refs.length === 0) return [];
  const recovery = state.chatState?.byAgentId[agentId]?.pendingProposalRecovery;
  const lifecycle = state.proposalLifecycle ?? {};
  const unresolved = refs.filter((ref) => {
    const status = lifecycle[ref.proposalId]?.status;
    return status !== 'applied' && status !== 'dismissed';
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  return derivePendingProposals(unresolved, (messageId) => {
    const resident =
      byId.get(messageId) ?? selectAgentMessageById.select(state, agentId, messageId);
    if (resident) return resident.isStreaming ? undefined : proposalsOf(resident);
    const recovered = recovery?.[messageId];
    if (recovered?.status !== 'found' || !recovered.proposals) return undefined;
    return new Map<string, Proposal>(
      recovered.proposals.map(({ proposalId, proposal }) => [proposalId, proposal]),
    );
  });
}

export interface PendingProposalRecoveryRequest {
  messageId: string;
  shouldRequest: boolean;
  loading: boolean;
}

/** Describe the targeted lookups needed for refs whose message is not loaded. */
export function derivePendingProposalRecoveryState(
  state: StoreState,
  agentId: string,
): PendingProposalRecoveryRequest[] {
  const session = state.agentSessions?.byAgentId[agentId];
  const refs = classifyPendingProposalRefs(session?.metadata?.pendingProposals);
  if (refs.length === 0) return [];
  const lifecycle = state.proposalLifecycle ?? {};
  const unresolved = refs.filter((ref) => {
    const status = lifecycle[ref.proposalId]?.status;
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
