/**
 * Fleet HUD Selectors
 *
 * Reads over the hud slice plus HUD-shaped rollups derived from the canonical
 * workspace slice (`workspace.list` aggregates: `displayStatus`,
 * `agentSummary`, `taskStats` — PROTOCOL §5.1). The hud slice's live
 * `displayStatusByWorkspaceId` overrides win over the entity's enrichment
 * value so `workspace:displayStatus-changed` transitions render without a
 * refetch.
 */

import { store } from "../../store";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";
import {
  WORKSPACE_DISPLAY_STATUS_VALUES,
  WorkspaceStatus,
  type WorkspaceDisplayStatus,
  type Workspace,
  type WorkspaceAgentInfo,
} from "$shared/types";
import type { HudAgentStateBucket } from "./hud-types";
import { HUD_AGENT_STATE_BUCKETS, toHudAgentStateBucket } from "./hud-types";

export const selectHudActive = store.createSelector((state) => state.hud.active);

export const selectHudFeed = store.createSelector((state) => state.hud.feed);

export const selectHudUsage = store.createSelector((state) => state.hud.usage);

export const selectHudUsageError = store.createSelector((state) => state.hud.usageError);

export const selectHudSystem = store.createSelector((state) => state.hud.system);

export const selectHudAttentionByWorkspaceId = store.createSelector(
  (state) => state.hud.attentionByWorkspaceId,
);

/**
 * Effective display status for a workspace: the live event override when one
 * arrived, else the entity's `workspace.list` enrichment value.
 */
function effectiveDisplayStatus(
  workspace: Workspace,
  overrides: Record<string, WorkspaceDisplayStatus>,
): WorkspaceDisplayStatus | undefined {
  return overrides[String(workspace.id)] ?? workspace.displayStatus;
}

/** Non-archived workspaces the HUD renders, with live displayStatus applied. */
export const selectHudWorkspaces = store.createSelector((state): Workspace[] => {
  const overrides = state.hud.displayStatusByWorkspaceId;
  return getItems(state.workspace.workspaces)
    .filter(
      (workspace) =>
        workspace.status !== WorkspaceStatus.Archived &&
        workspace.status !== WorkspaceStatus.Deleted,
    )
    .map((workspace) => {
      const displayStatus = effectiveDisplayStatus(workspace, overrides);
      return displayStatus && displayStatus !== workspace.displayStatus
        ? { ...workspace, displayStatus }
        : workspace;
    });
});

/** WORKSPACES panel state bars: count per displayStatus wire value. */
export const selectHudWorkspaceStateCounts = store.createSelector(
  (state): Record<WorkspaceDisplayStatus, number> => {
    const counts = Object.fromEntries(
      WORKSPACE_DISPLAY_STATUS_VALUES.map((value) => [value, 0]),
    ) as Record<WorkspaceDisplayStatus, number>;
    for (const workspace of selectHudWorkspaces.select(state)) {
      const status = workspace.displayStatus;
      if (status) counts[status] += 1;
    }
    return counts;
  },
);

/**
 * The `agentSummary` aggregate is typed as the slim `WorkspaceAgentIdSummary`
 * on the FE `Workspace`, but the daemon emits the richer
 * `{ count, agents, agentIds }` form (PROTOCOL §5.1) and `normalizeWorkspace`
 * spreads it through verbatim. Read `agents` structurally when present.
 */
function agentInfosOf(workspace: Workspace): WorkspaceAgentInfo[] {
  const summary = workspace.agentSummary as
    | { agents?: unknown; agentIds?: string[] }
    | undefined;
  if (!summary || !Array.isArray(summary.agents)) return [];
  return summary.agents.filter(
    (agent): agent is WorkspaceAgentInfo =>
      !!agent && typeof agent === "object" && typeof (agent as { id?: unknown }).id === "string",
  );
}

/** AGENTS panel state bars: bucketed counts across all HUD workspaces. */
export const selectHudAgentStateCounts = store.createSelector(
  (state): Record<HudAgentStateBucket, number> => {
    const counts = Object.fromEntries(HUD_AGENT_STATE_BUCKETS.map((bucket) => [bucket, 0])) as Record<
      HudAgentStateBucket,
      number
    >;
    for (const workspace of selectHudWorkspaces.select(state)) {
      for (const agent of agentInfosOf(workspace)) {
        counts[toHudAgentStateBucket(agent.status)] += 1;
      }
    }
    return counts;
  },
);

/** One ATTENTION panel row. */
export interface HudAttentionItem {
  workspaceId: string;
  workspaceTitle: string;
  /** Wire attention value (`"unread" | "review_required" | ...`). */
  attention: string;
}

/**
 * ATTENTION panel rows: workspaces whose live `workspace:attention-changed`
 * flag is raised (the FE `Workspace` entity carries no `attention` field —
 * the hud slice mirrors the event stream). Rows for workspaces no longer in
 * the list are dropped.
 */
export const selectHudAttentionItems = store.createSelector((state): HudAttentionItem[] => {
  const flags = state.hud.attentionByWorkspaceId;
  const items: HudAttentionItem[] = [];
  for (const workspace of selectHudWorkspaces.select(state)) {
    const attention = flags[String(workspace.id)];
    if (attention) {
      items.push({
        workspaceId: String(workspace.id),
        workspaceTitle: workspace.title,
        attention,
      });
    }
  }
  return items;
});
