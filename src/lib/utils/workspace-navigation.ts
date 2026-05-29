/**
 * Workspace Navigation Utilities
 *
 * Provides simple, direct function calls for navigating within a workspace.
 * Uses workspace-navigation Redux state for drawer persistence.
 *
 * Usage:
 * ```typescript
 * import {
  navigateToAgent,
  navigateToNote,
} from '$lib/utils/workspace-navigation';
 *
 * // Navigate to an agent's chat drawer
 * await navigateToAgent('agent-123');
 *
 * // Navigate to a note in main content
 * await navigateToNote('note-456');
 * ```
 */

import { Logger } from '$shared/logger';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { track } from '$lib/services/analytics';
import { dispatchWindowEvent } from './window-events';
import { closeWorkspaceTab } from '$lib/store/slices/tab-state/tab-state-slice';
import { selectCurrentWorkspaceTabId } from '$lib/store/slices/tab-state/tab-state-selectors';
import {
  closeWorkspaceDrawer,
  openWorkspaceDrawer,
  openWorkspaceFile,
  openWorkspaceNote,
} from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';
import { store as appStore } from '$lib/store/store';

const logger = new Logger('WorkspaceNavigation');

/**
 * Navigate to an agent's chat drawer
 *
 * Opens the drawer and displays the specified agent's chat.
 * Uses workspace-navigation Redux state.
 *
 * @param agentId - The ID of the agent to navigate to
 */
export async function navigateToAgent(agentId: string): Promise<void> {
  logger.info(`[navigateToAgent] Navigating to agent: ${agentId}`);

  const currentPage = get(page);
  const workspaceId = currentPage.params.id;

  if (!workspaceId) {
    logger.error('[navigateToAgent] No workspace ID found in current page params');
    return;
  }

  // Update URL params
  const url = new URL(window.location.href);
  url.searchParams.set('drawerOpen', '1');
  url.searchParams.set('drawerType', 'agent');
  url.searchParams.set('selectedAgent', agentId);
  // Remove selectedTerminal if present to avoid conflicts
  url.searchParams.delete('selectedTerminal');

  await goto(url.toString(), { replaceState: true });

  appStore.dispatch(openWorkspaceDrawer(workspaceId, 'agent', agentId));
}

/**
 * Navigate to a terminal drawer
 *
 * Opens the drawer and displays the specified terminal.
 * Uses workspace-navigation Redux state.
 *
 * @param terminalId - The ID of the terminal to navigate to
 */
export async function navigateToTerminal(terminalId: string): Promise<void> {
  logger.info(`[navigateToTerminal] Navigating to terminal: ${terminalId}`);

  const currentPage = get(page);
  const workspaceId = currentPage.params.id;

  if (!workspaceId) {
    logger.error('[navigateToTerminal] No workspace ID found in current page params');
    return;
  }

  // Update URL params
  const url = new URL(window.location.href);

  // Only set drawerOpen if it's not already open to avoid close/open animation
  const isDrawerOpen = url.searchParams.get('drawerOpen') === '1';
  const isTerminalDrawer = url.searchParams.get('drawerType') === 'terminal';

  // If drawer is already open for terminals, don't change drawerOpen to avoid animation
  if (!isDrawerOpen || !isTerminalDrawer) {
    url.searchParams.set('drawerOpen', '1');
  }

  url.searchParams.set('drawerType', 'terminal');
  url.searchParams.set('selectedTerminal', terminalId);
  // Remove selectedAgent if present to avoid conflicts
  url.searchParams.delete('selectedAgent');

  await goto(url.toString(), { replaceState: true });

  appStore.dispatch(openWorkspaceDrawer(workspaceId, 'terminal', terminalId));
}

/** Options for opening content in panels */
export interface OpenInPanelOptions {
  /** If true, opens in an adjacent panel (or creates a split if needed). Used for cmd+click. */
  openInAdjacentPanel?: boolean;
  /** The ID of the panel where the navigation originated (used to open in the same panel). */
  sourcePanelId?: string;
}

/**
 * Find the panel ID from a DOM element by traversing up to find [data-panel-id]
 * Returns undefined if not found (e.g., not in a panel layout)
 */
export function findSourcePanelId(element: HTMLElement | EventTarget | null): string | undefined {
  if (!element || !(element instanceof HTMLElement)) return undefined;
  const panelElement = element.closest('[data-panel-id]');
  return panelElement?.getAttribute('data-panel-id') ?? undefined;
}

/**
 * Navigate to a note in the main content area
 *
 * Opens the specified note in the main content area.
 * Clears any selected file.
 *
 * This function dispatches a 'workspace:open-note' event that can be intercepted
 * by the panel layout system (for panels mode) or handled by the unified workspace
 * state (for classic mode).
 *
 * @param noteId - The ID of the note to navigate to (or 'spec' for workspace spec)
 * @param options - Optional settings for panel behavior
 */
