import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCircleCheck,
  faCircleQuestion,
  faCodeMerge,
  faCodePullRequest,
  faHourglass,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { m } from '$shared/paraglide/messages.js';
import {
  isWorkspaceDisplayStatus,
  type Workspace,
  type WorkspaceDisplayStatus,
} from '$shared/types';

export type WorkspaceStatusPresentationState = WorkspaceDisplayStatus | 'waiting' | 'unread';

export type WorkspaceStatusPresentationInput = Pick<
  Workspace,
  'displayStatus' | 'activity' | 'attention' | 'waiting'
>;

export interface WorkspaceStatusPresentation {
  state: WorkspaceStatusPresentationState;
  visual: 'dot' | 'icon';
  icon: IconDefinition | null;
  className: string;
  label: string;
  tooltip: string;
  accessibleName: string;
}

const HIGH_PRIORITY_STATES = new Set<WorkspaceDisplayStatus>([
  'failed',
  'blocked',
  'needs_attention',
  'in_progress',
]);

const VISUALS: Record<
  WorkspaceStatusPresentationState,
  Pick<WorkspaceStatusPresentation, 'visual' | 'icon' | 'className'>
> = {
  failed: { visual: 'icon', icon: faTriangleExclamation, className: 'text-foreground' },
  blocked: { visual: 'icon', icon: faXmark, className: 'text-destructive' },
  needs_attention: { visual: 'icon', icon: faCircleQuestion, className: 'text-warning' },
  in_progress: {
    visual: 'dot',
    icon: null,
    className: 'workspace-status-color-active',
  },
  waiting: { visual: 'icon', icon: faHourglass, className: 'text-muted-foreground' },
  unread: {
    visual: 'dot',
    icon: null,
    className: 'workspace-status-color-unread',
  },
  not_started: { visual: 'dot', icon: null, className: 'text-muted-foreground/35' },
  idle: { visual: 'dot', icon: null, className: 'text-muted-foreground/35' },
  complete: { visual: 'icon', icon: faCircleCheck, className: 'text-success' },
  pr_ready: { visual: 'icon', icon: faCodePullRequest, className: 'text-success' },
  pr_open: { visual: 'icon', icon: faCodePullRequest, className: 'text-info' },
  pr_merged: { visual: 'icon', icon: faCodeMerge, className: 'text-purple-500' },
};

function labelFor(state: WorkspaceStatusPresentationState): string {
  switch (state) {
    case 'failed':
      return m.workspace_statusIcon_failed_label();
    case 'blocked':
      return m.workspace_statusIcon_blocked_label();
    case 'needs_attention':
      return m.workspace_statusIcon_needsAttention_label();
    case 'in_progress':
      return m.workspace_statusIcon_inProgress_label();
    case 'waiting':
      return m.workspace_taskStatus_waiting_label();
    case 'unread':
      return m.layout_activeCard_unread_header();
    case 'not_started':
      return m.workspace_statusIcon_notStarted_label();
    case 'idle':
      return m.workspace_statusIcon_idle_label();
    case 'complete':
      return m.workspace_statusIcon_complete_label();
    case 'pr_ready':
      return m.workspace_statusIcon_prReady_label();
    case 'pr_open':
      return m.workspace_statusIcon_prOpen_label();
    case 'pr_merged':
      return m.workspace_statusIcon_prMerged_label();
  }
}

export function resolveWorkspaceStatusState(
  input: WorkspaceStatusPresentationInput,
): WorkspaceStatusPresentationState {
  const displayStatus = isWorkspaceDisplayStatus(input.displayStatus)
    ? input.displayStatus
    : 'not_started';
  if (HIGH_PRIORITY_STATES.has(displayStatus)) return displayStatus;
  if (input.attention === 'unread') return 'unread';
  if (input.waiting === true) return 'waiting';
  return displayStatus;
}

export function getWorkspaceStatusPresentation(state: unknown): WorkspaceStatusPresentation {
  const safeState: WorkspaceStatusPresentationState =
    state === 'waiting' || state === 'unread' || isWorkspaceDisplayStatus(state)
      ? state
      : 'not_started';
  const label = labelFor(safeState);
  return {
    state: safeState,
    ...VISUALS[safeState],
    label,
    tooltip: label,
    accessibleName: label,
  };
}
