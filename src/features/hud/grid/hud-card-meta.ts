/**
 * Card state metadata for the HUD workspace grid — the mock's `wsMeta`
 * (label + color per card state key) and `stateMeta` (color per live-agent
 * bucket). Labels are plain functions so strings re-evaluate per render on
 * locale change; colors are CSS color expressions over the app theme tokens.
 */
import { m } from '$shared/paraglide/messages.js';
import type { HudAgentStateBucket, HudCardStateKey } from '$store/renderer/slices/hud/hud-types';

/**
 * THE canonical HUD state→color mapping. Every colored indicator (feed row
 * dots/squares, card agent squares, card state banners, header/footer
 * counters, state bars) resolves through these tokens — nothing forks its
 * own color:
 *
 * - IDLE / NOT STARTED / WAITING  → grey
 * - UNREAD / PR states            → blue
 * - IN PROGRESS / RUNNING         → green (pulsing/live treatment at the
 *                                   usage site — same green as done)
 * - ATTENTION (question/blocker/
 *   discussion/needs_attention)   → yellow
 * - FAILED / BLOCKED              → red
 * - COMPLETED / DONE              → the same green, stable (never blinking)
 *
 * PR MERGED keeps the mock's distinctive purple accent on top of the PR
 * family — the one deliberate refinement of the table.
 */
export const HUD_STATE_COLORS = {
  running: 'hsl(var(--primary))',
  done: 'hsl(var(--primary))',
  attention: 'hsl(var(--warning))',
  failed: 'hsl(var(--destructive-foreground))',
  idle: 'hsl(var(--text-ghost))',
  unread: 'hsl(var(--ring))',
  pr: 'hsl(var(--ring))',
  prMerged: 'hsl(262 60% 62%)',
} as const;

/** Localized status-banner label for a card state key (mock `wsMeta.l`). */
export function cardStateLabel(stateKey: HudCardStateKey): string {
  switch (stateKey) {
    case 'in_progress':
      return m.hud_card_stateInProgress_label();
    case 'complete':
      return m.hud_card_stateComplete_label();
    case 'not_started':
      return m.hud_card_stateNotStarted_label();
    case 'pr_ready':
      return m.hud_card_statePrReady_label();
    case 'pr_open':
      return m.hud_card_statePrOpen_label();
    case 'pr_merged':
      return m.hud_card_statePrMerged_label();
    case 'wait':
      return m.hud_card_stateWait_label();
    case 'blocked':
      return m.hud_card_stateBlocked_label();
    case 'failed':
      return m.hud_card_stateFailed_label();
    case 'unread':
      return m.hud_card_stateUnread_label();
    case 'idle':
      return m.hud_card_stateIdle_label();
  }
}

/** Card accent color for a state key (mock `wsMeta.c`) — canonical table. */
export function cardStateColor(stateKey: HudCardStateKey): string {
  switch (stateKey) {
    case 'in_progress':
      return HUD_STATE_COLORS.running;
    case 'complete':
      return HUD_STATE_COLORS.done;
    case 'pr_ready':
    case 'pr_open':
      return HUD_STATE_COLORS.pr;
    case 'unread':
      return HUD_STATE_COLORS.unread;
    case 'pr_merged':
      return HUD_STATE_COLORS.prMerged;
    case 'wait':
      return HUD_STATE_COLORS.attention;
    case 'blocked':
    case 'failed':
      return HUD_STATE_COLORS.failed;
    case 'not_started':
    case 'idle':
      return HUD_STATE_COLORS.idle;
  }
}

/** Live-agent dot color per HUD bucket (mock `stateMeta.c`) — canonical table. */
export function agentBucketColor(bucket: HudAgentStateBucket): string {
  switch (bucket) {
    case 'running':
      return HUD_STATE_COLORS.running;
    case 'needs-attention':
      return HUD_STATE_COLORS.attention;
    case 'failed':
      return HUD_STATE_COLORS.failed;
    case 'done':
      return HUD_STATE_COLORS.done;
    case 'idle':
      return HUD_STATE_COLORS.idle;
  }
}

/** Mock's `kTok`: compact token count (`88400` → `"88.4k"`). Digit-only. */
export function formatCardTokens(tokens: number): string {
  const n = Number.isFinite(tokens) ? Math.max(0, tokens) : 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