export async function navigateToNote(noteId: string, options?: OpenInPanelOptions): Promise<void> {
  logger.info(`[navigateToNote] Navigating to note: ${noteId}`, options);

  const currentPage = get(page);
  const workspaceId = currentPage.params.id;

  if (!workspaceId) {
    logger.error('[navigateToNote] No workspace ID found in current page params');
    return;
  }

  appStore.dispatch(
    openWorkspaceNote(workspaceId, noteId, {
      openInAdjacentPanel: options?.openInAdjacentPanel ?? false,
      sourcePanelId: options?.sourcePanelId,
    }),
  );
}

/**
 * Navigate to a file in the main content area
 *
 * Opens the specified file in the main content area.
 * Optionally jumps to a specific line number.
 * Clears any selected note.
 *
 * This function dispatches a 'workspace:open-file' event that can be intercepted
 * by the panel layout system (for panels mode) or handled by the unified workspace
 * state (for classic mode).
 *
 * @param filePath - The path of the file to navigate to
 * @param line - Optional line number to jump to
 * @param options - Optional settings for panel behavior
 */
export async function navigateToFile(
  filePath: string,
  line?: number,
  options?: OpenInPanelOptions,
): Promise<void> {
  logger.info(
    `[navigateToFile] Navigating to file: ${filePath}${line ? ` (line ${line})` : ''}`,
    options,
  );

  const currentPage = get(page);
  const workspaceId = currentPage.params.id;

  if (!workspaceId) {
    logger.error('[navigateToFile] No workspace ID found in current page params');
    return;
  }

  appStore.dispatch(
    openWorkspaceFile(workspaceId, filePath, {
      line,
      openInAdjacentPanel: options?.openInAdjacentPanel ?? false,
      sourcePanelId: options?.sourcePanelId,
    }),
  );
}

/**
 * Navigate to the workspace spec
 *
 * Convenience function for navigating to the special 'spec' note.
 */
export async function navigateToSpec(): Promise<void> {
  logger.info('[navigateToSpec] Navigating to workspace spec');
  await navigateToNote('spec');
}

/**
 * Close the drawer
 *
 * Closes the drawer using workspace-navigation Redux state.
 * Preserves main content state.
 */
export async function closeDrawer(): Promise<void> {
  logger.info('[closeDrawer] Closing drawer');

  const currentPage = get(page);
  const workspaceId = currentPage.params.id;

  if (!workspaceId) {
    logger.error('[closeDrawer] No workspace ID found in current page params');
    return;
  }

  // Update URL params
  const url = new URL(window.location.href);
  url.searchParams.set('drawerOpen', '0');
  url.searchParams.delete('selectedAgent');
  url.searchParams.delete('selectedTerminal');

  await goto(url.toString(), { replaceState: true });

  appStore.dispatch(closeWorkspaceDrawer(workspaceId));
}

/**
 * Clear main content
 *
 * Clears the main content area (shows empty state).
 * Preserves drawer state.
 */
export async function clearMainContent(): Promise<void> {
  logger.info('[clearMainContent] Clearing main content');

  const url = new URL(window.location.href);

  url.searchParams.set('mainContentType', 'empty');
  url.searchParams.delete('selectedNoteId');
  url.searchParams.delete('selectedFile');
  url.searchParams.delete('line');

  await goto(url.toString(), { replaceState: false });
}

/**
 * Navigate to a task within a note
 *
 * Opens the specified note and scrolls to the task position.
 * Uses a custom event to communicate the scroll target to NoteWithComments.
 *
 * @param noteId - The ID of the note containing the task
 * @param taskPosition - The position of the task within the note (from TipTap)
 * @param taskText - Optional task text for fallback matching
 */
export async function navigateToTask(
  noteId: string,
  taskPosition: number,
  taskText?: string,
): Promise<void> {
  logger.info('[navigateToTask] Navigating to task', { noteId, taskPosition, taskText });

  // First navigate to the note
  await navigateToNote(noteId);

  // Dispatch scroll-to-task event with retries to handle editor mount timing
  const dispatchScrollEvent = () => {
    dispatchWindowEvent(
      'scroll-to-task',
      { noteId, taskPosition, taskText },
      { bubbles: true },
    );
    logger.debug('[navigateToTask] Dispatched scroll-to-task event', { noteId, taskPosition });
  };

  // Try multiple times with increasing delays to handle different mount timings
  // This handles both already-mounted editors and newly-mounting ones
  const delays = [100, 300, 600];
  for (const delay of delays) {
    setTimeout(dispatchScrollEvent, delay);
  }
}

/**
 * Session storage key for tracking the previous path before settings
 */
const SETTINGS_PREV_PATH_KEY = 'settings-previous-path';

