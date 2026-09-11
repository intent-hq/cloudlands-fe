/**
 * Register All Tab Types
 *
 * This file registers all tab types with the registry.
 * Import this file early in the app initialization to ensure
 * all tab types are available.
 */

import { tabTypeRegistry } from './registry';
import type { WorkspacePanelLayoutState } from '$store/renderer/slices/panel-layout/panel-layout-types';

// Icons
import {
  faComment,
  faTerminal,
  faFile,
  faCodeBranch,
  faGlobe,
  faGear,
  faHouse,
  faCodeCommit,
  faRobot,
  faCode,
} from '@fortawesome/free-solid-svg-icons';
import { RESOURCE_ICON_BY_KIND } from '$lib/components/shared/resource-icon';
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
    loadComponent: () => import('./BrowserTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: faGlobe,
    get defaultTitle() {
      return m.layout_tabTypes_browser_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_browser_category();
    },
    sidebarTabId: 'browser',
    renameable: false,
  });

  // Terminal tab
  tabTypeRegistry.register({
    type: 'terminal',
    loadComponent: () => import('./TerminalTabType.svelte'),
    defaultWidthTier: 'medium',
    icon: faTerminal,
    get defaultTitle() {
      return m.layout_tabTypes_terminal_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_terminal_category();
    },
    sidebarTabId: 'terminals',
    renameable: false,
  });

  // Code Review tab
  tabTypeRegistry.register({
    type: 'code-review',
    loadComponent: () => import('./CodeReviewTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: faCodeCommit,
    get defaultTitle() {
      return m.layout_tabTypes_codeReview_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_codeReview_category();
    },
    renameable: false,
  });

  // Agent Overview tab
  tabTypeRegistry.register({
    type: 'agent-overview',
    loadComponent: () => import('./AgentOverviewTabType.svelte'),
    defaultWidthTier: 'narrow',
    icon: faRobot,
    get defaultTitle() {
      return m.layout_tabTypes_agentOverview_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_agents_category();
    },
    renameable: false,
  });

  // Agent tab
  tabTypeRegistry.register({
    type: 'agent',
    loadComponent: () => import('./AgentTabType.svelte'),
    defaultWidthTier: 'chat',
    icon: faComment,
    get defaultTitle() {
      return m.layout_tabTypes_agent_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_agents_category();
    },
    sidebarTabId: 'agents',
    renameable: true,
  });

  // Note tab
  tabTypeRegistry.register({
    type: 'note',
    loadComponent: () => import('./NoteTabType.svelte'),
    defaultWidthTier: 'medium',
    icon: RESOURCE_ICON_BY_KIND.note,
    get defaultTitle() {
      return m.layout_tabTypes_note_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_context_category();
    },
    sidebarTabId: 'notes',
    renameable: true,
  });

  // File tab
  tabTypeRegistry.register({
    type: 'file',
    loadComponent: () => import('./FileTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: faFile,
    get defaultTitle() {
      return m.layout_tabTypes_file_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_files_category();
    },
    sidebarTabId: 'files',
    renameable: true,
  });

  // Diff tab
  tabTypeRegistry.register({
    type: 'diff',
    loadComponent: () => import('./DiffTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: faCodeBranch,
    get defaultTitle() {
      return m.layout_tabTypes_diff_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_changes_category();
    },
    sidebarTabId: 'files',
    renameable: false,
  });

  // Changes tab
  tabTypeRegistry.register({
    type: 'changes',
    loadComponent: () => import('./ChangesTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: RESOURCE_ICON_BY_KIND.changes,
    get defaultTitle() {
      return m.layout_tabTypes_changes_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_changes_category();
    },
    sidebarTabId: 'changes',
    renameable: false,
  });

  // Local Changes tab
  tabTypeRegistry.register({
    type: 'local-changes',
    loadComponent: () => import('./LocalChangesTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: RESOURCE_ICON_BY_KIND.changes,
    get defaultTitle() {
      return m.layout_tabTypes_localChanges_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_changes_category();
    },
    sidebarTabId: 'changes',
    renameable: false,
  });

  // Chat Changes tab
  tabTypeRegistry.register({
    type: 'chat-changes',
    loadComponent: () => import('./ChatChangesTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: RESOURCE_ICON_BY_KIND.changes,
    get defaultTitle() {
      return m.layout_tabTypes_chatChanges_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_changes_category();
    },
    renameable: false,
  });

  // Activity Changes tab
  tabTypeRegistry.register({
    type: 'activity-changes',
    loadComponent: () => import('./ActivityChangesTabType.svelte'),
    defaultWidthTier: 'wide',
    icon: RESOURCE_ICON_BY_KIND.changes,
    get defaultTitle() {
      return m.layout_tabTypes_activityChanges_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_changes_category();
    },
    renameable: false,
  });

  tabTypeRegistry.register({
    type: 'hook-script',
    loadComponent: () => import('./HookScriptTabType.svelte'),
    defaultWidthTier: 'medium',
    icon: faCode,
    get defaultTitle() {
      return m.chat_backgroundHooks_viewScript_label();
    },
    get categoryLabel() {
      return m.layout_tabTypes_panel_category();
    },
    renameable: false,
  });

  // Settings tab
  tabTypeRegistry.register({
    type: 'settings',
    loadComponent: () => import('./SettingsTabType.svelte'),
    defaultWidthTier: 'narrow',
    icon: faGear,
    get defaultTitle() {
      return m.layout_tabTypes_settings_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_settings_category();
    },
    renameable: false,
  });

  // Overview tab
  tabTypeRegistry.register({
    type: 'overview',
    loadComponent: () => import('./OverviewTabType.svelte'),
    defaultWidthTier: 'narrow',
    icon: faHouse,
    get defaultTitle() {
      return m.layout_tabTypes_overview_title();
    },
    get categoryLabel() {
      return m.layout_tabTypes_overview_category();
    },
    renameable: false,
  });
}

/** Warm only the tabs that will be visible when a persisted layout appears. */
export async function preloadRestoredTabTypes(
  layout: Pick<WorkspacePanelLayoutState, 'panels' | 'restoreStatus'> | undefined,
): Promise<void> {
  if (layout?.restoreStatus !== 'restored') return;

  const activeTypes = new Set(
    Object.values(layout.panels).flatMap((panel) => {
      const activeTab = panel.tabs.find((tab) => tab.id === panel.activeTabId);
      return activeTab ? [activeTab.type] : [];
    }),
  );
  await Promise.allSettled([...activeTypes].map((type) => tabTypeRegistry.loadComponent(type)));
}
