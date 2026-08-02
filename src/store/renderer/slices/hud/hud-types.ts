/**
 * Fleet HUD shared types — the agent state buckets rendered by the AGENTS
 * panel state bars (running / needs-attention / done / failed / idle) and the
 * card state keys rendered by the workspace grid.
 */

/**
 * Agent state buckets for the AGENTS panel. `needs-attention` is derived at
 * the selector level (pending attention request / outstanding question —
 * never from the wire status alone); a merely-waiting agent buckets as
 * `idle`, mirroring main's agent-state display (`WorkspaceAgentsList` /
 * `avatar-state`: waiting without attention is not a call to action).
 */
export const HUD_AGENT_STATE_BUCKETS = [
  'running',
  'needs-attention',
  'done',
  'failed',
  'idle',
] as const;

export type HudAgentStateBucket = (typeof HUD_AGENT_STATE_BUCKETS)[number];

/**
 * Bucket a wire agent status (`agentSummary.agents[].status`, PROTOCOL §5.1 —
 * same strings as `agent.list`) into a HUD state bar. The wire carries both
 * current lowercase values (`active`, `idle`, `error`, …) and legacy
 * PascalCase ones (`Waiting`, `Completed`, `Processing`); compare
 * case-insensitively. Waiting/pending and unknown statuses fall back to
 * `idle` — `needs-attention` only comes from the selector-level attention
 * predicates, never the raw status.
 */
export function toHudAgentStateBucket(status: string): HudAgentStateBucket {
  switch (status.toLowerCase()) {
    case 'active':
    case 'processing':
    case 'responding':
      return 'running';
    case 'completed':
      return 'done';
    case 'error':
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

/**
 * Wire-status waiting check (`pending` / `Waiting`): the raw signal the
 * outstanding-question pairing uses when no live session tracks the agent.
 */
export function isWaitingWireStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return lower === 'pending' || lower === 'waiting';
}

/**
 * Mock-faithful workspace-card state keys: the seven BE-owned
 * `workspace.displayStatus` wire values (`idle` is a wire value since
 * intentd#793, and doubles as the fallback for rows without a displayStatus)
 * plus the HUD-derived attention states (`wait` when a top-level
 * non-background agent needs input or the live attention flag is raised,
 * `blocked` when a top-level non-background agent has a pending blocker
 * attention request, `failed` when a card agent is in the failed bucket).
 */
export const HUD_CARD_STATE_KEYS = [
  'in_progress',
  'pr_open',
  'pr_ready',
  'pr_merged',
  'wait',
  'blocked',
  'failed',
  'idle',
  'not_started',
  'complete',
] as const;

export type HudCardStateKey = (typeof HUD_CARD_STATE_KEYS)[number];

/**
 * Client-side workspace-grid filter (mock's header FLEET OPS repo menu +
 * multi-select status menu): single-select repo ref plus card state keys
 * (empty selection = all). Owned by the hud slice so the header menus and
 * the center grid share one selection.
 */
export interface HudGridFilter {
  /** Selected repo ref (card `repoRef` value); null = all workspaces. */
  repo: string | null;
  /** Selected card state keys; empty = all statuses. */
  states: HudCardStateKey[];
}

export const EMPTY_HUD_GRID_FILTER: HudGridFilter = { repo: null, states: [] };
