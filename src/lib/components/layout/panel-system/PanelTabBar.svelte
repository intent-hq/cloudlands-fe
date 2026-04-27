<script lang="ts">
/* eslint-disable max-lines */
  /**
   * PanelTabBar - Compact header bar for a panel
   *
   * Displays a breadcrumb-style header with:
   * - Category label (muted, uppercase)
   * - Tab switcher dropdown (when multiple tabs)
   * - Active tab title
   * - Content actions on the right
   * - Close button
   */

  import type { PanelTab, PanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { cn } from '$lib/utils';
  import {
    faXmark,
    faFile,
    faRobot,
    faTerminal,
    faGlobe,
    faPlus,
    faCrosshairs,
    faCopy,
    faFolderOpen,
    faArrowUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { toast } from '$lib/components/ui/toast';
  import { locateItemInSidebarRequested } from '$lib/store/slices/app-layout/app-layout-slice';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import Fa from 'svelte-fa';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { getContext, tick, type Snippet } from 'svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { selectIsDragging } from '$lib/store/slices/tab-state/tab-state-selectors';
  import { startDrag, endDrag } from '$lib/store/slices/tab-state/tab-state-slice';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { faNote } from '$lib/icons/faNote';
  import EditableName from '$lib/components/ui/EditableName.svelte';
  import { isSpecNote } from '$shared/constants/notes';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectNoteById } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import { filterSpecialistsByGitHubAuth, selectSpecialistName, selectSpecialists } from '$lib/store/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$lib/store/slices/github-auth/github-auth-selectors';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import {
    selectAgentById,
    selectAllWorkspaceAgents,
  } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import { writable } from 'svelte/store';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import { type AvatarState, getAvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import { selectPermissionRequests } from '$lib/store/slices/permission/permission-selectors';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import { stripWorkspacePrefix } from '$lib/utils/file-utils';
  import { toNativePath } from '$lib/utils/path-utils';

  // Detect platform for file manager labels
  const isWindows = typeof navigator !== 'undefined' && navigator.platform?.startsWith('Win');
  const isMac =
    typeof navigator !== 'undefined' &&
    // @ts-expect-error - userAgentData is not in all browsers
    (navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  const fileManagerName = isWindows ? 'Explorer' : isMac ? 'Finder' : 'File Manager';

  interface Props {
    tabs: PanelTab[];
    activeTabId: string | null;
    panelId: string;
    workspaceId: string;
    isFocused?: boolean;
    /** Content actions snippet to show in header */
    contentActions?: Snippet | null;
    /** Callbacks for creating new items */
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onCreateNote?: () => void;
    onCreateTerminal?: () => void;
    onOpenBrowser?: () => void;
    onTabClick?: (tabId: string) => void;
    onTabClose?: (tabId: string) => void;
    onTabReorder?: (fromIndex: number, toIndex: number) => void;
    /** Handler for moving a tab from another panel to this panel's tab bar */
    onTabMoveToPanel?: (tabId: string, fromPanelId: string, insertIndex?: number) => void;
    onCloseOtherTabs?: (tabId: string) => void;
    onCloseTabsToRight?: (tabId: string) => void;
    onCloseAllTabs?: () => void;
    /** Close all tabs in all panels except the specified one */
    onCloseAllOthersEverywhere?: (tabId: string) => void;
    onClosePanel?: () => void;
    /** Toggle zoom on the panel */
    onZoomToggle?: () => void;
    /** Whether the panel is currently zoomed */
    isZoomed?: boolean;
    /** Handler for renaming a tab (note, agent, or file) */
    onTabRename?: (tab: PanelTab, newName: string) => void;
    /** Split panel horizontally (side by side) */
    onSplitHorizontal?: () => void;
    /** Split panel vertically (top and bottom) */
    onSplitVertical?: () => void;
  }

  let {
    tabs,
    activeTabId,
    panelId,
    workspaceId,
    isFocused = false,
    contentActions = null,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onCreateNote,
    onCreateTerminal,
    onOpenBrowser,
    onTabClick,
    onTabClose,
    onTabReorder,
    onTabMoveToPanel,
    onCloseOtherTabs,
    onCloseTabsToRight,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onCloseAllTabs,
    onCloseAllOthersEverywhere,
    onClosePanel,
    onZoomToggle,
    isZoomed = false,
    onTabRename,
    onSplitHorizontal,
    onSplitVertical,
  }: Props = $props();

  const dispatch = getDispatch();
  const isDragging = selectIsDragging();
  const allPermissionRequests = selectPermissionRequests();

  // Access layout manager from context for expand-on-double-click
  const getLayoutManager = getContext<(() => PanelLayoutManager) | undefined>('panelLayoutManager');

  // Context menu state
  let contextMenuTab = $state<{ tabId: string; x: number; y: number } | null>(null);

  // Track whether a tab was already active before a mousedown,
  // so we can distinguish "double-click on already-active tab" (→ expand toggle)
  // from "double-click on inactive tab" (→ rename).
  let tabActiveBeforeMouseDown: { tabId: string; wasActive: boolean; timestamp: number } | null =
    null;

  // Tab rename state - tracks which tab is being renamed inline
  let renamingTabId = $state<string | null>(null);
  let renameInputRef = $state<HTMLInputElement | null>(null);
  let renameValue = $state('');

  // Mirror the workspaceId prop into a writable so the Redux selector
  // re-evaluates when the prop changes while the component stays mounted.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  // Reactive list of agent sessions for this workspace. Tab titles, avatar
  // state, specialist, and delegation info all derive from this store so the
  // UI updates when agents rename or their session metadata changes.
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);

  // Reactive store subscription for specialist names - ensures re-render when specialists change
  const specialists$ = selectSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const visibleSpecialists = $derived.by(() =>
    filterSpecialistsByGitHubAuth($specialists$, $isGitHubAuth$)
  );
  $effect(() => {
    void $specialists$;
  });

  // Check if any creation callbacks are available
  const hasCreateActions = $derived(
    !!onCreateAgent || !!onCreateAgentWithSpecialist || !!onCreateNote || !!onCreateTerminal || !!onOpenBrowser,
  );

  /**
   * Get the display title for a tab, resolving note/agent titles from the store
   */
  function getTabTitle(tab: PanelTab): string {
    // For note tabs, look up the title from the notes store
    if (tab.type === 'note' && tab.noteId) {
      // Special case for spec note
      if (isSpecNote(tab.noteId)) {
        return 'Spec';
      }
      // Look up the note from the store
      const note = selectNoteById.select(getReduxStore().getState(), workspaceId, tab.noteId);
      if (note) {
        return note.title || 'Untitled';
      }
    }
    // For agent tabs, look up the name from the reactive workspace agents store
    // This ensures the tab title updates when an agent renames itself
    if (tab.type === 'agent' && tab.agentId) {
      const agent = $workspaceAgents$.find((a) => a.id === tab.agentId);
      if (agent?.name) {
        return agent.name;
      }
    }
    // Fall back to the tab's stored title
    return tab.title;
  }

  /**
   * Check if an agent tab is for a background agent
   * Uses $workspaceAgents$ for reactive updates when session metadata changes
   */
  function isBackgroundAgent(tab: PanelTab): boolean {
    if (tab.type !== 'agent' || !tab.agentId) return false;
    const agent = $workspaceAgents$.find((a) => a.id === tab.agentId);
    return !!(agent?.isBackground || (agent?.metadata as any)?.isBackground);
  }

  /**
   * Get the specialist display name for an agent tab
   * Uses $workspaceAgents$ for reactive updates when session metadata changes
   * Uses unified specialist lookup that includes built-in, custom, AND team specialists
   */
  function getAgentSpecialist(tab: PanelTab): string | null {
    if (tab.type !== 'agent' || !tab.agentId) return null;
    const agent = $workspaceAgents$.find((a) => a.id === tab.agentId);
    const specialistId = agent?.metadata?.specialist || (agent as any)?.agentMetadata?.specialist;
    if (!specialistId) return null;
    // Use unified specialist lookup from store (includes team specialists like product-voice, dev-partner)
    return selectSpecialistName.select(getReduxStore().getState(), specialistId);
  }

  /**
   * Get the avatar state for an agent tab.
   * Uses centralized getAvatarState to properly check isStreaming, isProcessing,
   * isResponding flags in addition to status for consistent behavior across the app.
   */
  function getAgentAvatarState(tab: PanelTab): AvatarState {
    if (tab.type !== 'agent' || !tab.agentId) return 'idle';
    const agent = $workspaceAgents$.find((a) => a.id === tab.agentId);
    if (!agent) return 'idle';

    // Use centralized getAvatarState for consistent state determination
    return getAvatarState(
      {
        isStreaming: agent.isStreaming,
        isProcessing: agent.isProcessing,
        isResponding: agent.isResponding,
        status: agent.status,
      },
      {
        hasPermissionRequest: $allPermissionRequests.some((r) => r.sessionId === tab.agentId) ,
      },
    );
  }

  /**
   * Get the specialist ID for an agent tab (for avatar overlay)
   * Uses $workspaceAgents$ for reactive updates when session metadata changes
   * Returns any specialist ID (team coordinators included), or null if no specialist
   */
  function getAgentSpecialistType(tab: PanelTab): string | null {
    if (tab.type !== 'agent' || !tab.agentId) return null;
    const agent = $workspaceAgents$.find((a) => a.id === tab.agentId);
    const specialistId = agent?.metadata?.specialist || (agent as any)?.agentMetadata?.specialist;
    return specialistId || null;
  }



  /**
   * Get the full file path relative to workspace root, for display in header
   */
  function getTabPath(tab: PanelTab): string | null {
    const path = tab.filePath ?? tab.diffPath;
    if (!path) return null;

    // Get workspace to make path relative
    const workspace = selectWorkspaceById.select(getReduxStore().getState(), workspaceId);
    const workspacePath = workspace?.worktreePath || workspace?.repositoryPath || '';

    // Make relative to workspace (with directory boundary check)
    if (workspacePath) {
      const relativePath = stripWorkspacePrefix(path, workspacePath);
      if (relativePath !== path) return relativePath;
    }

    return path;
  }

  function handleTabClick(tabId: string) {
    onTabClick?.(tabId);
  }

  function handleTabClose(e: MouseEvent, tabId: string) {
    e.stopPropagation();
    onTabClose?.(tabId);
  }

  function handleTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    contextMenuTab = { tabId, x: e.clientX, y: e.clientY };
  }

  function closeContextMenu() {
    contextMenuTab = null;
  }

  // ============================================================================
  // Context menu action helpers
  // ============================================================================

  /**
   * Get the absolute file path for a tab (file or diff)
   */
  function getTabAbsolutePath(tab: PanelTab): string | null {
    return tab.filePath ?? tab.diffPath ?? null;
  }

  /**
   * Copy the relative path of a file/diff tab to the clipboard
   */
  async function copyRelativePath(tab: PanelTab) {
    const relativePath = getTabPath(tab);
    if (!relativePath) return;
    try {
      await navigator.clipboard.writeText(toNativePath(relativePath));
      toast.success('Path copied to clipboard');
    } catch {
      toast.error('Failed to copy path');
    }
  }

  /**
   * Copy the absolute path of a file/diff tab to the clipboard
   */
  async function copyAbsolutePath(tab: PanelTab) {
    const absolutePath = getTabAbsolutePath(tab);
    if (!absolutePath) return;
    try {
      await navigator.clipboard.writeText(toNativePath(absolutePath));
      toast.success('Absolute path copied to clipboard');
    } catch {
      toast.error('Failed to copy path');
    }
  }

  /**
   * Copy just the filename (no directory) to the clipboard
   */
  async function copyFileName(tab: PanelTab) {
    const path = tab.filePath ?? tab.diffPath;
    if (!path) return;
    const fileName = path.split(/[/\\]/).pop() || path;
    try {
      await navigator.clipboard.writeText(fileName);
      toast.success('Filename copied to clipboard');
    } catch {
      toast.error('Failed to copy filename');
    }
  }

  /**
   * Reveal a file in the system file manager (Finder on macOS)
   */
  async function revealInFinder(tab: PanelTab) {
    const absolutePath = getTabAbsolutePath(tab);
    if (!absolutePath) return;
    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch {
      toast.error(`Failed to reveal in ${fileManagerName}`);
    }
  }

  // ============================================================================
  // Agent session file path helpers
  // ============================================================================

  /**
   * Get the absolute file path for an agent session's JSON file on disk.
   * Uses the workspace:get-root IPC to resolve the full path.
   */
  async function getAgentSessionAbsolutePath(tab: PanelTab): Promise<string | null> {
    if (!tab.agentId) return null;
    const wsId = tab.workspaceId || workspaceId;
    if (!wsId) return null;
    try {
      const workspaceRoot = await invoke<string>('workspace:get-root', { workspaceId: wsId });
      if (!workspaceRoot) return null;
      return `${workspaceRoot}/.workspace/agents/${tab.agentId}.json`;
    } catch {
      return null;
    }
  }

  /**
   * Copy the relative path of an agent session file (relative to workspace root)
   */
  async function copyAgentRelativePath(tab: PanelTab) {
    const relativePath = `.workspace/agents/${tab.agentId}.json`;
    try {
      await navigator.clipboard.writeText(toNativePath(relativePath));
      toast.success('Path copied to clipboard');
    } catch {
      toast.error('Failed to copy path');
    }
  }

  /**
   * Copy the absolute path of an agent session file
   */
  async function copyAgentAbsolutePath(tab: PanelTab) {
    const absolutePath = await getAgentSessionAbsolutePath(tab);
    if (!absolutePath) {
      toast.error('Could not resolve agent file path');
      return;
    }
    try {
      await navigator.clipboard.writeText(toNativePath(absolutePath));
      toast.success('Absolute path copied to clipboard');
    } catch {
      toast.error('Failed to copy path');
    }
  }

  /**
   * Copy just the filename of an agent session file
   */
  async function copyAgentFileName(tab: PanelTab) {
    const fileName = `${tab.agentId}.json`;
    try {
      await navigator.clipboard.writeText(fileName);
      toast.success('Filename copied to clipboard');
    } catch {
      toast.error('Failed to copy filename');
    }
  }

  /**
   * Reveal an agent session file in the system file manager (Finder on macOS)
   */
  async function revealAgentInFinder(tab: PanelTab) {
    const absolutePath = await getAgentSessionAbsolutePath(tab);
    if (!absolutePath) {
      toast.error('Could not resolve agent file path');
      return;
    }
    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch {
      toast.error(`Failed to reveal in ${fileManagerName}`);
    }
  }

  // ============================================================================
  // Note file path helpers
  // ============================================================================

  /**
   * Get the absolute file path for a note's .md file on disk.
   */
  async function getNoteAbsolutePath(tab: PanelTab): Promise<string | null> {
    if (!tab.noteId) return null;
    const wsId = tab.workspaceId || workspaceId;
    if (!wsId) return null;
    try {
      const workspaceRoot = await invoke<string>('workspace:get-root', { workspaceId: wsId });
      if (!workspaceRoot) return null;
      return `${workspaceRoot}/.workspace/notes/${tab.noteId}.md`;
    } catch {
      return null;
    }
  }

  /**
   * Copy the relative path of a note file (relative to workspace root)
   */
  async function copyNoteRelativePath(tab: PanelTab) {
    const relativePath = `.workspace/notes/${tab.noteId}.md`;
    try {
      await navigator.clipboard.writeText(toNativePath(relativePath));
      toast.success('Path copied to clipboard');
    } catch {
      toast.error('Failed to copy path');
    }
  }

  /**
   * Copy the absolute path of a note file
   */
  async function copyNoteAbsolutePath(tab: PanelTab) {
    const absolutePath = await getNoteAbsolutePath(tab);
    if (!absolutePath) {
      toast.error('Could not resolve note file path');
      return;
    }
    try {
      await navigator.clipboard.writeText(toNativePath(absolutePath));
      toast.success('Absolute path copied to clipboard');
    } catch {
      toast.error('Failed to copy path');
    }
  }

  /**
   * Copy just the filename of a note file
   */
  async function copyNoteFileName(tab: PanelTab) {
    const fileName = `${tab.noteId}.md`;
    try {
      await navigator.clipboard.writeText(fileName);
      toast.success('Filename copied to clipboard');
    } catch {
      toast.error('Failed to copy filename');
    }
  }

  /**
   * Reveal a note file in the system file manager (Finder on macOS)
   */
  async function revealNoteInFinder(tab: PanelTab) {
    const absolutePath = await getNoteAbsolutePath(tab);
    if (!absolutePath) {
      toast.error('Could not resolve note file path');
      return;
    }
    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch {
      toast.error(`Failed to reveal in ${fileManagerName}`);
    }
  }

  /**
   * Copy the browser URL to the clipboard
   */
  async function copyBrowserUrl(tab: PanelTab) {
    if (!tab.browserUrl) return;
    try {
      await navigator.clipboard.writeText(tab.browserUrl);
      toast.success('URL copied to clipboard');
    } catch {
      toast.error('Failed to copy URL');
    }
  }

  /**
   * Open a browser tab's URL in the system default browser
   */
  async function openInExternalBrowser(tab: PanelTab) {
    if (!tab.browserUrl) return;
    try {
      await invoke('shell:openExternal', { url: tab.browserUrl });
    } catch {
      toast.error('Failed to open in browser');
    }
  }

  /**
   * Copy the tab title to the clipboard (useful for agents, notes, etc.)
   */
  async function copyTabTitle(tab: PanelTab) {
    const title = getTabTitle(tab);
    try {
      await navigator.clipboard.writeText(title);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  }

  // Custom MIME type to prevent editors from interpreting drop as text paste
  const TAB_DRAG_MIME = 'application/x-panel-tab';

  // Drag state
  let draggedTabId = $state<string | null>(null);
  let dragOverTabId = $state<string | null>(null);
  let dragOverPosition = $state<'before' | 'after' | null>(null);
  let dragOverContainer = $state<boolean>(false);

  // Scroll container ref for auto-scrolling to active tab
  let tabsContainerRef = $state<HTMLDivElement | null>(null);

  // Tab bar ref for wheel scrolling
  let tabBarRef = $state<HTMLDivElement | null>(null);

  // Handle wheel events to allow vertical scroll to scroll tabs horizontally
  function handleWheel(e: WheelEvent) {
    if (!tabsContainerRef) return;

    // Use deltaY for vertical scroll (most common), or deltaX for horizontal scroll
    // This allows vertical mouse wheel scrolling to scroll tabs horizontally
    const delta = e.deltaY || e.deltaX;

    // Only prevent default and scroll if there's something to scroll
    if (delta !== 0) {
      e.preventDefault();
      tabsContainerRef.scrollLeft += delta;
    }
  }

  // Attach wheel event listener when tabsContainerRef becomes available
  $effect(() => {
    if (tabsContainerRef) {
      tabsContainerRef.addEventListener('wheel', handleWheel, { passive: false });

      return () => {
        tabsContainerRef?.removeEventListener('wheel', handleWheel);
      };
    }
  });

  // Scroll active tab into view
  function scrollActiveTabIntoView() {
    if (!tabsContainerRef || !activeTabId) return;

    const activeTabElement = tabsContainerRef.querySelector(
      `[data-tab-id="${activeTabId}"]`,
    ) as HTMLElement | null;

    if (activeTabElement) {
      activeTabElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }

  // Scroll to active tab on mount and when active tab changes
  $effect(() => {
    if (activeTabId && tabsContainerRef) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        scrollActiveTabIntoView();
      });
    }
  });

  // Drag and drop handlers
  function handleDragStart(e: DragEvent, tabId: string) {
    if (!e.dataTransfer) return;
    draggedTabId = tabId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify({ tabId, panelId }));

    // Update global drag state
    dispatch(startDrag());

    // Make the dragged element semi-transparent
    const target = e.target as HTMLElement;
    requestAnimationFrame(() => {
      target.style.opacity = '0.5';
    });
  }

  function handleDragEnd(e: DragEvent) {
    const target = e.target as HTMLElement;
    target.style.opacity = '';
    draggedTabId = null;
    dragOverTabId = null;
    dragOverPosition = null;
    dragOverContainer = false;

    // Update global drag state - this ensures all panels reset their drop zone state
    dispatch(endDrag());
  }

  // Check if a tab drag is happening (from this panel or another)
  function isTabDrag(e: DragEvent): boolean {
    // Check local state first (dragging from this panel)
    if (draggedTabId) return true;
    // Check global state (dragging from any panel)
    if ($isDragging) return true;
    // Check dataTransfer types
    return e.dataTransfer?.types.includes(TAB_DRAG_MIME) ?? false;
  }

  function handleDragOver(e: DragEvent, tabId: string, tabElement: HTMLElement) {
    if (!isTabDrag(e)) return;
    // Don't show indicator on the tab being dragged
    if (draggedTabId === tabId) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }

    // Determine if dropping before or after
    const rect = tabElement.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const isAfterMidpoint = e.clientX >= midpoint;

    // Get tab index
    const tabIndex = tabs.findIndex((t) => t.id === tabId);

    // Normalize "after" to "before next tab" to avoid duplicate indicators
    // Only the last tab can have an "after" indicator
    if (isAfterMidpoint && tabIndex < tabs.length - 1) {
      // Instead of "after this tab", use "before next tab"
      dragOverTabId = tabs[tabIndex + 1].id;
      dragOverPosition = 'before';
    } else {
      dragOverTabId = tabId;
      dragOverPosition = isAfterMidpoint ? 'after' : 'before';
    }
  }

  function handleDragLeave() {
    dragOverTabId = null;
    dragOverPosition = null;
  }

  function handleDrop(e: DragEvent, targetTabId: string) {
    e.preventDefault();
    e.stopPropagation();

    // Capture drop position before any state changes
    const dropPosition = dragOverPosition;
    const dropTabId = dragOverTabId;

    // Parse drag data for cross-panel drops
    const data = e.dataTransfer?.getData(TAB_DRAG_MIME);
    if (!data) {
      draggedTabId = null;
      dragOverTabId = null;
      dragOverPosition = null;
      dragOverContainer = false;
      return;
    }

    try {
      const { tabId: sourceTabId, panelId: fromPanelId } = JSON.parse(data);

      if (sourceTabId === targetTabId) {
        draggedTabId = null;
        dragOverTabId = null;
        dragOverPosition = null;
        dragOverContainer = false;
        return;
      }

      // Calculate target insert index - use captured values or fallback to the targetTabId
      const effectiveTabId = dropTabId || targetTabId;
      let targetIndex = tabs.findIndex((t) => t.id === effectiveTabId);
      if (targetIndex === -1) {
        draggedTabId = null;
        dragOverTabId = null;
        dragOverPosition = null;
        dragOverContainer = false;
        return;
      }

      // Adjust for drop position
      if (dropPosition === 'after') {
        targetIndex = targetIndex + 1;
      }

      // Same panel reorder
      if (fromPanelId === panelId) {
        const fromIndex = tabs.findIndex((t) => t.id === sourceTabId);
        if (fromIndex === -1) {
          draggedTabId = null;
          dragOverTabId = null;
          dragOverPosition = null;
          dragOverContainer = false;
          return;
        }

        // Adjust for removal when moving forward
        let toIndex = targetIndex;
        if (fromIndex < toIndex) {
          toIndex = toIndex - 1;
        }

        onTabReorder?.(fromIndex, toIndex);
      } else {
        // Cross-panel drop: move tab to this panel at specific position
        onTabMoveToPanel?.(sourceTabId, fromPanelId, targetIndex);
      }
    } catch {
      // Invalid data
    }

    draggedTabId = null;
    dragOverTabId = null;
    dragOverPosition = null;
    dragOverContainer = false;
  }

  // Container-level drag handlers for dropping into empty space
  function handleContainerDragOver(e: DragEvent) {
    if (!isTabDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    dragOverContainer = true;
  }

  function handleContainerDragLeave(e: DragEvent) {
    // Only reset if leaving the container entirely (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!tabsContainerRef?.contains(relatedTarget)) {
      dragOverContainer = false;
      dragOverTabId = null;
      dragOverPosition = null;
    }
  }

  function handleContainerDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Capture state before any changes
    const dropTabId = dragOverTabId;
    const dropPosition = dragOverPosition;

    // Parse drag data
    const data = e.dataTransfer?.getData(TAB_DRAG_MIME);
    if (!data) {
      draggedTabId = null;
      dragOverTabId = null;
      dragOverPosition = null;
      dragOverContainer = false;
      return;
    }

    try {
      const { tabId: sourceTabId, panelId: fromPanelId } = JSON.parse(data);

      // Calculate target index based on captured dragOverTabId and dragOverPosition
      let targetIndex: number | undefined;
      if (dropTabId) {
        const tabIndex = tabs.findIndex((t) => t.id === dropTabId);
        if (tabIndex !== -1) {
          targetIndex = dropPosition === 'after' ? tabIndex + 1 : tabIndex;
        }
      }

      // Same panel: reorder
      if (fromPanelId === panelId) {
        const fromIndex = tabs.findIndex((t) => t.id === sourceTabId);
        if (fromIndex === -1) {
          draggedTabId = null;
          dragOverTabId = null;
          dragOverPosition = null;
          dragOverContainer = false;
          return;
        }

        let toIndex = targetIndex ?? tabs.length - 1;

        // Adjust for removal when moving forward
        if (fromIndex < toIndex) {
          toIndex = toIndex - 1;
        }

        if (fromIndex !== toIndex) {
          onTabReorder?.(fromIndex, toIndex);
        }
      } else {
        // Cross-panel drop: move tab to this panel
        onTabMoveToPanel?.(sourceTabId, fromPanelId, targetIndex);
      }
    } catch {
      // Invalid data
    }

    draggedTabId = null;
    dragOverTabId = null;
    dragOverPosition = null;
    dragOverContainer = false;
  }

  // Tab type icons mapping using registry
  function getTabIcon(type: PanelTab['type']): IconDefinition {
    return tabTypeRegistry.getIcon(type) ?? faFile;
  }

  // Get category label for tab type using registry
  function getCategoryLabel(type: PanelTab['type']): string {
    return tabTypeRegistry.getCategoryLabel(type);
  }

  // Get the currently active tab
  const activeTab = $derived(tabs.find((t) => t.id === activeTabId) || tabs[0] || null);

  // Get category info for active tab
  const categoryLabel = $derived(activeTab ? getCategoryLabel(activeTab.type) : 'Panel');

  /**
   * "Delegated by" parent-agent attribution for the active agent tab.
   *
   * The parent agent ID is mirrored into a writable store so selectAgentById
   * re-evaluates reactively — the label appears as soon as the parent session
   * lands in Redux (e.g. after a workspace switch loads sessions), without
   * requiring any user interaction.
   */
  const activeAgentParentId = $derived.by(() => {
    if (!activeTab || activeTab.type !== 'agent' || !activeTab.agentId) return null;
    const agent = $workspaceAgents$.find((a) => a.id === activeTab.agentId);
    return (agent?.metadata?.createdByAgentId as string | undefined) ?? null;
  });
  const activeAgentParentIdStore = writable<string>('');
  $effect(() => {
    activeAgentParentIdStore.set(activeAgentParentId ?? '');
  });
  const activeAgentParent$ = selectAgentById(activeAgentParentIdStore);
  const activeAgentDelegatedByName = $derived(
    activeAgentParentId ? $activeAgentParent$?.name || null : null,
  );

  /**
   * Check if a tab can be renamed.
   * Notes, agents, and files can be renamed.
   * Spec notes cannot be renamed.
   */
  function isTabRenameable(tab: PanelTab): boolean {
    // Spec notes cannot be renamed
    if (tab.type === 'note' && tab.noteId && isSpecNote(tab.noteId)) {
      return false;
    }
    // Notes, agents, and files can be renamed
    return tab.type === 'note' || tab.type === 'agent' || tab.type === 'file';
  }

  /**
   * Handle tab rename from EditableName component
   */
  function handleTabRename(tab: PanelTab, newName: string) {
    if (onTabRename && isTabRenameable(tab)) {
      onTabRename(tab, newName);
    }
  }

  /**
   * Start inline renaming for a tab (triggered by double-click)
   */
  async function startInlineRename(tab: PanelTab) {
    if (!isTabRenameable(tab) || !onTabRename) return;
    renamingTabId = tab.id;
    renameValue = getTabTitle(tab);
    await tick();
    if (renameInputRef) {
      renameInputRef.focus();
      renameInputRef.select();
    }
  }

  /**
   * Save the inline rename
   */
  function saveInlineRename() {
    if (!renamingTabId) return;
    const tab = tabs.find((t) => t.id === renamingTabId);
    if (tab) {
      const trimmed = renameValue.trim();
      const currentTitle = getTabTitle(tab);
      if (trimmed && trimmed !== currentTitle) {
        handleTabRename(tab, trimmed);
      }
    }
    renamingTabId = null;
  }

  /**
   * Cancel the inline rename
   */
  function cancelInlineRename() {
    renamingTabId = null;
    renameValue = '';
  }

  /**
   * Handle double-click on a tab.
   * If the tab was already the active tab before the click sequence, toggle panel
   * expand (VS Code-like "more room" — 85/15 split). Otherwise, start inline rename.
   */
  function handleTabDoubleClick(e: MouseEvent, tab: PanelTab) {
    e.preventDefault();
    e.stopPropagation();

    const wasAlreadyActive =
      tabActiveBeforeMouseDown?.tabId === tab.id && tabActiveBeforeMouseDown.wasActive;
    tabActiveBeforeMouseDown = null;

    if (wasAlreadyActive) {
      const layoutManager = getLayoutManager?.();
      if (layoutManager) {
        layoutManager.toggleExpandPanel(panelId);
      }
    } else {
      startInlineRename(tab);
    }
  }

  // Check if a tab type can be located in the sidebar
  function canLocateInSidebar(tab: PanelTab): boolean {
    return ['note', 'file', 'agent', 'terminal'].includes(tab.type);
  }

  // Get the sidebar tab ID for a panel tab type using registry
  function getSidebarTabId(type: PanelTab['type']): string | null {
    return tabTypeRegistry.getSidebarTabId(type);
  }

  // Handle locate in sidebar click
  function handleLocateInSidebar(e: MouseEvent, tab: PanelTab) {
    e.stopPropagation();

    const sidebarTabId = getSidebarTabId(tab.type);
    if (!sidebarTabId) return;

    // Request the sidebar to locate this item via Redux
    dispatch(
      locateItemInSidebarRequested(workspaceId, {
        sidebarTabId,
        type: tab.type,
        noteId: tab.noteId,
        filePath: tab.filePath,
        agentId: tab.agentId,
        terminalId: tab.terminalId,
      }),
    );
  }
