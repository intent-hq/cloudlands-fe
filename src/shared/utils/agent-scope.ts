/**
 * The `agent.list` bin partition (PROTOCOL §5.5 "Row scope"), derived from
 * the same two fields the daemon partitions by — `parent_agent_id` and
 * `is_background`:
 *
 *   topLevel   = parentAgentId IS NULL AND NOT isBackground
 *   delegated  = parentAgentId IS NOT NULL   (a background CHILD is delegated)
 *   background = parentAgentId IS NULL AND isBackground
 *
 * The bins are pairwise disjoint and cover every non-retired row. Retired
 * sessions (`retiredAt` set) are their own bin and never classify here —
 * callers check `retiredAt` first; the classifier ignores it, so it also
 * names the bin a row re-enters on restore.
 *
 * This is the ONE classifier every FE consumer must go through — the
 * workspace-agents state (`scopeCounts` / `delegatedCounts` nudges), the
 * lifecycle sagas and the Agents-panel list — so per-parent counts and
 * rendered groups can never disagree about which bin a row is in.
 *
 * Dependency-light per AGENTS.md: pure functions, no stores or services.
 */

import type { AgentId, AgentListBin, AgentSession } from '$shared/types';

type AgentScopeInputs = Pick<AgentSession, 'parentAgentId' | 'isBackground' | 'metadata'>;

/** The persisted background flag (`isBackground`, mirrored as `metadata.isBackground`). */
export function isBackgroundAgentSession(agent: AgentScopeInputs): boolean {
  return agent.isBackground === true || agent.metadata?.isBackground === true;
}

/**
 * The `delegatedCounts.byParent` key a delegated row counts under (§5.5): the
 * wire `parentAgentId` the daemon groups by, with `metadata.createdByAgentId`
 * (older rows) as the fallback. `null` for an unparented row — the fork
 * marker `parentSessionId` is a session reference, not a parent agent, and
 * never parents a row.
 */
export function agentDelegationParentOf(agent: AgentScopeInputs): AgentId | null {
  if (typeof agent.parentAgentId === 'string' && agent.parentAgentId.length > 0) {
    return agent.parentAgentId;
  }
  if (typeof agent.metadata?.createdByAgentId === 'string' && agent.metadata.createdByAgentId) {
    return agent.metadata.createdByAgentId as AgentId;
  }
  return null;
}

/**
 * The bin a non-retired row partitions into. A row classifies as `delegated`
 * iff `agentDelegationParentOf` names a parent — exactly when it has a
 * `byParent` key to count under.
 */
export function classifyAgentScope(agent: AgentScopeInputs): AgentListBin {
  if (agentDelegationParentOf(agent) !== null) {
    return 'delegated';
  }
  return isBackgroundAgentSession(agent) ? 'background' : 'topLevel';
}
