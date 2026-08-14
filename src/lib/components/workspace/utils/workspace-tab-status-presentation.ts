import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCircle,
  faCircleExclamation,
  faCircleQuestion,
  faCircleXmark,
  faClipboardCheck,
  faComments,
  faEnvelope,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type {
  WorkspaceTabStatus,
  WorkspaceTabStatusCategory,
  WorkspaceTabStatusItem,
} from '$store/renderer/slices/hud/hud-types';

export interface WorkspaceTabStatusPresentation {
  icon: IconDefinition;
  className: string;
  label: string;
}

const CATEGORY_VISUALS: Record<
  WorkspaceTabStatusCategory,
  Pick<WorkspaceTabStatusPresentation, 'icon' | 'className'>
> = {
  failed: { icon: faCircleXmark, className: 'text-destructive' },
  blocker: { icon: faTriangleExclamation, className: 'text-destructive' },
  question: { icon: faCircleQuestion, className: 'text-warning' },
  discussion: { icon: faComments, className: 'text-info' },
  needs_input: { icon: faCircleExclamation, className: 'text-warning' },
  review: { icon: faClipboardCheck, className: 'text-info' },
  unread: { icon: faEnvelope, className: 'text-info' },
  running: { icon: faCircle, className: 'text-success' },
};

function categoryLabel(category: WorkspaceTabStatusCategory): string {
  switch (category) {
    case 'failed':
      return m.hud_attention_kindFailed_label();
    case 'blocker':
      return m.hud_attention_kindBlocked_label();
    case 'question':
      return m.hud_attention_kindQuestion_label();
    case 'discussion':
      return m.hud_attention_kindDiscussion_label();
    case 'needs_input':
      return m.hud_attention_kindNeedsAttention_label();
    case 'review':
      return m.hud_attention_kindReviewRequired_label();
    case 'unread':
      return m.hud_attention_kindUnread_label();
    case 'running':
      return m.hud_agentState_running_label();
  }
}

export function getWorkspaceTabStatusPresentation(
  category: WorkspaceTabStatusCategory,
): WorkspaceTabStatusPresentation {
  return { ...CATEGORY_VISUALS[category], label: categoryLabel(category) };
}

export function formatWorkspaceTabStatusDetail(item: WorkspaceTabStatusItem): string {
  const values = { status: categoryLabel(item.category), count: formatInteger(item.count) };
  return item.agentNames.length > 0
    ? m.layout_workspaceTabStrip_statusAgentsDetail_description({
        ...values,
        agents: item.agentNames.join(', '),
      })
    : m.layout_workspaceTabStrip_statusDetail_description(values);
}

export function formatWorkspaceTabStatusItems(items: WorkspaceTabStatusItem[]): string {
  return items.map(formatWorkspaceTabStatusDetail).join(' · ');
}

export function formatWorkspaceTabStatusSummary(status: WorkspaceTabStatus): string {
  return formatWorkspaceTabStatusItems(status.categories);
}
