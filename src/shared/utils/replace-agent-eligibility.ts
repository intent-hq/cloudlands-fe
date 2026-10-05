import { classifyAgentScope, type AgentScopeInputs } from './agent-scope';

export interface ReplaceAgentSessionLike extends AgentScopeInputs {
  retiredAt?: string | null;
  harnessFeatures?: Record<string, boolean> | null;
}

/**
 * Eligibility for the "Replace Agent" menu action (peer-agent hand-off).
 *
 * Eligible only when ALL gates pass:
 * - harness gate: the session's creation-time harnessFeatures snapshot
 *   (PROTOCOL §5.5) has `peerAgents === true` — an absent snapshot means
 *   ineligible; the live `agentFeatures.peerAgents` setting is never read.
 *   The snapshot is detail-only (stripped from `agent.list` rows), so a
 *   session known only from a list row is ineligible until an `agent.get`
 *   has filled it in — callers ensure that read (`ensureAgentSessionLoaded`)
 *   and re-evaluate reactively rather than treating a first `false` as final
 * - top-level: the shared `agent-scope` classifier bins the session as
 *   `topLevel` — no wire `parentAgentId`, no `createdByAgentId` and no
 *   `isBackground` in either metadata record (`metadata` or its documented
 *   alternative location `agentMetadata`)
 * - not retired: `retiredAt` unset
 */
export function isReplaceAgentEligible(session?: ReplaceAgentSessionLike | null): boolean {
  if (!session) return false;
  if (session.harnessFeatures?.peerAgents !== true) return false;
  if (classifyAgentScope(session) !== 'topLevel') return false;
  if (session.retiredAt) return false;
  return true;
}
