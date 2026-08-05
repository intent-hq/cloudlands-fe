/**
 * Takeover overlay metadata — localized labels + mock-faithful colors for
 * takeover kinds (mock `ovDefs().kind/kc`) and task-map cells (mock
 * `taskMeta`). Plain functions so strings re-evaluate per render on locale
 * change; colors are CSS color expressions over the app theme tokens.
 */
import { m } from '$shared/paraglide/messages.js';
import type { HudAgentStateBucket } from '$store/renderer/slices/hud/hud-types';
import type { HudTakeoverKind, HudTakeoverTrigger } from './hud-takeover-queue';

/** Localized banner-chip label for a takeover kind. */
export function takeoverKindLabel(kind: HudTakeoverKind): string {
  switch (kind) {
    case 'task_complete':
      return m.hud_takeover_kindTaskComplete_label();
    case 'agent_delegated':
      return m.hud_takeover_kindAgentDelegated_label();
    case 'agent_started':
      return m.hud_takeover_kindAgentStarted_label();
    case 'agent_failed':
      return m.hud_takeover_kindAgentFailed_label();
    case 'question_asked':
      return m.hud_takeover_kindQuestion_label();
    case 'status_update':
      return m.hud_takeover_kindStatusUpdate_label();
    case 'workspace_idle':
      return m.hud_takeover_kindWorkspaceIdle_label();
    case 'pr_open':
      return m.hud_takeover_kindPrOpen_label();
    case 'pr_ready':
      return m.hud_takeover_kindPrReady_label();
    case 'pr_merged':
      return m.hud_takeover_kindPrMerged_label();
    case 'workspace_complete':
      return m.hud_takeover_kindWorkspaceComplete_label();
    case 'manual':
      return m.hud_takeover_kindManual_label();
  }
}

/** Accent color for a takeover kind (mock `kc`). */
export function takeoverKindColor(kind: HudTakeoverKind): string {
  switch (kind) {
    case 'task_complete':
    case 'agent_started':
    case 'pr_merged':
    case 'workspace_complete':
      return 'hsl(var(--primary))';
    case 'agent_delegated':
    case 'status_update':
    case 'pr_open':
    case 'pr_ready':
    case 'manual':
      return 'hsl(var(--ring))';
    case 'agent_failed':
      return 'hsl(var(--destructive-foreground))';
    case 'question_asked':
      return 'hsl(var(--warning))';
    case 'workspace_idle':
      return 'hsl(var(--text-subtle))';
  }
}

/** Per-cell styling for a wire task status (mock `taskMeta`). */
export interface HudTakeoverCellMeta {
  label: string;
  color: string;
  bg: string;
  borderColor: string;
  borderStyle: 'solid' | 'dashed';
}

export function taskCellMeta(status: string): HudTakeoverCellMeta {
  switch (status) {
    case 'complete':
      return {
        label: m.hud_takeover_taskComplete_label(),
        color: 'hsl(158 45% 40%)',
        bg: 'hsl(158 60% 30% / 0.32)',
        borderColor: 'hsl(158 45% 35%)',
        borderStyle: 'solid',
      };
    case 'in_progress':
      return {
        label: m.hud_takeover_taskInProgress_label(),
        color: 'hsl(var(--primary))',
        bg: 'hsl(var(--card))',
        borderColor: 'hsl(var(--primary) / 0.6)',
        borderStyle: 'solid',
      };
    case 'review_required':
      return {
        label: m.hud_takeover_taskReviewRequired_label(),
        color: 'hsl(var(--ring))',
        bg: 'hsl(var(--ring) / 0.08)',
        borderColor: 'hsl(var(--ring) / 0.6)',
        borderStyle: 'solid',
      };
    case 'discussion_needed':
      return {
        label: m.hud_takeover_taskDiscussionNeeded_label(),
        color: 'hsl(var(--warning))',
        bg: 'hsl(var(--warning) / 0.08)',
        borderColor: 'hsl(var(--warning) / 0.6)',
        borderStyle: 'solid',
      };
    case 'waiting':
      return {
        label: m.hud_takeover_taskWaiting_label(),
        color: 'hsl(var(--text-subtle))',
        bg: 'hsl(var(--card))',
        borderColor: 'hsl(var(--border))',
        borderStyle: 'solid',
      };
    case 'blocked':
      return {
        label: m.hud_takeover_taskBlocked_label(),
        color: 'hsl(var(--destructive-foreground))',
        bg: 'hsl(0 70% 45% / 0.1)',
        borderColor: 'hsl(var(--destructive-foreground))',
        borderStyle: 'solid',
      };
    default:
      return {
        label: m.hud_takeover_taskNotStarted_label(),
        color: 'hsl(var(--text-ghost))',
        bg: 'transparent',
        borderColor: 'hsl(var(--border))',
        borderStyle: 'dashed',
      };
  }
}

