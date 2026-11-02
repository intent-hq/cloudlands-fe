import { faThumbtack, faThumbtackSlash } from '@fortawesome/free-solid-svg-icons';
import type { AgentSession } from '$shared/types';
import { classifyAgentScope } from '$shared/utils/agent-scope';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { setAgentPinnedRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';

/**
 * Sidebar pin toggle (daemon-owned `pinned`, §5.5). Offered only when the
 * daemon serves the boolean (older daemons cannot pin). Pinning is limited to
 * live top-level agents; a pinned row can always be unpinned.
 */
export function pinMenuItems(
  agent: AgentSession | undefined,
  workspaceId: string | undefined,
  closeMenu: () => void,
): SidebarMenuEntry[] {
  const pinned = agent?.pinned;
  if (!agent || !workspaceId || typeof pinned !== 'boolean') return [];
  if (!pinned && (agent.retiredAt || classifyAgentScope(agent) !== 'topLevel')) return [];
  return [
    {
      id: 'toggle-pinned',
      label: pinned ? m.chat_agentCard_menu_unpin_label() : m.chat_agentCard_menu_pinToTop_label(),
      icon: pinned ? faThumbtackSlash : faThumbtack,
      onClick: () => {
        closeMenu();
        // The saga owns the optimistic flip, failure toast and rollback.
        appStore.dispatch(setAgentPinnedRequested(workspaceId, String(agent.id), !pinned));
      },
    },
  ];
}
