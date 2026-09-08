/**
 * Shared task-status display maps for flame-graph style progress surfaces.
 * Used by the sidebar FlameGraph to render task statuses with consistent
 * ordering, labels, and colors.
 */

import type { TaskStatus } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

// Named exports keep the status presentation on one shared visual contract.

/** Accessible detail order for included task statuses (complete first, not started last). */
const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  'complete',
  'in_progress',
  'review_required',
  'discussion_needed',
  'blocked',
  'waiting',
  'not_started',
];

export interface TaskStatusBar {
  status: TaskStatus;
  count: number;
}

export interface TaskProgressFallback {
  total: number;
  completed: number;
  inProgress: number;
}

export type TaskProgressVisualState = 'completed' | 'striped' | 'not-started';

export interface TaskProgressSegment {
  visualState: TaskProgressVisualState;
  count: number;
}

export const TASK_PROGRESS_SEGMENT_CLASSES: Record<TaskProgressVisualState, string> = {
  completed: 'bg-foreground dark:bg-accent',
  striped: 'bg-foreground/65 dark:bg-muted-foreground/70',
  'not-started': 'bg-background dark:bg-muted/60',
};

function clampCount(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.trunc(value)));
}

function fallbackStatusBars(fallback: TaskProgressFallback): TaskStatusBar[] {
  const total = Math.max(0, Math.trunc(fallback.total));
  const completed = clampCount(fallback.completed, total);
  const inProgress = clampCount(fallback.inProgress, total - completed);
  const notStarted = total - completed - inProgress;
  return [
    { status: 'complete', count: completed },
    { status: 'in_progress', count: inProgress },
    { status: 'not_started', count: notStarted },
  ].filter((bar) => bar.count > 0) as TaskStatusBar[];
}

/** Group task statuses into the canonical visual order. */
export function normalizeTaskStatusBars(
  statuses: readonly TaskStatus[],
  fallback?: TaskProgressFallback,
): TaskStatusBar[] {
  const counts = new Map<TaskStatus, number>();
  for (const status of statuses) {
    if (status === 'cancelled') continue;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  const includedCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (fallback && includedCount !== Math.max(0, Math.trunc(fallback.total))) {
    return fallbackStatusBars(fallback);
  }

  return TASK_STATUS_ORDER.flatMap<TaskStatusBar>((status) => {
    const count = counts.get(status) ?? 0;
    return count > 0 ? [{ status, count }] : [];
  });
}

/** Aggregate detailed included statuses into the three graph treatments. */
export function buildTaskProgressSegments(
  statusBars: readonly TaskStatusBar[],
): TaskProgressSegment[] {
  let completed = 0;
  let striped = 0;
  let notStarted = 0;

  for (const bar of statusBars) {
    if (bar.status === 'cancelled') continue;
    if (bar.status === 'complete') completed += bar.count;
    else if (bar.status === 'not_started') notStarted += bar.count;
    else striped += bar.count;
  }

  return [
    { visualState: 'completed', count: completed },
    { visualState: 'striped', count: striped },
    { visualState: 'not-started', count: notStarted },
  ].filter((segment) => segment.count > 0) as TaskProgressSegment[];
}

export function formatTaskStatusValueText(
  statusBars: readonly TaskStatusBar[],
  emptyText: string,
): string {
  if (statusBars.length === 0) return emptyText;
  return statusBars
    .map((bar) => `${formatInteger(bar.count)} ${TASK_STATUS_LABELS[bar.status].toLowerCase()}`)
    .join(', ');
}

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
  blocked: 'bg-danger',
  in_progress: 'bg-info',
  review_required: 'bg-primary/70',
  complete: 'bg-success',
  cancelled: 'bg-muted-foreground/40',
};
