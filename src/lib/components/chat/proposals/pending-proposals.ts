import type { AgentMessage, PendingProposalRef } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import { getProposalFromResourceBlock } from '$shared/types/proposal-resource';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';

/**
 * Pending-proposal derivation for inline transcript cards and the off-screen
 * composer chip. The daemon's ordered `pendingProposals` session-metadata set
 * (PROTOCOL §5.5) is the single authority for WHICH proposals pend; the
 * transcript's lifted proposal resource blocks supply the proposal bodies.
 * Absent metadata means an old daemon, so no proposals are treated as pending.
 *
 * Unlike `derivePendingQuestions` there is NO turn-active gating: proposals
 * do not hold deliveries, so the set stays pending while the agent keeps
 * responding/streaming — pendingness clears only on `agent.resolveProposal`.
 * Dependency-light on purpose — no stores or components.
 */

export interface PendingProposalEntry {
  /** Stable proposal identity (`applyToolCallId ?? preview.title` derived). */
  proposalId: string;
  /** Id of the assistant message carrying the proposal resource block. */
  messageId: string;
  /** The parsed proposal body. */
  proposal: Proposal;
}

/**
 * Daemon-parity proposal identity: `applyToolCallId ?? preview.title` (raw
 * title, not percent-encoded), matching intentd's `proposal_block_id` — the
 * key its `pendingProposals` metadata refs carry. Id-less proposals (e.g.
 * proposeSibling) fall to the title, so this must NOT be swapped for
 * `getProposalId` (whose fallback is a payload hash the daemon never emits).
 */
export function pendingProposalKeyOf(proposal: Proposal): string {
  return proposal.applyToolCallId ?? proposal.preview.title;
}

/** All parsed proposal bodies on a message, keyed by daemon-parity identity. */
export function proposalsOf(message: AgentMessage): Map<string, Proposal> {
  const byId = new Map<string, Proposal>();
  if (message.role !== 'assistant') return byId;
  for (const block of dedupeResourceBlocks(message.contentBlocks ?? [])) {
    const proposal = getProposalFromResourceBlock(block);
    if (proposal === null) continue;
    const id = pendingProposalKeyOf(proposal);
    if (!byId.has(id)) byId.set(id, proposal);
  }
  return byId;
}

/** Validate a raw metadata value into ordered refs; [] when absent/malformed. */
export function classifyPendingProposalRefs(pendingProposals: unknown): PendingProposalRef[] {
  if (!Array.isArray(pendingProposals)) return [];
  const refs: PendingProposalRef[] = [];
  const seen = new Set<string>();
  for (const entry of pendingProposals) {
    if (!entry || typeof entry !== 'object') continue;
    const { proposalId, messageId } = entry as Record<string, unknown>;
    if (typeof proposalId !== 'string' || proposalId.length === 0) continue;
    if (typeof messageId !== 'string' || messageId.length === 0) continue;
    if (seen.has(proposalId)) continue;
    seen.add(proposalId);
    refs.push({ proposalId, messageId });
  }
  return refs;
}

/**
 * Intersect the metadata refs with the proposal bodies available per carrying
 * message (resident transcript rows and/or the targeted-recovery cache).
 * Returns entries in metadata order; refs whose message OR matching block is
 * unavailable are skipped (never invented). `resolveProposals` receives each
 * ref's carrying messageId once and returns the message's proposals keyed by
 * their stable identity (`proposalsOf` for transcript rows), or undefined
 * when the message is unavailable.
 */
export function derivePendingProposals(
  refs: readonly PendingProposalRef[],
  resolveProposals: (messageId: string) => ReadonlyMap<string, Proposal> | undefined,
): PendingProposalEntry[] {
  if (refs.length === 0) return [];
  const proposalsByMessage = new Map<string, ReadonlyMap<string, Proposal>>();
  const entries: PendingProposalEntry[] = [];
  for (const ref of refs) {
    let byId = proposalsByMessage.get(ref.messageId);
    if (!byId) {
      byId = resolveProposals(ref.messageId) ?? new Map();
      proposalsByMessage.set(ref.messageId, byId);
    }
    const proposal = byId.get(ref.proposalId);
    if (!proposal) continue;
    entries.push({ proposalId: ref.proposalId, messageId: ref.messageId, proposal });
  }
  return entries;
}

/**
 * Metadata refs whose carrying message is not resident — the targeted
 * `aroundMessageId` recovery candidates (deduped, metadata order).
 */
export function missingPendingProposalMessageIds(
  refs: readonly PendingProposalRef[],
  hasMessage: (messageId: string) => boolean,
): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.messageId)) continue;
    seen.add(ref.messageId);
    if (!hasMessage(ref.messageId)) missing.push(ref.messageId);
  }
  return missing;
}
