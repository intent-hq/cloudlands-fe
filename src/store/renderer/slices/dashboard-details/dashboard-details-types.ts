import type { HudCardAgent, HudCardAttentionSnippet } from '../hud/hud-selectors';

/** A view over the canonical agent sessions, workspace and token rollup. */
export interface DashboardWorkspaceDetails {
  agents: HudCardAgent[];
  attentionSnippet: HudCardAttentionSnippet | null;
  /** Null while usage is unknown or stale; a loaded workspace with no usage reports zero. */
  tokens: number | null;
}

/** Viewport demand is bounded even when several dashboard instances are mounted. */
export const DASHBOARD_VISIBLE_WORKSPACE_LIMIT = 24;
export const DASHBOARD_AGENT_DETAIL_LIMIT = 12;
