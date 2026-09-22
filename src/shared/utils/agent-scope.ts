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
 * This is the ONE classifier every FE consumer of an `AgentSession`-shaped
 * row must go through — the workspace-agents state (`scopeCounts` /
 * `delegatedCounts` nudges), the lifecycle sagas, the Agents-panel list, and
 * the top-level-only product gates (unread dot, Replace Agent, empty-layout
 * primary agent, "Delegated by" labels) — so per-parent counts, rendered
 * groups and those gates can never disagree about which bin a row is in.
 * The §5.1 `agentSummary` rows the HUD reads are a different shape and keep
 * their own summary-side check (`hud-selectors` `isTopLevelAgent`).
 *
 * Dependency-light per AGENTS.md: pure functions, no stores or services.
 */

import type { AgentId, AgentListBin } from '$shared/types';

/** The two metadata keys the partition reads, in either metadata location. */
export interface AgentScopeMetadata {
  isBackground?: unknown;
  createdByAgentId?: unknown;
}

/**
 * The structural subset of `AgentSession` the partition reads. `agentMetadata`
 * is the documented alternative location of `metadata` (see `AgentSession`)
 * and is consulted for the same two keys.
 */
export interface AgentScopeInputs {
  parentAgentId?: string | null;
  isBackground?: boolean | null;
  metadata?: AgentScopeMetadata | null;
  agentMetadata?: AgentScopeMetadata | null;
}

/** The persisted background flag (`isBackground`, mirrored as `metadata.isBackground`). */
export function isBackgroundAgentSession(agent: AgentScopeInputs): boolean {
  return (
    agent.isBackground === true ||
    agent.metadata?.isBackground === true ||
    agent.agentMetadata?.isBackground === true
  );
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
    return agent.parentAgentId as AgentId;
  }
  for (const createdBy of [
    agent.metadata?.createdByAgentId,
    agent.agentMetadata?.createdByAgentId,
  ]) {
    if (typeof createdBy === 'string' && createdBy.length > 0) {
      return createdBy as AgentId;
    }
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
