/**
 * Token Usage Types (renderer)
 *
 * Renderer mirror of the daemon-owned per-workspace `TokenUsage` rollup
 * (`workspace.getTokenUsage`, PROTOCOL §5.23), refreshed by the
 * `workspace:tokenUsage-changed` push event.
 */

import type {
  TokenUsageByModel,
  TokenUsageTotals,
} from "../../../../features/token-usage/token-usage-types";
import { createEmptyTotals } from "../../../../features/token-usage/utils/token-usage-utils";

/** Per-workspace token usage as mirrored in the renderer (wire shape + staleness). */
export type WorkspaceTokenUsageState = {
  /** Per-agent totals keyed by agentId (`agent-{uuid}`). */
  byAgentId: Record<string, TokenUsageTotals>;
  /** Workspace-wide totals across all agents in `byAgentId`. */
  totals: TokenUsageTotals;
  /** Workspace-wide per-model totals keyed by effective model name. */
  byModel: TokenUsageByModel;
  /** RFC-3339 timestamp of the daemon's last internal scan; null before the first. */
  lastScanAt: string | null;
  /** True until a rollup is received, or after a fetch failure. */
  isStale: boolean;
};

/** Token usage slice state */
export type TokenUsageState = {
  byWorkspaceId: Record<string, WorkspaceTokenUsageState>;
};

export const emptyWorkspaceTokenUsageState: WorkspaceTokenUsageState = {
  byAgentId: {},
  totals: createEmptyTotals(),
  byModel: {},
  lastScanAt: null,
  isStale: true,
};

export const initialState: TokenUsageState = {
  byWorkspaceId: {},
};

