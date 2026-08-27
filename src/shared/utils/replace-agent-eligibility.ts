export interface ReplaceAgentSessionLike {
  isBackground?: boolean | null;
  metadata?: Record<string, unknown> | null;
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
 * - top-level: no `metadata.createdByAgentId` / `metadata.parentAgentId`
 * - non-background: neither `isBackground` nor `metadata.isBackground` is true
 * - not retired: `retiredAt` unset
 */
export function isReplaceAgentEligible(session?: ReplaceAgentSessionLike | null): boolean {
  if (!session) return false;
  if (session.harnessFeatures?.peerAgents !== true) return false;
  const metadata = session.metadata ?? {};
  if (metadata.createdByAgentId || metadata.parentAgentId) return false;
  if (session.isBackground === true || metadata.isBackground === true) return false;
  if (session.retiredAt) return false;
  return true;
}
