import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faAsterisk, faFolderTree, faPencil, faRobot } from '@fortawesome/free-solid-svg-icons';
import { m } from '$shared/paraglide/messages.js';
import { faNote } from '$lib/icons/faNote';

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
    id: 'overview',
    get label() {
      return m.workspace_multiSelectSidebar_overviewTab_label();
    },
    icon: faAsterisk,
    get description() {
      return m.workspace_multiSelectSidebar_overviewTab_description();
    },
    hideLabel: true,
    hideHeader: true,
  },
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
    id: 'context',
    get label() {
      return m.workspace_multiSelectSidebar_contextTab_label();
    },
    icon: faNote,
    get description() {
      return m.workspace_multiSelectSidebar_contextTab_description();
    },
  },
  {
    id: 'changes',
    get label() {
      return m.workspace_multiSelectSidebar_changesTab_label();
    },
    icon: faPencil,
    get description() {
      return m.workspace_multiSelectSidebar_changesTab_description();
    },
  },
  {
    id: 'files',
    get label() {
      return m.workspace_multiSelectSidebar_filesTab_label();
    },
    icon: faFolderTree,
    get description() {
      return m.workspace_multiSelectSidebar_filesTab_description();
    },
  },
];

export type TabId = (typeof TAB_DEFINITIONS)[number]['id'];
export type LauncherTabId = Exclude<TabId, 'overview'>;

export const LAUNCHER_GRID_POSITIONS: Record<LauncherTabId, { column: number; row: number }> = {
  agents: { column: 0, row: 0 },
  context: { column: 1, row: 0 },
  changes: { column: 0, row: 1 },
  files: { column: 1, row: 1 },
};

function isValidTabId(value: string): value is TabId {
  return TAB_DEFINITIONS.some((tab) => tab.id === value);
}

export function normalizeSelectedTabs(tabIds: string[]): Set<TabId> {
  const normalized = tabIds.filter(isValidTabId);
  return new Set([normalized[0] ?? 'overview']);
}
