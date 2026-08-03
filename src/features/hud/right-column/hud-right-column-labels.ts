/**
 * Localized label lookups for the HUD right column: feed rows label off the
 * wire event `kind`, attention rows off the derived `HudAttentionKind` /
 * wire attention value. Plain functions so strings re-evaluate per render on
 * locale change.
 */
import { m } from '$shared/paraglide/messages.js';
import type { HudAttentionItem } from '$store/renderer/slices/hud/hud-selectors';
import { displayStatusCardStateKey } from '$store/renderer/slices/hud/hud-types';
import { HUD_AGENT_DELEGATED_FEED_KIND } from '../hud-feed-mapper';
import { HUD_STATE_COLORS, cardStateColor, cardStateLabel } from '../grid/hud-card-meta';

/**
 * Feed color-class → color, resolved through the canonical
 * `HUD_STATE_COLORS` table (hud-card-meta): `ok` (done) and `info` (running/
 * informational) are GREEN, `idle` grey, `warn` yellow, `err` red, `accent`
 * (PR family) blue — the same tokens the cards and counters render, so a
 * feed square can never disagree with the card square for the same state.
 */
export const HUD_FEED_COLORS: Record<string, string> = {
  ok: HUD_STATE_COLORS.done,
  info: HUD_STATE_COLORS.running,
  warn: HUD_STATE_COLORS.attention,
  err: HUD_STATE_COLORS.failed,
  accent: HUD_STATE_COLORS.pr,
  idle: HUD_STATE_COLORS.idle,
};

/**
 * Per-state chip label for an `agent:status-changed` row: names the specific
 * transition (AGENT RUNNING / WAITING / IDLE / DONE / FAILED) off the wire
 * status instead of a generic "agent status". Same status grouping as
 * `toHudAgentStateBucket` (§5.5 wire strings, case-insensitive); unknown
 * statuses fall back to idle — the raw wire word never renders.
 */
function agentStatusChipLabel(agentStatus: string | undefined): string {
  switch ((agentStatus ?? '').toLowerCase()) {
    case 'active':
    case 'processing':
    case 'responding':
      return m.hud_feedKind_agentRunning_label();
    case 'waiting':
    case 'pending':
      return m.hud_feedKind_agentWaiting_label();
    case 'completed':
      return m.hud_feedKind_agentCompleted_label();
    case 'error':
    case 'failed':
      return m.hud_feedKind_agentFailed_label();
    default:
      return m.hud_feedKind_agentIdle_label();
  }
}

/**
 * Localized short label for a feed row's wire event type. `agentStatus` (the
 * wire status on `agent:status-changed` rows) selects the per-state chip.
 */
export function feedKindLabel(kind: string, agentStatus?: string): string {
  switch (kind) {
    case 'agent:started':
      return m.hud_feedKind_agentStarted_label();
    case 'agent:completed':
      return m.hud_feedKind_agentCompleted_label();
    case 'agent:failed':
      return m.hud_feedKind_agentFailed_label();
    case 'agent:idle':
      return m.hud_feedKind_agentIdle_label();
    case HUD_AGENT_DELEGATED_FEED_KIND:
      // Synthetic kind: the agent's first running transition — same label
      // (and localizations) as the takeover banner's AGENT DELEGATED kind.
      return m.hud_takeover_kindAgentDelegated_label();
    case 'agent:deleted':
      return m.hud_feedKind_agentDeleted_label();
    case 'agent:status-changed':
      return agentStatusChipLabel(agentStatus);
    case 'task:status-changed':
      return m.hud_feedKind_taskStatusChanged_label();
    case 'workspace:displayStatus-changed':
      return m.hud_feedKind_displayStatusChanged_label();
    case 'workspace:attention-changed':
      return m.hud_feedKind_attentionChanged_label();
    case 'pr:linked':
      return m.hud_feedKind_prLinked_label();
    case 'pr:updated':
      return m.hud_feedKind_prUpdated_label();
    case 'pr:unlinked':
      return m.hud_feedKind_prUnlinked_label();
    case 'git:commit':
      return m.hud_feedKind_gitCommit_label();
    case 'git:pull':
      return m.hud_feedKind_gitPull_label();
    default:
      return kind; // i18n-ignore (wire event type identifier fallback)
  }
}

