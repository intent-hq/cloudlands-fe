/**
 * Takeover overlay metadata — localized labels + mock-faithful colors for
 * takeover kinds (mock `ovDefs().kind/kc`) and task-map cells (mock
 * `taskMeta`). Plain functions so strings re-evaluate per render on locale
 * change; colors are CSS color expressions over the app theme tokens.
 */
import { m } from '$shared/paraglide/messages.js';
import type { HudAgentStateBucket } from '$store/renderer/slices/hud/hud-types';
import type { HudTakeoverKind } from './hud-takeover-queue';

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
    case 'manual':
      return m.hud_takeover_kindManual_label();
  }
}

/** Accent color for a takeover kind (mock `kc`). */
export function takeoverKindColor(kind: HudTakeoverKind): string {
  switch (kind) {
    case 'task_complete':
    case 'agent_started':
      return 'hsl(var(--primary))';
    case 'agent_delegated':
    case 'status_update':
    case 'manual':
      return 'hsl(var(--ring))';
    case 'agent_failed':
      return 'hsl(var(--destructive-foreground))';
    case 'question_asked':
      return 'hsl(var(--warning))';
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
