import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import {
  faCodeBranch,
  faFolder,
  faRobot,
  faTerminal,
  faUsers,
  faWindowMaximize,
} from '@fortawesome/free-solid-svg-icons';
import { m } from '$shared/paraglide/messages.js';
import { RESOURCE_ICON_BY_KIND } from '$lib/components/shared/resource-icon';

export interface TabDefinition {
  id: string;
  label: string;
  icon: IconDefinition;
  description: string;
  hideLabel?: boolean;
  hideHeader?: boolean;
}

export const TAB_DEFINITIONS: TabDefinition[] = [
  {
    id: 'agents',
    get label() {
      return m.workspace_multiSelectSidebar_agentsTab_label();
    },
    icon: faRobot,
    get description() {
      return m.workspace_multiSelectSidebar_agentsTab_description();
    },
  },
  {
    id: 'people',
    get label() {
      return m.workspace_peopleTile_title();
    },
    icon: faUsers,
    description: '',
  },
  {
    id: 'context',
    get label() {
      return m.workspace_multiSelectSidebar_contextTab_label();
    },
    icon: RESOURCE_ICON_BY_KIND.note,
    get description() {
      return m.workspace_multiSelectSidebar_contextTab_description();
    },
  },
  {
    id: 'changes',
    get label() {
      return m.workspace_multiSelectSidebar_changesTab_label();
    },
    icon: faCodeBranch,
    get description() {
      return m.workspace_multiSelectSidebar_changesTab_description();
    },
  },
  {
    id: 'files',
    get label() {
      return m.workspace_multiSelectSidebar_filesTab_label();
    },
    icon: faFolder,
    get description() {
      return m.workspace_multiSelectSidebar_filesTab_description();
    },
  },
  {
    id: 'browser',
    get label() {
      return m.workspace_multiSelectSidebar_browserTab_label();
    },
    icon: faWindowMaximize,
    get description() {
      return m.workspace_multiSelectSidebar_browserTab_description();
    },
  },
  {
    id: 'shell',
    get label() {
      return m.workspace_multiSelectSidebar_shellTab_label();
    },
    icon: faTerminal,
    get description() {
      return m.workspace_multiSelectSidebar_shellTab_description();
    },
  },
];

export type TabId = (typeof TAB_DEFINITIONS)[number]['id'];
function isValidTabId(value: string): value is TabId {
  return TAB_DEFINITIONS.some((tab) => tab.id === value);
}

// Managers can use Shells for saved scripts; raw terminals and browsers stay owner-only.
export const OWNER_ONLY_TAB_IDS: ReadonlySet<TabId> = new Set<TabId>(['browser', 'shell']);

export function normalizeSelectedTabs(
  tabIds: string[],
  isCollaborator = false,
  showPeople = true,
  canOperateScripts = false,
): Set<TabId> {
  const normalized = tabIds.filter(
    (tabId) =>
      isValidTabId(tabId) &&
      (tabId !== 'people' || showPeople) &&
      !(
        isCollaborator &&
        OWNER_ONLY_TAB_IDS.has(tabId as TabId) &&
        !(tabId === 'shell' && canOperateScripts)
      ),
  );
  return new Set(normalized.length > 0 ? (normalized as TabId[]) : ['agents']);
}

/** Selected tab ids in sidebar order. */
export function orderSelectedTabs(selected: Iterable<TabId>): TabId[] {
  const ids = new Set(selected);
  return TAB_DEFINITIONS.flatMap(({ id }) => (ids.has(id) ? [id] : []));
}

/** Shift-click: add a pane, or remove it unless it is the last one. */
export function toggleSelectedTab(selected: Iterable<TabId>, tabId: TabId): TabId[] {
  const ids = new Set(selected);
  if (!ids.has(tabId)) ids.add(tabId);
  else if (ids.size > 1) ids.delete(tabId);
  return orderSelectedTabs(ids);
}