/**
 * Localized detail text for a feed row's second line: WORKSPACE STATUS rows
 * render the SAME card-state label the card banner uses (never the raw wire
 * value — `needs_attention` folds to NEEDS ATTENTION exactly like
 * `cardStateKey`); unknown wire values render nothing rather than leaking.
 * Every other kind keeps its wire-derived `text` (identifiers, i18n-exempt).
 */
export function feedDetailText(item: { kind: string; text: string; displayStatus?: string }): string {
  if (item.kind === 'workspace:displayStatus-changed') {
    const stateKey = item.displayStatus ? displayStatusCardStateKey(item.displayStatus) : null;
    return stateKey ? cardStateLabel(stateKey) : '';
  }
  return item.text; // i18n-ignore (wire identifiers)
}

/**
 * Row dot color: WORKSPACE STATUS rows use the reported status's card color
 * token (the same `cardStateColor` the grid banner uses — In Progress green,
 * Needs Attention yellow, Idle grey, PR blue …) so the dot and the card
 * agree; every other kind keeps its feed color-class token.
 */
export function feedDotColor(item: {
  kind: string;
  colorClass: string;
  displayStatus?: string;
}): string {
  if (item.kind === 'workspace:displayStatus-changed' && item.displayStatus) {
    const stateKey = displayStatusCardStateKey(item.displayStatus);
    if (stateKey) return cardStateColor(stateKey);
  }
  return HUD_FEED_COLORS[item.colorClass] ?? HUD_FEED_COLORS.info;
}

/**
 * Localized kind label for an attention row. The mock names the raising
 * signal on the chip (QUESTION / DISCUSSION REQUIRED / BLOCKED / FAILED),
 * never a generic "needs attention" — `agent_waiting` rows pick per `signal`,
 * falling back to the generic label only when no signal was captured.
 */
export function attentionKindLabel(item: HudAttentionItem): string {
  switch (item.kind) {
    case 'agent_waiting':
      switch (item.signal) {
        case 'question':
          return m.hud_attention_kindQuestion_label();
        case 'discussion':
          return m.hud_attention_kindDiscussion_label();
        case 'blocker':
          return m.hud_attention_kindBlocked_label();
        default:
          return m.hud_attention_kindNeedsAttention_label();
      }
    case 'agent_failed':
      return m.hud_attention_kindFailed_label();
    case 'workspace_attention':
      switch (item.attention) {
        case 'review_required':
          return m.hud_attention_kindReviewRequired_label();
        case 'unread':
          return m.hud_attention_kindUnread_label();
        default:
          return m.hud_attention_kindGeneric_label();
      }
  }
}

/** Localized source tag (mock: AGENT / TASK — ours: AGENT / WS). */
export function attentionSourceLabel(item: HudAttentionItem): string {
  return item.kind === 'workspace_attention'
    ? m.hud_attention_sourceWorkspace_label()
    : m.hud_attention_sourceAgent_label();
}

/**
 * Row accent color, resolved through the canonical `HUD_STATE_COLORS` table
 * (mock: warning `wsMeta.wait.c` for waiting/attention rows, the failed
 * red for FAILED rows) — the panel can never disagree with the cards.
 */
export function attentionColor(item: HudAttentionItem): string {
  return item.kind === 'agent_failed' ? HUD_STATE_COLORS.failed : HUD_STATE_COLORS.attention;
}

/**
 * Detail-line text with the mock's per-signal prefix treatment (attn rows:
 * `Q: …` on question rows, `Blocked: …` on blocker rows, the plain reason on
 * discussion rows) — the same localized prefixes the card footer strip uses,
 * so the two surfaces read identically. Null when the row has no detail.
 */
export function attentionMessageText(item: HudAttentionItem): string | null {
  if (item.message === null) return null;
  if (item.signal === 'question') return m.hud_card_attnQuestion_label({ text: item.message });
  if (item.signal === 'blocker') return m.hud_card_attnBlocker_label({ text: item.message });
  return item.message; // i18n-ignore (agent-generated reason/question text)
}
