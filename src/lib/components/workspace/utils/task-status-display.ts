/**
 * Shared task-status display maps for flame-graph style progress surfaces.
 * Used by the sidebar FlameGraph to render task statuses with consistent
 * ordering, labels, and colors.
 */

import type { TaskStatus } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

// Named exports keep the status presentation on one shared visual contract.

/** Render order for status segments (complete first, not started last). */
export const TASK_STATUS_ORDER: TaskStatus[] = [
  'complete',
  'in_progress',
  'review_required',
  'discussion_needed',
  'blocked',
  'waiting',
  'not_started',
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  get not_started() {
    return m.workspace_taskStatus_notStarted_label();
  },
  get waiting() {
    return m.workspace_taskStatus_waiting_label();
  },
  get discussion_needed() {
    return m.workspace_taskStatus_discussionNeeded_label();
  },
  get blocked() {
    return m.workspace_taskStatus_blocked_label();
  },
  get in_progress() {
    return m.workspace_taskStatus_inProgress_label();
  },
  get review_required() {
    return m.workspace_taskStatus_reviewRequired_label();
  },
  get complete() {
    return m.workspace_taskStatus_complete_label();
  },
  get cancelled() {
    return m.workspace_taskStatus_cancelled_label();
  },
};

/** Small round indicator dot classes used in task-list tooltips. */
export const TASK_STATUS_INDICATOR_CLASSES: Record<TaskStatus, string> = {
  not_started: 'border border-border bg-background',
  waiting: 'border border-muted-foreground/50 bg-background',
  discussion_needed: 'bg-warning',
  blocked: 'bg-destructive',
  in_progress: 'bg-info',
  review_required: 'bg-primary/70',
  complete: 'bg-success',
  cancelled: 'bg-muted-foreground/40',
};

/** Flame bar segment classes per status. */
export const TASK_STATUS_BAR_CLASSES: Record<TaskStatus, string> = {
  not_started: 'bg-background dark:bg-muted/60',
  waiting: 'bg-muted-foreground/40',
  discussion_needed: 'bg-warning',
  blocked: 'bg-destructive',
  in_progress: 'bg-foreground dark:bg-muted-foreground/60',
  review_required: 'bg-primary/70 dark:bg-secondary',
  complete: 'bg-foreground dark:bg-accent',
  cancelled: 'bg-muted-foreground/40',
};
