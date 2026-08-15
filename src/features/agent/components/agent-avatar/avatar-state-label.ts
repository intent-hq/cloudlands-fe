import { m } from '$shared/paraglide/messages.js';
import type { AvatarState } from './avatar-state';

export function getAgentAvatarStateLabel(state: AvatarState): string {
  switch (state) {
    case 'running':
      return m.layout_activeCard_running_header();
    case 'responding':
      return m.agentOverview_hierarchyGraph_statusResponding_label();
    case 'unread':
      return m.layout_activeCard_unread_header();
    case 'completed':
      return m.agentOverview_hierarchyGraph_statusCompleted_label();
    case 'failed':
      return m.agentOverview_hierarchyGraph_statusFailed_label();
    case 'waiting':
      return m.agentOverview_hierarchyGraph_statusWaiting_label();
    case 'needs-permission':
      return m.events_activity_agentAskedPermission_label();
    case 'attention-discussion':
      return m.chat_agentCard_attentionDiscussion_label();
    case 'attention-blocker':
      return m.chat_agentCard_attentionBlocker_label();
    case 'idle':
      return m.agentOverview_hierarchyGraph_statusIdle_label();
  }
}
