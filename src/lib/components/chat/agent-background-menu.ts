import { faRightLeft } from '@fortawesome/free-solid-svg-icons';
import type { AgentSession } from '$shared/types';
import { isBackgroundAgentSession } from '$shared/utils/agent-scope';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { setAgentBackgroundRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';

/** Menu composition for the persisted agent mode; display-only card props are not authoritative. */
export function backgroundModeMenuItems(
  agent: AgentSession | undefined,
  pending: boolean,
  closeMenu: () => void,
): SidebarMenuEntry[] {
  if (!agent?.workspaceId || agent.retiredAt) return [];
  const background = isBackgroundAgentSession(agent);
  return [
    {
      id: 'toggle-background',
      label: background
        ? m.chat_agentCard_menu_moveToForeground_label()
        : m.chat_agentCard_menu_moveToBackground_label(),
      icon: faRightLeft,
      disabled: pending,
      onClick: () => {
        closeMenu();
        appStore.dispatch(
          setAgentBackgroundRequested(String(agent.workspaceId), String(agent.id), !background),
        );
      },
    },
  ];
}