/**
 * Options for navigating to the settings page.
 *
 * Uses a structured object instead of raw URL strings to prevent
 * malformed URLs from string concatenation (e.g., `/settingsagents`).
 */
export interface SettingsNavigationOptions {
  /** Tab to activate (e.g., 'agents', 'connections', 'interface-system') */
  tab?: string;
  /** Hash fragment to scroll to (e.g., 'providers', 'mcp-servers', 'specialists') — without the '#' prefix */
  hash?: string;
  /** Specialist ID to auto-select in the agents tab */
  specialist?: string;
  /** View to open (e.g., 'create-specialist') */
  view?: string;
}

/**
 * Navigate to settings page
 *
 * Saves the current path to sessionStorage so the settings page can show
 * a back button with the correct label.
 *
 * Accepts a structured options object to safely construct the URL.
 *
 * @param options - Optional settings navigation options (tab, hash, specialist, view)
 */
export async function navigateToSettings(options?: SettingsNavigationOptions): Promise<void> {
  logger.info('[navigateToSettings] Navigating to settings', options);

  // Save current path for back navigation
  if (typeof sessionStorage !== 'undefined' && typeof window !== 'undefined') {
    sessionStorage.setItem(SETTINGS_PREV_PATH_KEY, window.location.pathname);
  }

  // Track settings opened
  track('Opened Settings', {});

  // Build the target URL using the URL API for safe construction
  const targetUrl = new URL('/settings', window.location.origin);
  if (options?.tab) targetUrl.searchParams.set('tab', options.tab);
  if (options?.specialist) targetUrl.searchParams.set('specialist', options.specialist);
  if (options?.view) targetUrl.searchParams.set('view', options.view);
  if (options?.hash) targetUrl.hash = options.hash;

  // If already on settings, update the URL in-place
  if (typeof window !== 'undefined' && window.location.pathname === '/settings') {
    // Update query params
    if (options?.tab || options?.specialist || options?.view) {
      const url = new URL(window.location.href);
      if (options?.tab) url.searchParams.set('tab', options.tab);
      if (options?.specialist) url.searchParams.set('specialist', options.specialist);
      if (options?.view) url.searchParams.set('view', options.view);
      if (options?.hash) url.hash = options.hash;
      // Use goto to trigger SvelteKit reactivity for query param changes
      await goto(url.toString(), { replaceState: true });
      return;
    }

    // Hash-only change: update directly to trigger hashchange event
    if (options?.hash) {
      const newHash = `#${options.hash}`;
      if (window.location.hash === newHash) {
        // Clear first so re-setting the same hash still fires the event
        window.location.hash = '';
      }
      window.location.hash = newHash;
      return;
    }

    // Already on settings with no options — nothing to do
    return;
  }

  await goto(targetUrl.pathname + targetUrl.search + targetUrl.hash);
}

/**
 * Get the previous path before navigating to settings
 *
 * Used by the settings page to show a back button.
 *
 * @returns The previous path, or '/' if not set
 */
export function getSettingsPreviousPath(): string {
  if (typeof sessionStorage === 'undefined') return '/';
  return sessionStorage.getItem(SETTINGS_PREV_PATH_KEY) || '/';
}

/**
 * Navigate back from settings to the previous page
 */
export async function navigateBackFromSettings(): Promise<void> {
  const prevPath = getSettingsPreviousPath();
  logger.info('[navigateBackFromSettings] Navigating back to:', prevPath);
  await goto(prevPath);
}

/**
 * Navigate after a workspace has been archived or deleted.
 *
 * Closes the tab for the removed workspace and navigates to:
 * - The next available workspace tab (if any exist)
 * - The home page (if no other tabs are open)
 *
 * Uses the tab manager's built-in "pick next or previous" logic.
 *
 * @param removedWorkspaceId - The ID of the workspace being archived/deleted
 */
export async function navigateAfterWorkspaceRemoval(removedWorkspaceId: string): Promise<void> {
  logger.info('[navigateAfterWorkspaceRemoval] Navigating after workspace removal:', removedWorkspaceId);

  // Close the tab - this automatically sets currentTabId to the next available tab
  appStore.dispatch(closeWorkspaceTab(removedWorkspaceId));

  // Get the next tab ID (already set by closeTab)
  const nextTabId = selectCurrentWorkspaceTabId.select(appStore.state);

  if (nextTabId && typeof nextTabId === 'string' && nextTabId.length > 0 && nextTabId !== 'undefined' && nextTabId !== 'null' && nextTabId !== removedWorkspaceId) {
    logger.info('[navigateAfterWorkspaceRemoval] Navigating to next tab:', nextTabId);
    await goto(`/workspace/${nextTabId}`);
  } else {
    logger.info('[navigateAfterWorkspaceRemoval] No other tabs, navigating to home');
    await goto('/');
  }
}
