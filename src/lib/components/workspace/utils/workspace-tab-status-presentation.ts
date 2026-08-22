import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type {
  WorkspaceTabStatus,
  WorkspaceTabStatusCategory,
  WorkspaceTabStatusItem,
} from '$store/renderer/slices/hud/hud-types';

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

export function formatWorkspaceTabStatusDetail(item: WorkspaceTabStatusItem): string {
  const values = { status: categoryLabel(item.category), count: formatInteger(item.count) };
  return item.agentNames.length > 0
    ? m.layout_workspaceTabStrip_statusAgentsDetail_description({
        ...values,
        agents: item.agentNames.join(', '),
      })
    : m.layout_workspaceTabStrip_statusDetail_description(values);
}

function formatWorkspaceTabStatusItems(items: WorkspaceTabStatusItem[]): string {
  return items.map(formatWorkspaceTabStatusDetail).join(' · ');
}

export function formatWorkspaceTabStatusSummary(status: WorkspaceTabStatus): string {
  return formatWorkspaceTabStatusItems(status.categories);
}