/**
 * Attention-banner chip: the raising signal's name (the ATTENTION panel's
 * chip labels — QUESTION / BLOCKED / DISCUSSION REQUIRED), so a blocker or
 * discussion takeover never mislabels itself as a question.
 */
export function takeoverAttentionChipLabel(
  signal: 'question' | 'blocker' | 'discussion',
): string {
  switch (signal) {
    case 'question':
      return m.hud_attention_kindQuestion_label();
    case 'blocker':
      return m.hud_attention_kindBlocked_label();
    case 'discussion':
      return m.hud_attention_kindDiscussion_label();
  }
}

/**
 * Attention-banner sub-title: the question/reason text with the CARD FOOTER's
 * shared per-signal prefixes (`Q:` / `Blocker:` / `Request Discussion:`) so
 * the takeover banner, footer snippet, and ATTENTION panel read identically.
 */
export function takeoverAttentionSubtitle(
  signal: 'question' | 'blocker' | 'discussion',
  text: string,
): string {
  switch (signal) {
    case 'question':
      return m.hud_card_attnQuestion_label({ text });
    case 'blocker':
      return m.hud_card_attnBlocker_label({ text });
    case 'discussion':
      return m.hud_card_attnDiscussion_label({ text });
  }
}

/** Resolved banner content lines (see `bannerView`). */
export interface HudTakeoverBannerView {
  /** Dot-matrix headline text; null renders no headline. */
  big: string | null;
  /** Wrap the headline (long question sentences) instead of clipping. */
  wrap: boolean;
  /** Plain sub-title line under the headline; null renders none. */
  status: string | null;
  /** Uppercase mono sub-line (repo ref); null renders none. */
  sub: string | null;
  /** Test id for the `status` line. */
  statusTestId: string;
}

/**
 * Kinds whose banner puts the WORKSPACE TITLE on the dot-matrix headline:
 * status updates (status text sub-title) and the workspace displayStatus
 * takeovers (idle / PR / complete — no agent name, empty detail, never a raw
 * wire word; the localized kind chip carries the meaning).
 */
const WORKSPACE_HEADLINE_KINDS: ReadonlySet<HudTakeoverKind> = new Set([
  'status_update',
  'workspace_idle',
  'pr_open',
  'pr_ready',
  'pr_merged',
  'workspace_complete',
]);

/**
 * Banner content per kind: `WORKSPACE_HEADLINE_KINDS` put the workspace name
 * on the dot-matrix headline with the (possibly empty) detail sub-title;
 * attention banners (signal-carrying question/blocker/discussion) put the
 * RAISING AGENT's name on the matrix line (workspace-title fallback — never
 * a raw UUID) with the question/reason sub-title in the card footer's shared
 * Q:/Blocker:/Request Discussion: prefixes; every other kind keeps the wire
 * detail headline over the repo-ref sub-line. All text is wire/localized
 * content routing — i18n-exempt at this join point.
 */
export function bannerView(
  banner: HudTakeoverTrigger,
  title: string,
  repoRef: string,
): HudTakeoverBannerView {
  if (WORKSPACE_HEADLINE_KINDS.has(banner.kind)) {
    return {
      big: title,
      wrap: false,
      status: banner.detail || null,
      sub: null,
      statusTestId: 'hud-takeover-banner-status',
    };
  }
  if (banner.signal) {
    return {
      big: banner.agentName ?? title,
      wrap: false,
      status: takeoverAttentionSubtitle(banner.signal, banner.detail),
      sub: null,
      statusTestId: 'hud-takeover-banner-attention',
    };
  }
  return {
    big: banner.detail || null,
    wrap: banner.kind === 'question_asked',
    status: null,
    sub: repoRef,
    statusTestId: '',
  };
}

/** Localized short label for an agent chip's state bucket. */
export function agentBucketLabel(bucket: HudAgentStateBucket): string {
  switch (bucket) {
    case 'running':
      return m.hud_agentState_running_label();
    case 'needs-attention':
      return m.hud_agentState_needsAttention_label();
    case 'done':
      return m.hud_agentState_done_label();
    case 'failed':
      return m.hud_agentState_failed_label();
    case 'idle':
      return m.hud_agentState_idle_label();
  }
}
