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
 * HUD "needs attention" gate for the wire workspace `attention` value
 * (`workspace:attention-changed`, §9.9): only values in this allowlist are a
 * call to action on the HUD. `unread` is the main app's blue-dot notification
 * — the daemon raises it on EVERY agent turn end and only `workspace.markSeen`
 * clears it, so treating it as attention would flag genuinely idle workspaces
 * (no pending question/blocker/discussion) as NEEDS ATTENTION. `none` clears.
 */
export const HUD_ATTENTION_VALUES = ['review_required'] as const;

/** Whether a wire attention value constitutes HUD attention (see allowlist). */
export function isHudAttentionValue(value: string): boolean {
  return (HUD_ATTENTION_VALUES as readonly string[]).includes(value);
}

/** The non-urgent unread wire attention value (the main app's blue dot). */
export const HUD_UNREAD_ATTENTION_VALUE = 'unread';

/**
 * Whether the hud slice tracks a wire attention value at all: the HUD
 * attention allowlist plus `unread` (stored so the card can render the
 * non-urgent blue UNREAD state — never a call to action). `none` clears.
 */
export function isHudTrackedAttentionValue(value: string): boolean {
  return isHudAttentionValue(value) || value === HUD_UNREAD_ATTENTION_VALUE;
}

/**
 * Mock-faithful workspace-card state keys: one per BE-owned
 * `workspace.displayStatus` wire value (`idle` since intentd#793 — it doubles
 * as the fallback for rows without a displayStatus; `failed`, `blocked` and
 * `unread` since intentd#945). The daemon owns the precedence between them
 * (PROTOCOL §5.1), so the HUD adds no refinements of its own; the only
 * divergence from the wire vocabulary is the presentational rename of
 * `needs_attention` to `wait`.
 */
export const HUD_CARD_STATE_KEYS = [
  'in_progress',
  'pr_open',
  'pr_ready',
  'pr_merged',
  'wait',
  'blocked',
  'failed',
  'unread',
  'idle',
  'not_started',
  'complete',
] as const;

export type HudCardStateKey = (typeof HUD_CARD_STATE_KEYS)[number];

/**
 * Card state key for a wire `workspace.displayStatus` value: `needs_attention`
 * renders as `wait` (the same fold `cardStateKey` applies), every other known
 * value maps verbatim. Null for unknown wire values — the same
 * treat-as-absent convention as `isWorkspaceDisplayStatus`, so consumers
 * (e.g. the WORKSPACE STATUS feed row) never render a raw wire word.
 */
export function displayStatusCardStateKey(displayStatus: string): HudCardStateKey | null {
  if (displayStatus === 'needs_attention') return 'wait';
  return (HUD_CARD_STATE_KEYS as readonly string[]).includes(displayStatus)
    ? (displayStatus as HudCardStateKey)
    : null;
}

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
