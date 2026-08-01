/**
 * Localized label lookups for the HUD right column: feed rows label off the
 * wire event `kind`, attention rows off the derived `HudAttentionKind` /
 * wire attention value. Plain functions so strings re-evaluate per render on
 * locale change.
 */
import { m } from '$shared/paraglide/messages.js';
import type { HudAttentionItem } from '$store/renderer/slices/hud/hud-selectors';

/** Mock's stateMeta color per feed color-class token. */
export const HUD_FEED_COLORS: Record<string, string> = {
  ok: 'hsl(var(--ring))',
  info: 'hsl(var(--primary))',
  warn: 'hsl(var(--warning))',
  err: 'hsl(var(--destructive-foreground))',
  accent: 'hsl(262 60% 62%)',
};

/** Localized short label for a feed row's wire event type. */
export function feedKindLabel(kind: string): string {
  switch (kind) {
    case 'agent:started':
      return m.hud_feedKind_agentStarted_label();
    case 'agent:completed':
      return m.hud_feedKind_agentCompleted_label();
    case 'agent:failed':
      return m.hud_feedKind_agentFailed_label();
    case 'agent:idle':
      return m.hud_feedKind_agentIdle_label();
    case 'agent:created':
      return m.hud_feedKind_agentCreated_label();
    case 'agent:deleted':
      return m.hud_feedKind_agentDeleted_label();
    case 'agent:status-changed':
      return m.hud_feedKind_agentStatusChanged_label();
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

/** Localized kind label for an attention row (mock: QUESTION/FAILED/BLOCKED…). */
export function attentionKindLabel(item: HudAttentionItem): string {
  switch (item.kind) {
    case 'agent_waiting':
      return m.hud_attention_kindNeedsInput_label();
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

/** Row accent color (mock: warning for waiting/attention, diff-del for failed). */
export function attentionColor(item: HudAttentionItem): string {
  return item.kind === 'agent_failed'
    ? 'hsl(var(--destructive-foreground))'
    : 'hsl(var(--warning))';
}
