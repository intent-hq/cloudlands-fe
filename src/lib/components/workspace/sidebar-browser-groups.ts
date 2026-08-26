/**
 * Grouping of browser tabs by owner agent for the sidebar browser list
 * (monorepo#2857). Owner groups are ordered by first appearance in the tab
 * list; the "Unclaimed" group (user-opened, unowned tabs) always renders
 * last. Hidden (user-closed) owned tabs stay listed in their owner's group
 * with a restore affordance — a user close of an owned tab is a hide, not a
 * destroy.
 */

import type { AgentSession } from '$shared/types';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

interface SidebarBrowserTabEntry {
  tab: PanelTab;
  /** Panel hosting the tab; undefined for hidden (user-closed) owned tabs. */
  panelId?: string;
  /** Whether the tab is its panel's active tab. Always false for hidden tabs. */
  active: boolean;
  /** Hidden (user-closed) owned tab — listed with a restore affordance. */
  hidden: boolean;
}

export interface SidebarBrowserGroup {
  /** Owning agent id, or null for the "Unclaimed" group. */
  ownerAgentId: string | null;
  /** Resolved agent display name; null for the "Unclaimed" group. */
  ownerName: string | null;
  entries: SidebarBrowserTabEntry[];
}

/**
 * Resolve an owner agent's display name: the live workspace agent session
 * when it is loaded (it tracks renames), else the name persisted with the
 * tab (`PanelTab.ownerAgentName`, monorepo#3438 — the store often lacks
 * idle/unloaded owners), else a shortened agent id.
 */
export function resolveOwnerName(
  ownerAgentId: string,
  agents: AgentSession[],
  persistedName?: string,
): string {
  const session = agents.find((agent) => String(agent.id) === ownerAgentId);
  const name = session?.name?.trim();
  if (name) return name;
  const fallback = persistedName?.trim();
  if (fallback) return fallback;
  // "agent-<uuid>" → "agent-<first8>…" keeps the fallback readable.
  return ownerAgentId.length > 14 ? `${ownerAgentId.slice(0, 14)}…` : ownerAgentId;
}

/**
 * Group visible + hidden browser tabs by owner agent. Within a group,
 * visible tabs keep their tab-list order and hidden tabs follow them.
 */
export function groupBrowserTabsByOwner(
  visible: Array<{ tab: PanelTab; panelId: string; active: boolean }>,
  hidden: PanelTab[],
  agents: AgentSession[],
): SidebarBrowserGroup[] {
  const owned = new Map<string, SidebarBrowserGroup>();
  const unclaimed: SidebarBrowserGroup = { ownerAgentId: null, ownerName: null, entries: [] };

  const groupFor = (ownerAgentId: string, persistedName?: string): SidebarBrowserGroup => {
    let group = owned.get(ownerAgentId);
    if (!group) {
      group = {
        ownerAgentId,
        ownerName: resolveOwnerName(ownerAgentId, agents, persistedName),
        entries: [],
      };
      owned.set(ownerAgentId, group);
    }
    return group;
  };

  for (const { tab, panelId, active } of visible) {
    const target = tab.ownerAgentId ? groupFor(tab.ownerAgentId, tab.ownerAgentName) : unclaimed;
    target.entries.push({ tab, panelId, active, hidden: false });
  }
  // Hidden tabs are always owned (only owned tabs hide on close), but a
  // malformed persisted entry without an owner still lands in Unclaimed
  // rather than disappearing.
  for (const tab of hidden) {
    if (tab.type !== 'browser') continue;
    const target = tab.ownerAgentId ? groupFor(tab.ownerAgentId, tab.ownerAgentName) : unclaimed;
    target.entries.push({ tab, active: false, hidden: true });
  }

  const groups = [...owned.values()];
  if (unclaimed.entries.length > 0) groups.push(unclaimed);
  return groups;
}