</script>

<!-- Tab bar + Header wrapper -->
<div class="panel-tab-wrapper flex flex-col">
  <!-- Tab bar (traditional tabs) -->
  <div
    bind:this={tabBarRef}
    class={cn(
      'panel-tab-bar group/tabbar relative flex items-center h-[var(--panel-header-height)]',
      tabs.length
        ? 'bg-[color-mix(in_srgb,_var(--color-background)_30%,_var(--color-muted)_70%)] dark:bg-[color-mix(in_srgb,_var(--color-background)_90%,_var(--color-sidebar)_10%)]'
        : 'bg-transparent',
    )}
  >
    <div class="absolute inset-x-0 bottom-0 z-0"></div>

    <!-- Tabs (scrollable container) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={tabsContainerRef}
      class="relative flex-1 flex items-center z-10 min-w-0 overflow-x-auto scrollbar-none"
      ondragover={handleContainerDragOver}
      ondragleave={handleContainerDragLeave}
      ondrop={handleContainerDrop}
    >
      {#each tabs as tab, index (tab.id)}
        {@const isActive = tab.id === activeTabId}
        {@const shortcutKey = index < 9 ? `⌘${index + 1}` : null}
        {@const isDragOver = dragOverTabId === tab.id}
        {@const tabTitle = getTabTitle(tab)}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <Tooltip
          content={shortcutKey && isFocused ? `${tabTitle} (${shortcutKey})` : tabTitle}
          side="bottom"
          delayDuration={500}
        >
          <div
            data-tab-id={tab.id}
            class={cn(
              'panel-tab group cursor-pointer relative',
              isActive
                ? isFocused
                  ? 'text-foreground bg-[color-mix(in_srgb,_var(--color-background)_90%,_var(--color-muted)_10%)] dark:bg-[color-mix(in_srgb,_var(--color-background)_85%,_var(--color-muted-foreground)_15%)]'
                  : 'text-foreground bg-[color-mix(in_srgb,_var(--color-background)_50%,_var(--color-muted)_50%)] dark:bg-[color-mix(in_srgb,_var(--color-background)_95%,_var(--color-muted-foreground)_5%)]'
                : isFocused
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'text-ghost',
              draggedTabId === tab.id && 'opacity-50',
            )}
            onclick={() => handleTabClick(tab.id)}
            onmousedown={() => {
              // Capture whether this tab was already active *before* the click activates it.
              // Only record on the first mousedown of a potential double-click (within 500ms window).
              const now = Date.now();
              if (!tabActiveBeforeMouseDown || now - tabActiveBeforeMouseDown.timestamp > 500) {
                tabActiveBeforeMouseDown = {
                  tabId: tab.id,
                  wasActive: tab.id === activeTabId,
                  timestamp: now,
                };
              }
              handleTabClick(tab.id);
            }}
            ondblclick={(e) => handleTabDoubleClick(e, tab)}
            onkeydown={(e) => e.key === 'Enter' && handleTabClick(tab.id)}
            oncontextmenu={(e) => handleTabContextMenu(e, tab.id)}
            onauxclick={(e) => {
              // Middle mouse button (scroll wheel click) to close tab
              if (e.button === 1 && tab.closable !== false) {
                e.preventDefault();
                e.stopPropagation();
                onTabClose?.(tab.id);
              }
            }}
            draggable={renamingTabId !== tab.id}
            ondragstart={(e) => handleDragStart(e, tab.id)}
            ondragend={handleDragEnd}
            ondragover={(e) => handleDragOver(e, tab.id, e.currentTarget as HTMLElement)}
            ondragleave={handleDragLeave}
            ondrop={(e) => handleDrop(e, tab.id)}
            role="tab"
            tabindex="0"
            aria-selected={isActive}
          >
            <!-- Drop indicator before -->
            {#if isDragOver && dragOverPosition === 'before'}
              <div class="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-full z-10"></div>
            {/if}
            <div
              class={cn('flex items-center gap-1.5 pl-2.5 pr-2 py-1 h-9 text-ui whitespace-nowrap')}
            >
              {#if tab.type === 'agent' && tab.agentId}
                <AugieAvatarWithState
                  agentId={tab.agentId}
                  size={16}
                  state={getAgentAvatarState(tab)}
                  specialist={getAgentSpecialistType(tab) as
                    | import('$lib/constants/specialists').BuiltinSpecialistId
                    | null}
                  class="shrink-0"
                />
              {:else if tab.faviconUrl}
                <img
                  src={tab.faviconUrl}
                  alt=""
                  width="16"
                  height="16"
                  class="shrink-0 rounded-sm"
                  onerror={(e) => {
                    // On favicon load failure, hide the img so the fallback icon shows
                    const target = e.currentTarget as HTMLImageElement;
                    target.style.display = 'none';
                    // Show the sibling fallback icon
                    const fallback = target.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = '';
                  }}
                />
                <!-- Fallback icon, hidden by default, shown if favicon fails to load -->
                <span style="display: none;">
                  <Fa icon={getTabIcon(tab.type)} size={16} class="tab-icon shrink-0 opacity-50" />
                </span>
              {:else}
                <Fa icon={getTabIcon(tab.type)} size={16} class="tab-icon shrink-0 opacity-50" />
              {/if}
              {#if renamingTabId === tab.id}
                <!-- Inline rename input -->
                <input
                  bind:this={renameInputRef}
                  bind:value={renameValue}
                  class="tab-title font-medium bg-transparent border-none outline-none focus:ring-0! focus:outline-none! px-0 text-inherit max-w-24"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveInlineRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelInlineRename();
                    }
                  }}
                  onblur={saveInlineRename}
                  onclick={(e) => e.stopPropagation()}
                  ondblclick={(e) => e.stopPropagation()}
                />
              {:else}
                <span class="tab-title font-medium truncate max-w-24">{tabTitle}</span>
              {/if}

              {#if isBackgroundAgent(tab)}
                <span
                  class="text-ui font-medium text-muted-foreground bg-muted px-1 py-0.5 rounded uppercase tracking-wider"
                  >BG</span
                >
              {/if}

              {#if tab.hasUnsavedChanges}
                <span class="unsaved-dot w-1.5 h-1.5 rounded-full bg-primary"></span>
              {/if}

              {#if tab.closable}
                <button
                  class={cn(
                    'tab-close ml-1 p-0.5 rounded transition-opacity cursor-pointer',
                    isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60',
                  )}
                  onclick={(e) => handleTabClose(e, tab.id)}
                  aria-label="Close tab"
                >
                  <Fa icon={faXmark} size="xs" />
                </button>
              {/if}
            </div>
            <!-- Drop indicator after: only show for last tab -->
            {#if isDragOver && dragOverPosition === 'after' && index === tabs.length - 1}
              <div class="absolute right-0 top-1 bottom-1 w-0.5 bg-primary rounded-full z-10"></div>
            {/if}
          </div>
        </Tooltip>
      {/each}

      <!-- Drop zone indicator for end of tab bar -->
      {#if (draggedTabId || $isDragging) && dragOverContainer && !dragOverTabId}
        <div class="flex items-center h-full px-1">
          <div class="w-0.5 h-5 bg-primary rounded-full"></div>
        </div>
      {/if}

      <!-- Add new tab button (inside scrollable area, sticky to right when overflowing) -->
      {#if hasCreateActions && tabs.length > 0}
        <div
          class="shrink-0 flex items-center self-stretch pl-1 pr-1 transition-opacity sticky right-0 bg-[color-mix(in_srgb,_var(--color-background)_30%,_var(--color-muted)_70%)] dark:bg-[color-mix(in_srgb,_var(--color-background)_90%,_var(--color-sidebar)_10%)]"
        >
          <DropdownMenu align="start" side="bottom">
            {#snippet trigger({ toggle }: { toggle: () => void })}
              <Tooltip content="New..." side="bottom" delayDuration={300} class="flex">
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="opacity-30 group-hover/tabbar:opacity-100"
                  onclick={toggle}
                  aria-label="Create new item"
                >
                  <Fa icon={faPlus} size="xs" />
                </Button>
              </Tooltip>
            {/snippet}
            {#snippet content({ close }: { close: () => void })}
              <div class="flex flex-col min-w-35">
                {#if onCreateAgentWithSpecialist}
                  <!-- Blank Agent option -->
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer rounded-sm transition-colors"
                    onclick={() => {
                      onCreateAgentWithSpecialist(null);
                      close();
                    }}
                  >
                    <AuggieAvatar faceSeed="blank" colorSeed="blank" size={16} />
                    <span>Blank Agent</span>
                  </button>
                  <!-- Specialist options -->
                  {#each visibleSpecialists as specialist (specialist.id)}
                    <button
                      class="flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer rounded-sm transition-colors"
                      onclick={() => {
                        onCreateAgentWithSpecialist(specialist.id);
                        close();
                      }}
                    >
                      <AuggieAvatar faceSeed="blank" colorSeed="blank" size={16} specialist={specialist.id} />
                      <span>{specialist.name}</span>
                    </button>
                  {/each}
                  <!-- Manage specialists link -->
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer rounded-sm transition-colors text-subtle border-t border-border mt-0.5 pt-1.5"
                    onclick={async () => {
                      await navigateToSettings({ tab: 'agents' });
                      close();
                    }}
                  >
                    <Fa icon={faPlus} size="xs" class="text-ghost" />
                    <span>Manage specialists</span>
                  </button>
                {:else if onCreateAgent}
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer rounded-sm transition-colors"
                    onclick={() => {
                      onCreateAgent();
                      close();
                    }}
                  >
                    <Fa icon={faRobot} size="xs" class="text-ghost" />
                    <span>New Agent</span>
                  </button>
                {/if}
                {#if onCreateNote}
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer rounded-sm transition-colors"
                    onclick={() => {
                      onCreateNote();
                      close();
                    }}
                  >
                    <Fa icon={faNote} size="xs" class="text-ghost" />
                    <span>New Note</span>
                  </button>
                {/if}
                {#if onCreateTerminal}
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer rounded-sm transition-colors"
                    onclick={() => {
                      onCreateTerminal();
                      close();
                    }}
                  >
                    <Fa icon={faTerminal} size="xs" class="text-ghost" />
                    <span>New Terminal</span>
                  </button>
                {/if}
                {#if onOpenBrowser}
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer rounded-sm transition-colors"
                    onclick={() => {
                      onOpenBrowser();
                      close();
                    }}
                  >
                    <Fa icon={faGlobe} size="xs" class="text-ghost" />
                    <span>New Browser</span>
                  </button>
                {/if}
              </div>
            {/snippet}
          </DropdownMenu>
        </div>
      {/if}
    </div>

    <!-- Panel Actions (on tab bar) -->
    <div class="shrink-0 h-full flex items-center">
      <div
        class="panel-actions flex items-center gap-0.5 px-1 opacity-30 group-hover/tabbar:opacity-100 transition-opacity z-20"
      >
        <!-- Split panel buttons -->
        <Tooltip content="Split right (⌘\)" side="bottom" delayDuration={300}>
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={() => onSplitHorizontal?.()}
            aria-label="Split panel right"
          >
            <svg
              class="text-subtle overflow-visible w-2.5!"
              viewBox="0 0 1 1"
              fill="none"
              stroke="currentColor"
              stroke-width="0.8"
            >
              <rect
                width="0.5"
                height="1"
                rx="0.03"
                stroke-width="0.8"
                vector-effect="non-scaling-stroke"
              />
              <rect
                x="0.5"
                width="0.5"
                height="1"
                rx="0.03"
                stroke-width="0.8"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </Button>
        </Tooltip>
        <Tooltip content="Split down (⌘⇧\)" side="bottom" delayDuration={300}>
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={() => onSplitVertical?.()}
            aria-label="Split panel down"
          >
            <svg
              class="text-subtle overflow-visible w-2.5!"
              viewBox="0 0 1 1"
              fill="none"
              stroke="currentColor"
              stroke-width="0.8"
            >
              <rect
                width="1"
                height="0.5"
                rx="0.03"
                stroke-width="0.8"
                vector-effect="non-scaling-stroke"
              />
              <rect
                y="0.5"
                width="1"
                height="0.5"
                rx="0.03"
                stroke-width="0.8"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </Button>
        </Tooltip>

        {#if onClosePanel}
          <Tooltip content="Close panel" side="bottom" delayDuration={300}>
            <Button
              variant="ghost-light"
              size="icon-xs"
              onclick={onClosePanel}
              aria-label="Close panel"
            >
              <Fa icon={faXmark} size="xs" />
            </Button>
          </Tooltip>
        {/if}
      </div>
    </div>
  </div>

  <!-- Compact header bar (breadcrumb style) -->
  {#if activeTab}
    {@const activeTabPath = getTabPath(activeTab)}
    {@const hidesBreadcrumb = activeTab.type === 'changes'}
    <div
      class={cn(
        'panel-header group/header relative flex items-center h-[var(--panel-header-height)] px-2.5 border-b border-border/20 dark:border-transparent',
        isFocused
          ? 'focused bg-[color-mix(in_srgb,_var(--color-background)_90%,_var(--color-muted)_10%)] dark:bg-[color-mix(in_srgb,_var(--color-background)_85%,_var(--color-muted-foreground)_15%)]'
          : 'bg-[color-mix(in_srgb,_var(--color-background)_50%,_var(--color-muted)_50%)] dark:bg-[color-mix(in_srgb,_var(--color-background)_95%,_var(--color-muted-foreground)_5%)]',
      )}
    >
      <!-- Left: Category breadcrumb + Path (hidden for changes tabs which have their own header) -->
      {#if !hidesBreadcrumb}
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <!-- Category (muted, uppercase) -->
          <span
            class="flex items-center gap-2 text-ui font-medium tracking-wider uppercase shrink-0 {isFocused
              ? 'text-muted-foreground'
              : 'text-subtle'}"
          >
            <!-- <Fa icon={categoryIcon} class="opacity-50" size={16} /> -->
            <span>{categoryLabel}</span>
          </span>
          <span class="text-ghost text-xs">/</span>

          <div class="flex items-baseline gap-2 min-w-0 shrink">
            <!-- Title - editable for notes, agents, and files -->
            {#if isTabRenameable(activeTab) && onTabRename}
              <EditableName
                value={getTabTitle(activeTab)}
                onSave={(newName) => handleTabRename(activeTab, newName)}
                textClass="text-sm shrink font-medium {isFocused
                  ? 'text-foreground'
                  : 'text-subtle'}"
                title="Click to rename"
                maxWidth={200}
              />
            {:else}
              <span class="text-sm truncate shrink {isFocused ? 'text-foreground' : 'text-subtle'}">
                {getTabTitle(activeTab)}
              </span>
            {/if}

            <!-- Specialist and Delegated by (for agent tabs) -->
            {#if activeTab.type === 'agent'}
              {@const specialist = getAgentSpecialist(activeTab)}
              {@const delegatedBy = activeAgentDelegatedByName}
              {#if specialist || delegatedBy}
                <span
                  class="text-xs shrink-5 truncate whitespace-nowrap {isFocused
                    ? 'text-subtle'
                    : 'text-ghost'}"
                >
                  {#if specialist && delegatedBy}
                    {specialist} · Delegated by {delegatedBy}
                  {:else if specialist}
                    {specialist} agent
                  {:else if delegatedBy}
                    Delegated by {delegatedBy}
                  {/if}
                </span>
              {/if}
            {/if}
          </div>

          <!-- Path (for file-based tabs) -->
          {#if activeTabPath}
            {@const lastSlash = activeTabPath.lastIndexOf('/')}
            {@const dirPath = lastSlash > 0 ? activeTabPath.substring(0, lastSlash) : null}
            {#if dirPath}
              <span class="text-xs truncate {isFocused ? 'text-subtle' : 'text-ghost'}">
                {dirPath}
              </span>
            {/if}
          {/if}

          <!-- Commit hash (for diff tabs with committed changes) -->
          {#if activeTab.type === 'diff'}
            {@const change = activeTab.data?.change as { commitHash?: string } | undefined}
            {#if change?.commitHash}
              <span class="text-xs font-mono {isFocused ? 'text-subtle' : 'text-ghost'}">
                @ {change.commitHash.substring(0, 7)}
              </span>
            {/if}
          {/if}
        </div>
      {:else}
        <!-- Spacer for changes tabs -->
        <div class="flex-1"></div>
      {/if}

      <!-- Right: Content actions -->
      <div
        class="flex items-center gap-0.5 shrink-0 transition-opacity duration-150 {isFocused
          ? 'opacity-100'
          : 'opacity-0 pointer-events-none'}"
      >
        {#if contentActions}
          <div class="flex items-center gap-0.5">
            {@render contentActions()}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Context Menu -->
{#if contextMenuTab}
  {@const menuTabId = contextMenuTab.tabId}
  {@const menuX = contextMenuTab.x}
  {@const menuY = contextMenuTab.y}
  {@const contextTab = tabs.find((t) => t.id === menuTabId)}
  <div
    class="fixed inset-0 z-50"
    oncontextmenu={(e) => {
      e.preventDefault();
      closeContextMenu();
    }}
  >
    <button
      type="button"
      class="absolute inset-0 bg-transparent border-0 p-0 cursor-default"
      aria-label="Close context menu"
      onclick={closeContextMenu}
    ></button>
    <div
      class="absolute bg-popover border border-border shadow min-w-40 z-10"
      style="left: {menuX}px; top: {menuY}px;"
    >
      {#if contextTab && canLocateInSidebar(contextTab)}
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={(e) => {
            handleLocateInSidebar(e, contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCrosshairs} size="xs" class="text-ghost" />
          Reveal in Sidebar
        </button>
      {/if}
      <!-- Type-specific actions for file/diff tabs -->
      {#if contextTab && (contextTab.type === 'file' || contextTab.type === 'diff')}
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyRelativePath(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Relative Path
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyAbsolutePath(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Absolute Path
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyFileName(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Filename
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            revealInFinder(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faFolderOpen} size="xs" class="text-ghost" />
          Reveal in {fileManagerName}
        </button>
      {/if}
      <!-- Type-specific actions for browser tabs -->
      {#if contextTab && contextTab.type === 'browser' && contextTab.browserUrl}
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyBrowserUrl(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy URL
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            openInExternalBrowser(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faArrowUpRightFromSquare} size="xs" class="text-ghost" />
          Open in Browser
        </button>
      {/if}
      <!-- Type-specific actions for agent tabs -->
      {#if contextTab && contextTab.type === 'agent'}
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyAgentRelativePath(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Relative Path
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyAgentAbsolutePath(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Absolute Path
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyAgentFileName(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Filename
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            revealAgentInFinder(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faFolderOpen} size="xs" class="text-ghost" />
          Reveal in {fileManagerName}
        </button>
      {/if}
      <!-- Type-specific actions for note tabs -->
      {#if contextTab && contextTab.type === 'note'}
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyNoteRelativePath(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Relative Path
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyNoteAbsolutePath(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Absolute Path
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyNoteFileName(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Filename
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            revealNoteInFinder(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faFolderOpen} size="xs" class="text-ghost" />
          Reveal in {fileManagerName}
        </button>
      {/if}
      <!-- Type-specific actions for terminal tabs -->
      {#if contextTab && contextTab.type === 'terminal'}
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
          onclick={() => {
            copyTabTitle(contextTab);
            closeContextMenu();
          }}
        >
          <Fa icon={faCopy} size="xs" class="text-ghost" />
          Copy Terminal Name
        </button>
      {/if}
      <div class="border-t border-border"></div>
      <!-- Zoom toggle -->
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onZoomToggle?.();
          closeContextMenu();
        }}
      >
        {isZoomed ? 'Unzoom Panel' : 'Zoom Panel'}
        <span class="text-subtle text-xs">⇧⌘↵</span>
      </button>
      <div class="border-t border-border"></div>
      <!-- Split options -->
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onSplitHorizontal?.();
          closeContextMenu();
        }}
      >
        <span class="flex items-center gap-2">
          <svg
            class="text-subtle overflow-visible w-2.5!"
            viewBox="0 0 1 1"
            fill="none"
            stroke="currentColor"
            stroke-width="0.8"
          >
            <rect
              width="0.5"
              height="1"
              rx="0.03"
              stroke-width="0.8"
              vector-effect="non-scaling-stroke"
            />
            <rect
              x="0.5"
              width="0.5"
              height="1"
              rx="0.03"
              stroke-width="0.8"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          Split right
        </span>
        <span class="text-subtle text-xs">⌘\</span>
      </button>
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onSplitVertical?.();
          closeContextMenu();
        }}
      >
        <span class="flex items-center gap-2">
          <svg
            class="text-subtle overflow-visible w-2.5! transform rotate-90"
            viewBox="0 0 1 1"
            fill="none"
            stroke="currentColor"
            stroke-width="0.8"
          >
            <rect
              width="0.5"
              height="1"
              rx="0.03"
              stroke-width="0.8"
              vector-effect="non-scaling-stroke"
            />
            <rect
              x="0.5"
              width="0.5"
              height="1"
              rx="0.03"
              stroke-width="0.8"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          Split down
        </span>
        <span class="text-subtle text-xs">⇧⌘\</span>
      </button>
      <div class="border-t border-border"></div>
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onTabClose?.(menuTabId);
          closeContextMenu();
        }}
      >
        Close
        <span class="text-subtle text-xs">⌘W</span>
      </button>
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onCloseOtherTabs?.(menuTabId);
          closeContextMenu();
        }}
      >
        Close other tabs in panel
        <span class="text-subtle text-xs"></span>
      </button>
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onCloseTabsToRight?.(menuTabId);
          closeContextMenu();
        }}
      >
        Close tabs to the right
        <span class="text-subtle text-xs"></span>
      </button>
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onClosePanel?.();
          closeContextMenu();
        }}
      >
        Close panel
        <span class="text-subtle text-xs"></span>
      </button>
      <button
        class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
        onclick={() => {
          onCloseAllOthersEverywhere?.(menuTabId);
          closeContextMenu();
        }}
      >
        Close all others
        <span class="text-subtle text-xs"></span>
      </button>
    </div>
  </div>
{/if}

<style>
  /* CSS variables for panel tab bar heights */
  .panel-tab-wrapper {
    --panel-header-height: clamp(1.5rem, 2.25rem, 10cqh);
  }
</style>
