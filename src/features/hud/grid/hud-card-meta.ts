/**
 * Card state metadata for the HUD workspace grid — the mock's `wsMeta`
 * (label + color per card state key) and `stateMeta` (color per live-agent
 * bucket). Labels are plain functions so strings re-evaluate per render on
 * locale change; colors are CSS color expressions over the app theme tokens.
 */
import { m } from '$shared/paraglide/messages.js';
import type { HudAgentStateBucket, HudCardStateKey } from '$store/renderer/slices/hud/hud-types';

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
    case 'idle':
      return m.hud_card_stateIdle_label();
  }
}

/** Card accent color for a state key (mock `wsMeta.c`). */
export function cardStateColor(stateKey: HudCardStateKey): string {
  switch (stateKey) {
    case 'in_progress':
    case 'complete':
      return 'hsl(var(--primary))';
    case 'pr_ready':
    case 'pr_open':
      return 'hsl(var(--ring))';
    case 'pr_merged':
      return 'hsl(262 60% 62%)';
    case 'wait':
      return 'hsl(var(--warning))';
    case 'blocked':
    case 'failed':
      return 'hsl(var(--destructive-foreground))';
    case 'not_started':
    case 'idle':
      return 'hsl(var(--text-ghost))';
  }
}

/** Live-agent dot color per HUD bucket (mock `stateMeta.c`). */
export function agentBucketColor(bucket: HudAgentStateBucket): string {
  switch (bucket) {
    case 'running':
      return 'hsl(var(--primary))';
    case 'waiting':
      return 'hsl(var(--warning))';
    case 'failed':
      return 'hsl(var(--destructive-foreground))';
    case 'done':
      return 'hsl(var(--ring))';
    case 'idle':
      return 'hsl(var(--text-ghost))';
  }
}

/** Mock's `kTok`: compact token count (`88400` → `"88.4k"`). Digit-only. */
export function formatCardTokens(tokens: number): string {
  const n = Number.isFinite(tokens) ? Math.max(0, tokens) : 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
