import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faAsterisk, faFolderTree, faPencil, faRobot } from '@fortawesome/free-solid-svg-icons';
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
    label: 'Overview',
    icon: faAsterisk,
    description: 'Workspace status, progress, and key metrics at a glance.',
    hideLabel: true,
    hideHeader: true,
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: faRobot,
    description: 'Agents working on your task in this space.',
  },
  {
    id: 'context',
    label: 'Context',
    icon: faNote,
    description: 'Notes about the task, shared with all agents in this space.',
  },
  {
    id: 'changes',
    label: 'Changes',
    icon: faPencil,
    description: 'Files changed manually or by agents working in this space.',
  },
  {
    id: 'files',
    label: 'Files',
    icon: faFolderTree,
    description: 'The agents in this space are working off a copy of your files.',
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
