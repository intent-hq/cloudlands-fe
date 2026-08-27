export interface ReplaceAgentSessionLike {
  isBackground?: boolean | null;
  metadata?: Record<string, unknown> | null;
  /** Alternative location for AgentMetadata (see AgentSession.agentMetadata). */
  agentMetadata?: Record<string, unknown> | null;
  retiredAt?: string | null;
  harnessFeatures?: Record<string, boolean> | null;
}

/**
 * Eligibility for the "Replace Agent" menu action (peer-agent hand-off).
 *
 * Eligible only when ALL gates pass:
 * - harness gate: the session's creation-time harnessFeatures snapshot
 *   (PROTOCOL §5.5) has `peerAgents === true` — an absent snapshot means
 *   ineligible; the live `agentFeatures.peerAgents` setting is never read
 * - top-level: no `createdByAgentId` / `parentAgentId` in either metadata
 *   record (`metadata` or its documented alternative location `agentMetadata`)
 * - non-background: neither `isBackground` nor either metadata record's
 *   `isBackground` is true
 * - not retired: `retiredAt` unset
 */
export function isReplaceAgentEligible(session?: ReplaceAgentSessionLike | null): boolean {
  if (!session) return false;
  if (session.harnessFeatures?.peerAgents !== true) return false;
  const records = [session.metadata ?? {}, session.agentMetadata ?? {}];
  if (records.some((r) => r.createdByAgentId || r.parentAgentId)) return false;
  if (session.isBackground === true || records.some((r) => r.isBackground === true)) return false;
  if (session.retiredAt) return false;
  return true;
}
