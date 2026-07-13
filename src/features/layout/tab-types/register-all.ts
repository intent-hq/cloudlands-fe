/**
 * Register All Tab Types
 *
 * This file registers all tab types with the registry.
 * Import this file early in the app initialization to ensure
 * all tab types are available.
 */

import { tabTypeRegistry } from './registry';

// Tab Type Components
import BrowserTabType from './BrowserTabType.svelte';
import TerminalTabType from './TerminalTabType.svelte';
import CodeReviewTabType from './CodeReviewTabType.svelte';
import AgentOverviewTabType from './AgentOverviewTabType.svelte';
import AgentTabType from './AgentTabType.svelte';
import NoteTabType from './NoteTabType.svelte';
import FileTabType from './FileTabType.svelte';
import DiffTabType from './DiffTabType.svelte';
import ChangesTabType from './ChangesTabType.svelte';
import LocalChangesTabType from './LocalChangesTabType.svelte';
import ChatChangesTabType from './ChatChangesTabType.svelte';
import ActivityChangesTabType from './ActivityChangesTabType.svelte';
import SettingsTabType from './SettingsTabType.svelte';
import OverviewTabType from './OverviewTabType.svelte';

// Icons
import {
  faComment,
  faTerminal,
  faFile,
  faCodeBranch,
  faGlobe,
  faGear,
  faHouse,
  faPencil,
  faCodeCommit,
  faRobot,
} from '@fortawesome/free-solid-svg-icons';
import { faNote } from '$lib/icons/faNote';

/**
 * Register all tab types
 *
 * Call this function during app initialization to register all tab types.
 */
export function registerAllTabTypes(): void {
  // Browser tab
  tabTypeRegistry.register({
    type: 'browser',
    component: BrowserTabType,
    icon: faGlobe,
    defaultTitle: 'Browser',
    categoryLabel: 'Browser',
    sidebarTabId: 'browser',
    renameable: false,
  });

  // Terminal tab
  tabTypeRegistry.register({
    type: 'terminal',
    component: TerminalTabType,
    icon: faTerminal,
    defaultTitle: 'Terminal',
    categoryLabel: 'Terminal',
    sidebarTabId: 'terminals',
    renameable: false,
  });

  // Code Review tab
  tabTypeRegistry.register({
    type: 'code-review',
    component: CodeReviewTabType,
    icon: faCodeCommit,
    defaultTitle: 'Code Review',
    categoryLabel: 'Code Review',
    renameable: false,
  });

  // Agent Overview tab
  tabTypeRegistry.register({
    type: 'agent-overview',
    component: AgentOverviewTabType,
    icon: faRobot,
    defaultTitle: 'Agent Overview',
    categoryLabel: 'Agents',
    renameable: false,
  });

  // Agent tab
  tabTypeRegistry.register({
    type: 'agent',
    component: AgentTabType,
    icon: faComment,
    defaultTitle: 'Agent',
    categoryLabel: 'Agents',
    sidebarTabId: 'agents',
    renameable: true,
  });

  // Note tab
  tabTypeRegistry.register({
    type: 'note',
    component: NoteTabType,
    icon: faNote,
    defaultTitle: 'Note',
    categoryLabel: 'Context',
    sidebarTabId: 'notes',
    renameable: true,
  });

  // File tab
  tabTypeRegistry.register({
    type: 'file',
    component: FileTabType,
    icon: faFile,
    defaultTitle: 'File',
    categoryLabel: 'Files',
    sidebarTabId: 'files',
    renameable: true,
  });

  // Diff tab
  tabTypeRegistry.register({
    type: 'diff',
    component: DiffTabType,
    icon: faCodeBranch,
    defaultTitle: 'Diff',
    categoryLabel: 'Changes',
    sidebarTabId: 'files',
    renameable: false,
  });

  // Changes tab
  tabTypeRegistry.register({
    type: 'changes',
    component: ChangesTabType,
    icon: faPencil,
    defaultTitle: 'Changes',
    categoryLabel: 'Changes',
    sidebarTabId: 'changes',
    renameable: false,
  });

  // Local Changes tab
  tabTypeRegistry.register({
    type: 'local-changes',
    component: LocalChangesTabType,
    icon: faPencil,
    defaultTitle: 'Local Changes',
    categoryLabel: 'Changes',
    sidebarTabId: 'changes',
    renameable: false,
  });

  // Chat Changes tab
  tabTypeRegistry.register({
    type: 'chat-changes',
    component: ChatChangesTabType,
    icon: faPencil,
    defaultTitle: 'Chat Changes',
    categoryLabel: 'Changes',
    renameable: false,
  });

  // Activity Changes tab
  tabTypeRegistry.register({
    type: 'activity-changes',
    component: ActivityChangesTabType,
    icon: faCodeBranch,
    defaultTitle: 'Activity Changes',
    categoryLabel: 'Changes',
    renameable: false,
  });

  // Settings tab
  tabTypeRegistry.register({
    type: 'settings',
    component: SettingsTabType,
    icon: faGear,
    defaultTitle: 'Settings',
    categoryLabel: 'Settings',
    renameable: false,
  });

  // Overview tab
  tabTypeRegistry.register({
    type: 'overview',
    component: OverviewTabType,
    icon: faHouse,
    defaultTitle: 'Overview',
    categoryLabel: 'Overview',
    renameable: false,
  });
}
