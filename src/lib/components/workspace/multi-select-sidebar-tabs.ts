import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import {
  faAsterisk,
  faFolderTree,
  faGlobe,
  faLayerGroup,
  faRobot,
  faTerminal,
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
    id: 'map',
    get label() {
      return m.semanticMap_sandbox_title();
    },
    icon: faLayerGroup,
    get description() {
      return m.semanticMap_canvas_visualization_ariaLabel();
    },
  },
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
    icon: RESOURCE_ICON_BY_KIND.changes,
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
  {
    id: 'browser',
    get label() {
      return m.workspace_multiSelectSidebar_browser_label();
    },
    icon: faGlobe,
    get description() {
      return m.workspace_addContext_browser_description();
    },
  },
  {
    id: 'shell',
    get label() {
      return m.workspace_terminalDock_shell_label();
    },
    icon: faTerminal,
    description: '',
  },
];

export type TabId = (typeof TAB_DEFINITIONS)[number]['id'];
export type LauncherTabId = Exclude<TabId, 'overview'>;

export const LAUNCHER_GRID_POSITIONS: Record<LauncherTabId, { column: number; row: number }> = {
  agents: { column: 0, row: 0 },
  context: { column: 1, row: 0 },
  changes: { column: 0, row: 1 },
  files: { column: 1, row: 1 },
  map: { column: 0, row: 2 },
};

function isValidTabId(value: string): value is TabId {
  return TAB_DEFINITIONS.some((tab) => tab.id === value);
}

export function normalizeSelectedTabs(tabIds: string[]): Set<TabId> {
  const normalized = tabIds.filter(isValidTabId);
  return new Set([normalized[0] ?? 'overview']);
}
