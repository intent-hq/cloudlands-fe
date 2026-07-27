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
import { m } from '$shared/paraglide/messages.js';

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
    get defaultTitle() { return m.layout_tabTypes_browser_title(); },
    get categoryLabel() { return m.layout_tabTypes_browser_category(); },
    sidebarTabId: 'browser',
    renameable: false,
  });

  // Terminal tab
  tabTypeRegistry.register({
    type: 'terminal',
    component: TerminalTabType,
    icon: faTerminal,
    get defaultTitle() { return m.layout_tabTypes_terminal_title(); },
    get categoryLabel() { return m.layout_tabTypes_terminal_category(); },
    sidebarTabId: 'terminals',
    renameable: false,
  });

  // Code Review tab
  tabTypeRegistry.register({
    type: 'code-review',
    component: CodeReviewTabType,
    icon: faCodeCommit,
    get defaultTitle() { return m.layout_tabTypes_codeReview_title(); },
    get categoryLabel() { return m.layout_tabTypes_codeReview_category(); },
    renameable: false,
  });

  // Agent Overview tab
  tabTypeRegistry.register({
    type: 'agent-overview',
    component: AgentOverviewTabType,
    icon: faRobot,
    get defaultTitle() { return m.layout_tabTypes_agentOverview_title(); },
    get categoryLabel() { return m.layout_tabTypes_agents_category(); },
    renameable: false,
  });

  // Agent tab
  tabTypeRegistry.register({
    type: 'agent',
    component: AgentTabType,
    icon: faComment,
    get defaultTitle() { return m.layout_tabTypes_agent_title(); },
    get categoryLabel() { return m.layout_tabTypes_agents_category(); },
    sidebarTabId: 'agents',
    renameable: true,
  });

  // Note tab
  tabTypeRegistry.register({
    type: 'note',
    component: NoteTabType,
    icon: faNote,
    get defaultTitle() { return m.layout_tabTypes_note_title(); },
    get categoryLabel() { return m.layout_tabTypes_context_category(); },
    sidebarTabId: 'notes',
    renameable: true,
  });

  // File tab
  tabTypeRegistry.register({
    type: 'file',
    component: FileTabType,
    icon: faFile,
    get defaultTitle() { return m.layout_tabTypes_file_title(); },
    get categoryLabel() { return m.layout_tabTypes_files_category(); },
    sidebarTabId: 'files',
    renameable: true,
  });

  // Diff tab
  tabTypeRegistry.register({
    type: 'diff',
    component: DiffTabType,
    icon: faCodeBranch,
    get defaultTitle() { return m.layout_tabTypes_diff_title(); },
    get categoryLabel() { return m.layout_tabTypes_changes_category(); },
    sidebarTabId: 'files',
    renameable: false,
  });

  // Changes tab
  tabTypeRegistry.register({
    type: 'changes',
    component: ChangesTabType,
    icon: faPencil,
    get defaultTitle() { return m.layout_tabTypes_changes_title(); },
    get categoryLabel() { return m.layout_tabTypes_changes_category(); },
    sidebarTabId: 'changes',
    renameable: false,
  });

  // Local Changes tab
  tabTypeRegistry.register({
    type: 'local-changes',
    component: LocalChangesTabType,
    icon: faPencil,
    get defaultTitle() { return m.layout_tabTypes_localChanges_title(); },
    get categoryLabel() { return m.layout_tabTypes_changes_category(); },
    sidebarTabId: 'changes',
    renameable: false,
  });

  // Chat Changes tab
  tabTypeRegistry.register({
    type: 'chat-changes',
    component: ChatChangesTabType,
    icon: faPencil,
    get defaultTitle() { return m.layout_tabTypes_chatChanges_title(); },
    get categoryLabel() { return m.layout_tabTypes_changes_category(); },
    renameable: false,
  });

  // Activity Changes tab
  tabTypeRegistry.register({
    type: 'activity-changes',
    component: ActivityChangesTabType,
    icon: faCodeBranch,
    get defaultTitle() { return m.layout_tabTypes_activityChanges_title(); },
    get categoryLabel() { return m.layout_tabTypes_changes_category(); },
    renameable: false,
  });

  // Settings tab
  tabTypeRegistry.register({
    type: 'settings',
    component: SettingsTabType,
    icon: faGear,
    get defaultTitle() { return m.layout_tabTypes_settings_title(); },
    get categoryLabel() { return m.layout_tabTypes_settings_category(); },
    renameable: false,
  });

  // Overview tab
  tabTypeRegistry.register({
    type: 'overview',
    component: OverviewTabType,
    icon: faHouse,
    get defaultTitle() { return m.layout_tabTypes_overview_title(); },
    get categoryLabel() { return m.layout_tabTypes_overview_category(); },
    renameable: false,
  });
}
