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

  import type { PanelTab } from '$features/layout/panel-layout-adapter';
  import { cn } from '$lib/utils';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
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
    faExpand,
    faCompress,
    faTableColumns,
    faGripLines,
    faThumbtack,
    faArrowLeft,
    faArrowRight,
    faCheck,
    faMagnifyingGlass,
  } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { toast } from '$lib/components/ui/toast';
  import { locateItemInSidebarRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import Fa from 'svelte-fa';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { onDestroy, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { startDrag, endDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    reopenClosedTab,
    restorePanelDragLayout,
    setPanelPinned,
    toggleExpandPanel,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectPanelLayoutWorkspace,
    selectRecentlyClosed,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    PANEL_DRAG_MIME,
    clearDraggedPanelState,
    createPanelDragImage,
    getDraggedPanelId,
    setPanelDragSnapshot,
    setDraggedPanelId,
    takePanelDragSnapshot,
  } from './panel-drag';

  import EditableName from '$lib/components/ui/EditableName.svelte';
  import { isSpecNote } from '$shared/constants/notes';

  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import {
    filterPickableSpecialists,
    selectSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import {
    selectIsWorkspaceHostLocal,
    selectWorkspaceById,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { writable } from 'svelte/store';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import {
    type AvatarState,
    getAvatarStateForSession,
  } from '$features/agent/components/agent-avatar/avatar-state';
  import { getAgentAvatarStateLabel } from '$features/agent/components/agent-avatar/avatar-state-label';
  import { selectPermissionRequests } from '$store/renderer/slices/permission/permission-selectors';
  import {
    selectPanelOpenMode,
    selectPanelStackDirection,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import { stripWorkspacePrefix } from '$lib/utils/file-utils';
  import { toNativePath } from '$lib/utils/path-utils';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { createLogger } from '$lib/utils/client-logger';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import type { PanelHeaderActions } from './panel-header-context.svelte';
  import ResourceIconTile from '$lib/components/shared/ResourceIconTile.svelte';
  import { getResourceIconKind, RESOURCE_ICON_BY_KIND } from '$lib/components/shared/resource-icon';
  import {
    filterPanelTabs,
    getAdjacentPanelTabId,
    getDistinctPanelIdentityValue,
    getPanelIdentityContext,
    PANEL_IDENTITY_SEARCH_THRESHOLD,
  } from './panel-identity-history';

  const panelOpenMode$ = selectPanelOpenMode();
  const panelStackDirection$ = selectPanelStackDirection();

  // Detect platform for file manager labels
  const isWindows = typeof navigator !== 'undefined' && navigator.platform?.startsWith('Win');
  const isMac =
    typeof navigator !== 'undefined' &&
    // @ts-expect-error - userAgentData is not in all browsers
    (navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  const fileManagerName = isWindows
    ? m.layout_panelTabBar_fileManagerExplorer_label()
    : isMac
      ? m.layout_panelTabBar_fileManagerFinder_label()
      : m.layout_panelTabBar_fileManagerGeneric_label();
  const logger = createLogger('PanelTabBar');
  const copyBrowserUrlShortcutHint = isMac ? '⇧⌘C' : 'Ctrl+Shift+C';
  const CONTEXT_MENU_MARGIN = 8;
  const CONTEXT_MENU_OFFSET = 4;
  const CONTEXT_MENU_FALLBACK_WIDTH = 224;
  const CONTEXT_MENU_FALLBACK_HEIGHT = 360;
  const PANEL_HEADER_INTERACTIVE_SELECTOR =
    'button, a, input, textarea, select, [role="button"], [role="tab"], [contenteditable="true"]';
  const IDENTITY_HOVER_OPEN_DELAY = 140;
  const IDENTITY_HOVER_CLOSE_DELAY = 40;

  interface Props {
    tabs: PanelTab[];
    activeTabId: string | null;
    panelId: string;
    pinned?: boolean;
    workspaceId: string;
    layoutId?: string;
    isFocused?: boolean;
    /** Content-specific items to merge into the grouped panel action menu. */
    contentActions?: PanelHeaderActions | null;
    /** Legacy tab strip; the tabless shell renders only the content header. */
    showTabStrip?: boolean;
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
    pinned = false,
    workspaceId,
    layoutId,
    isFocused = false,
    contentActions = null,
    showTabStrip = false,
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

  const isDragging = selectIsDragging();
  const allPermissionRequests = selectPermissionRequests();
  const activeAgentIdStore = writable<string>('');
  const activeAgentSession$ = selectAgentSession(activeAgentIdStore);

  // Context menu state
  let contextMenuTab = $state<{
    source: 'tab' | 'panel';
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  let contextMenuElement = $state<HTMLDivElement | null>(null);

  // Identity history menu state is local presentation state.
  let identityMenuOpen = $state(false);
  let identitySearchQuery = $state('');
  let identityTriggerRef = $state<HTMLButtonElement | null>(null);
  let identityMenuRef = $state<HTMLDivElement | null>(null);
  let identityHoverTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressNextIdentityFocusOpen = false;
  let identityTriggerHovered = false;
  let identityMenuHovered = false;
  let identityPointerPosition: { x: number; y: number } | null = null;

  // Tab rename state - tracks which tab is being renamed inline
  let renamingTabId = $state<string | null>(null);
  let renameInputRef = $state<HTMLInputElement | null>(null);
  let renameValue = $state('');

  // Mirror the workspaceId prop into a writable so the Redux selector
  // re-evaluates when the prop changes while the component stays mounted.
  // svelte-ignore state_referenced_locally
  const workspaceIdStore = writable(workspaceId);
  // svelte-ignore state_referenced_locally
  const panelLayoutIdStore = writable(layoutId ?? workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
    panelLayoutIdStore.set(layoutId ?? workspaceId);
  });

  // Reveal-in-file-manager runs against workspace file paths on this
  // machine's desktop shell — only offered when the daemon runs on this
  // machine (PROTOCOL §5.14 locality) AND the workspace checkout lives on the
  // daemon host, i.e. not a remote (SSH) workspace (monorepo#2171).
  const isWorkspaceHostLocal$ = selectIsWorkspaceHostLocal(workspaceIdStore);

  // Reactive list of agent sessions for this workspace. Tab titles, avatar
  // state, specialist, and delegation info all derive from this store so the
  // UI updates when agents rename or their session metadata changes.
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const recentlyClosed$ = selectRecentlyClosed(panelLayoutIdStore);

  // Reactive store subscription for specialist names - ensures re-render when specialists change
  const specialists$ = selectSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const visibleSpecialists = $derived.by(() =>
    filterPickableSpecialists($specialists$, $isGitHubAuth$),
  );
  $effect(() => {
    void $specialists$;
  });

  // Check if any creation callbacks are available
  const hasCreateActions = $derived(
    !!onCreateAgent ||
      !!onCreateAgentWithSpecialist ||
      !!onCreateNote ||
      !!onCreateTerminal ||
      !!onOpenBrowser,
  );

  /**
   * Get the display title for a tab, resolving note/agent titles from the store
   */
  function getTabTitle(tab: PanelTab): string {
    // For note tabs, look up the title from the notes store
    if (tab.type === 'note' && tab.noteId) {
      // Special case for spec note
      if (isSpecNote(tab.noteId)) {
        return m.chat_shared_spec_label();
      }
      // Look up the note from the store
      const note = selectNoteById.select(appStore.state, workspaceId, tab.noteId);
      if (note) {
        return note.title || m.layout_panelLayout_untitled_fallback();
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
  function getAgentSpecialist(tab: PanelTab) {
    if (tab.type !== 'agent' || !tab.agentId) return null;
    const agent = $workspaceAgents$.find((a) => a.id === tab.agentId);
    const specialistId = agent?.metadata?.specialist || (agent as any)?.agentMetadata?.specialist;
    if (!specialistId) return null;
    return $specialists$.find((specialist) => specialist.id === specialistId) ?? null;
  }

  /**
   * Get the avatar state for an agent tab.
   * Uses canonical agent-session selectors for live running/waiting state.
   */
  function getAgentAvatarState(tab: PanelTab): AvatarState {
    if (tab.type !== 'agent' || !tab.agentId) return 'idle';
    if (tab.agentId === activeTab?.agentId) return activeAgentAvatarState;
    const agent = $workspaceAgents$.find((a) => a.id === tab.agentId);
    if (!agent) return 'idle';
    return getAvatarStateForSession(agent, {
      hasPermissionRequest: $allPermissionRequests.some((r) => r.sessionId === tab.agentId),
    });
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
    const workspace = selectWorkspaceById.select(appStore.state, workspaceId);
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

  const identityTabs = $derived([
    ...tabs,
    ...(!pinned
      ? $recentlyClosed$.filter((entry) => entry.panelId === panelId).map((entry) => entry.tab)
      : []),
  ]);
  const backPanelTabId = $derived(getAdjacentPanelTabId(identityTabs, activeTabId, 1));
  const forwardPanelTabId = $derived(getAdjacentPanelTabId(identityTabs, activeTabId, -1));
  const filteredIdentityTabs = $derived(
    filterPanelTabs(identityTabs, identitySearchQuery, getTabTitle),
  );
  const showIdentityHistory = $derived(identityTabs.length > 1);
  const showIdentitySearch = $derived(identityTabs.length >= PANEL_IDENTITY_SEARCH_THRESHOLD);

  function clearIdentityHoverTimer() {
    if (!identityHoverTimer) return;
    clearTimeout(identityHoverTimer);
    identityHoverTimer = null;
  }

  function scheduleIdentityMenuOpen() {
    clearIdentityHoverTimer();
    identityHoverTimer = setTimeout(() => {
      identityMenuOpen = true;
      identityHoverTimer = null;
    }, IDENTITY_HOVER_OPEN_DELAY);
  }

  function updateIdentityPointerPosition(event: PointerEvent) {
    identityPointerPosition = { x: event.clientX, y: event.clientY };
  }

  function isIdentityPointerWithin(node: HTMLElement | null) {
    if (!node || !identityPointerPosition) return false;
    const rect = node.getBoundingClientRect();
    return (
      identityPointerPosition.x > rect.left &&
      identityPointerPosition.x < rect.right &&
      identityPointerPosition.y > rect.top &&
      identityPointerPosition.y < rect.bottom
    );
  }

  function handleIdentityWindowPointerMove(event: PointerEvent) {
    if (!identityMenuOpen) return;
    updateIdentityPointerPosition(event);
    identityTriggerHovered = isIdentityPointerWithin(identityTriggerRef);
    identityMenuHovered = isIdentityPointerWithin(identityMenuRef);
    if (identityTriggerHovered || identityMenuHovered) {
      clearIdentityHoverTimer();
      return;
    }
    if (!identityHoverTimer) scheduleIdentityMenuClose();
  }

  function handleIdentityTriggerPointerEnter(event: PointerEvent) {
    updateIdentityPointerPosition(event);
    identityTriggerHovered = true;
    scheduleIdentityMenuOpen();
  }

  function handleIdentityTriggerPointerLeave(event: PointerEvent) {
    updateIdentityPointerPosition(event);
    identityTriggerHovered = false;
    scheduleIdentityMenuClose();
  }

  function handleIdentityMenuPointerEnter(event: PointerEvent) {
    updateIdentityPointerPosition(event);
    identityMenuHovered = true;
    clearIdentityHoverTimer();
  }

  function handleIdentityMenuPointerLeave(event: PointerEvent) {
    updateIdentityPointerPosition(event);
    identityMenuHovered = false;
    scheduleIdentityMenuClose();
  }

  function scheduleIdentityMenuClose() {
    clearIdentityHoverTimer();
    identityHoverTimer = setTimeout(() => {
      if (
        identityTriggerHovered ||
        identityMenuHovered ||
        identityTriggerRef?.matches(':hover') ||
        identityMenuRef?.matches(':hover') ||
        isIdentityPointerWithin(identityTriggerRef) ||
        isIdentityPointerWithin(identityMenuRef)
      ) {
        identityHoverTimer = null;
        return;
      }
      handleIdentityOpenChange(false);
      identityHoverTimer = null;
    }, IDENTITY_HOVER_CLOSE_DELAY);
  }

  function handleIdentityOpenChange(open: boolean) {
    if (!open) {
      suppressNextIdentityFocusOpen = document.activeElement !== identityTriggerRef;
      identitySearchQuery = '';
    }
    identityMenuOpen = open;
  }

  function handleIdentityTriggerFocus() {
    if (suppressNextIdentityFocusOpen) {
      suppressNextIdentityFocusOpen = false;
      return;
    }
    identityMenuOpen = true;
  }

  function activateIdentityTab(tabId: string | null) {
    if (!tabId) return;
    if (tabs.some((tab) => tab.id === tabId)) {
      handleTabClick(tabId);
    } else {
      appStore.dispatch(reopenClosedTab(layoutId ?? workspaceId, undefined, tabId));
    }
    handleIdentityOpenChange(false);
  }

  onDestroy(clearIdentityHoverTimer);

  function handleTabClose(e: MouseEvent, tabId: string) {
    e.stopPropagation();
    onTabClose?.(tabId);
  }

  function handleTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    contextMenuTab = { source: 'tab', tabId, x: e.clientX, y: e.clientY };
  }

  function handlePanelContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    contextMenuTab = { source: 'panel', tabId, x: e.clientX, y: e.clientY };
  }

  function getContextMenuPosition() {
    if (!contextMenuTab || typeof window === 'undefined') {
      return { x: contextMenuTab?.x ?? 0, y: contextMenuTab?.y ?? 0 };
    }

    const width = contextMenuElement?.offsetWidth || CONTEXT_MENU_FALLBACK_WIDTH;
    const height = contextMenuElement?.offsetHeight || CONTEXT_MENU_FALLBACK_HEIGHT;
    const viewportRight = window.innerWidth - CONTEXT_MENU_MARGIN;
    const viewportBottom = window.innerHeight - CONTEXT_MENU_MARGIN;
    const maxX = Math.max(CONTEXT_MENU_MARGIN, viewportRight - width);
    const maxY = Math.max(CONTEXT_MENU_MARGIN, viewportBottom - height);
    const preferredX = contextMenuTab.x + CONTEXT_MENU_OFFSET;
    const preferredY = contextMenuTab.y + CONTEXT_MENU_OFFSET;

    const x =
      preferredX + width > viewportRight
        ? Math.max(CONTEXT_MENU_MARGIN, contextMenuTab.x - CONTEXT_MENU_OFFSET - width)
        : preferredX;
    const y =
      preferredY + height > viewportBottom
        ? Math.max(CONTEXT_MENU_MARGIN, contextMenuTab.y - CONTEXT_MENU_OFFSET - height)
        : preferredY;

    return {
      x: Math.min(Math.max(CONTEXT_MENU_MARGIN, x), maxX),
      y: Math.min(Math.max(CONTEXT_MENU_MARGIN, y), maxY),
    };
  }

  function closeContextMenu() {
    contextMenuTab = null;
    contextMenuElement = null;
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
      toast.success(m.layout_panelTabBar_pathCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyPathFailed_error());
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
      toast.success(m.layout_panelTabBar_absolutePathCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyPathFailed_error());
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
      toast.success(m.layout_panelTabBar_filenameCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyFilenameFailed_error());
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
      toast.error(m.layout_panelTabBar_revealFailed_error({ fileManager: fileManagerName }));
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
      toast.success(m.layout_panelTabBar_pathCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy the absolute path of an agent session file
   */
  async function copyAgentAbsolutePath(tab: PanelTab) {
    const absolutePath = await getAgentSessionAbsolutePath(tab);
    if (!absolutePath) {
      toast.error(m.layout_panelTabBar_agentPathUnresolved_error());
      return;
    }
    try {
      await navigator.clipboard.writeText(toNativePath(absolutePath));
      toast.success(m.layout_panelTabBar_absolutePathCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy just the filename of an agent session file
   */
  async function copyAgentFileName(tab: PanelTab) {
    const fileName = `${tab.agentId}.json`;
    try {
      await navigator.clipboard.writeText(fileName);
      toast.success(m.layout_panelTabBar_filenameCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyFilenameFailed_error());
    }
  }

  /**
   * Reveal an agent session file in the system file manager (Finder on macOS)
   */
  async function revealAgentInFinder(tab: PanelTab) {
    const absolutePath = await getAgentSessionAbsolutePath(tab);
    if (!absolutePath) {
      toast.error(m.layout_panelTabBar_agentPathUnresolved_error());
      return;
    }
    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch {
      toast.error(m.layout_panelTabBar_revealFailed_error({ fileManager: fileManagerName }));
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
      toast.success(m.layout_panelTabBar_pathCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy the absolute path of a note file
   */
  async function copyNoteAbsolutePath(tab: PanelTab) {
    const absolutePath = await getNoteAbsolutePath(tab);
    if (!absolutePath) {
      toast.error(m.layout_panelTabBar_notePathUnresolved_error());
      return;
    }
    try {
      await navigator.clipboard.writeText(toNativePath(absolutePath));
      toast.success(m.layout_panelTabBar_absolutePathCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy just the filename of a note file
   */
  async function copyNoteFileName(tab: PanelTab) {
    const fileName = `${tab.noteId}.md`;
    try {
      await navigator.clipboard.writeText(fileName);
      toast.success(m.layout_panelTabBar_filenameCopied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyFilenameFailed_error());
    }
  }

  /**
   * Reveal a note file in the system file manager (Finder on macOS)
   */
  async function revealNoteInFinder(tab: PanelTab) {
    const absolutePath = await getNoteAbsolutePath(tab);
    if (!absolutePath) {
      toast.error(m.layout_panelTabBar_notePathUnresolved_error());
      return;
    }
    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch {
      toast.error(m.layout_panelTabBar_revealFailed_error({ fileManager: fileManagerName }));
    }
  }

  /**
   * Copy the browser URL to the clipboard
   */
  async function copyBrowserUrl(tab: PanelTab) {
    if (!tab.browserUrl) return;
    try {
      await writeTextToClipboard(tab.browserUrl);
      toast.success(m.layout_panelTabBar_urlCopied_label());
    } catch (error) {
      logger.error('Failed to copy browser tab URL', error, { url: tab.browserUrl });
      toast.error(m.layout_panelTabBar_copyUrlFailed_error());
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
      toast.error(m.layout_panelTabBar_openInBrowserFailed_error());
    }
  }

  /**
   * Copy the tab title to the clipboard (useful for agents, notes, etc.)
   */
  async function copyTabTitle(tab: PanelTab) {
    const title = getTabTitle(tab);
    try {
      await navigator.clipboard.writeText(title);
      toast.success(m.layout_panelTabBar_copied_label());
    } catch {
      toast.error(m.layout_panelTabBar_copyFailed_error());
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
    if (!showTabStrip || !tabsContainerRef || !activeTabId) return;

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
    appStore.dispatch(startDrag());

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
    appStore.dispatch(endDrag());
  }

  // --- Panel drag (grab the header to reorder whole panels) ---
  function handlePanelDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
    // Don't hijack drags that started on an interactive control
    const target = e.target as HTMLElement;
    if (target.closest('button, input, [contenteditable="true"]')) {
      e.preventDefault();
      return;
    }
    setDraggedPanelId(panelId);
    const activeLayoutId = layoutId ?? workspaceId;
    const layout = selectPanelLayoutWorkspace.select(appStore.state, activeLayoutId);
    setPanelDragSnapshot(activeLayoutId, {
      root: layout.root,
      focusedPanelId: layout.focusedPanelId,
      layoutHistory: layout.layoutHistory,
      historyIndex: layout.historyIndex,
    });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PANEL_DRAG_MIME, JSON.stringify({ panelId }));

    const dragImage = createPanelDragImage(activeTab?.title ?? '');
    e.dataTransfer.setDragImage(dragImage, 16, 16);
    requestAnimationFrame(() => dragImage.remove());

    appStore.dispatch(startDrag());
  }

  function handlePanelDragEnd(e: DragEvent) {
    if (e.dataTransfer?.dropEffect === 'none') restorePanelDragStartLayout();
    clearDraggedPanelState();
    appStore.dispatch(endDrag());
  }

  function restorePanelDragStartLayout() {
    const snapshot = takePanelDragSnapshot();
    if (!snapshot) return;
    const { layoutId: snapshotLayoutId, ...layoutSnapshot } = snapshot;
    appStore.dispatch(restorePanelDragLayout(snapshotLayoutId, layoutSnapshot));
  }

  function handlePanelDragKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || getDraggedPanelId() !== panelId) return;
    restorePanelDragStartLayout();
    clearDraggedPanelState();
    appStore.dispatch(endDrag());
  }

  // Check if a tab drag is happening (from this panel or another)
  function isTabDrag(e: DragEvent): boolean {
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
    if (!isTabDrag(e)) return;
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
    if (!isTabDrag(e)) return;
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

  // Get the currently active tab
  const activeTab = $derived(tabs.find((t) => t.id === activeTabId) || tabs[0] || null);
  $effect(() => {
    activeAgentIdStore.set(
      activeTab?.type === 'agent' && activeTab.agentId ? activeTab.agentId : '',
    );
  });
  const activeAgentAvatarState = $derived.by((): AvatarState => {
    const agentId = activeTab?.type === 'agent' ? activeTab.agentId : null;
    const session = $activeAgentSession$;
    if (!agentId || !session || session.id !== agentId) return 'idle';

    return getAvatarStateForSession(session, {
      isActive: true,
      hasPermissionRequest: $allPermissionRequests.some((request) => request.sessionId === agentId),
    });
  });

  /**
   * "Delegated by" parent-agent attribution for the active agent tab.
   *
   * The parent agent ID is mirrored into a writable store so selectAgentSession
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
  const activeAgentParent$ = selectAgentSession(activeAgentParentIdStore);
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
   * Tabs remain interactive on double-click: renameable tabs enter rename mode
   * instead of bubbling the panel-header expand gesture.
   */
  function handleTabDoubleClick(e: MouseEvent, tab: PanelTab) {
    e.preventDefault();
    e.stopPropagation();
    startInlineRename(tab);
  }

  function handlePanelHeaderDoubleClick(e: MouseEvent) {
    const target = e.target;
    if (
      !(target instanceof Element) ||
      target.closest(PANEL_HEADER_INTERACTIVE_SELECTOR) ||
      getDraggedPanelId() !== null
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    appStore.dispatch(toggleExpandPanel(layoutId ?? workspaceId, panelId));
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
    appStore.dispatch(
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

{#snippet panelPinButton()}
  <Tooltip
    content={pinned
      ? m.layout_panelTabBar_unpinPanel_label()
      : m.layout_panelTabBar_pinPanel_label()}
    side="bottom"
    delayDuration={300}
  >
    <Button
      variant="ghost-light"
      size="icon-sm"
      class={pinned ? 'text-primary' : 'text-muted-foreground opacity-40 hover:opacity-100'}
      onclick={() =>
        appStore.dispatch(
          setPanelPinned(workspaceId, panelId, !pinned, undefined, $panelStackDirection$),
        )}
      aria-label={pinned
        ? m.layout_panelTabBar_unpinPanel_label()
        : m.layout_panelTabBar_pinPanel_label()}
      aria-pressed={pinned}
      data-panel-pin
    >
      <span
        class="inline-flex transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none"
        style:transform={pinned ? 'rotate(-45deg)' : undefined}
        data-panel-pin-icon
      >
        <Fa icon={faThumbtack} size="xs" />
      </span>
    </Button>
  </Tooltip>
{/snippet}

{#snippet panelActionsDropdown()}
  <DropdownMenu align="end" side="bottom" contentClass="w-56">
    <!-- i18n-ignore -->
    {#snippet trigger({ props }: { props: Record<string, unknown> })}
      <Tooltip content={m.ui_breadcrumb_more_label()} side="bottom" delayDuration={300}>
        <Button
          {...props}
          variant="ghost-light"
          size="icon-sm"
          aria-label={m.ui_breadcrumb_more_label()}
          data-testid="panel-actions-trigger"
        >
          <KebabIcon class="pointer-events-none size-3!" />
        </Button>
      </Tooltip>
    {/snippet}
    {#snippet content({ close }: { close: () => void })}
      <div class="type-caption px-2 pb-0.5 pt-1.5 font-medium text-muted-foreground">
        {m.layout_panelTabBar_displaySection_label()}
      </div>
      <div data-panel-actions-section="display">
        {@render contentActions?.display?.()}
        <Menu.CommandItem
          icon={isZoomed ? faCompress : faExpand}
          label={isZoomed
            ? m.layout_panelTabBar_unzoomPanel_label()
            : m.layout_panelTabBar_zoomPanel_label()}
          shortcut="⇧⌘↵"
          disabled={!onZoomToggle}
          onclick={() => {
            onZoomToggle?.();
            close();
          }}
        />
      </div>

      <Menu.Separator />

      <div class="type-caption px-2 pb-0.5 pt-1.5 font-medium text-muted-foreground">
        {m.layout_panelTabBar_actionsSection_label()}
      </div>
      <div data-panel-actions-section="actions">
        {@render contentActions?.actions?.()}
        <Menu.CommandItem
          icon={faThumbtack}
          label={pinned
            ? m.layout_panelTabBar_unpinPanel_label()
            : m.layout_panelTabBar_pinPanel_label()}
          onclick={() => {
            appStore.dispatch(
              setPanelPinned(workspaceId, panelId, !pinned, undefined, $panelStackDirection$),
            );
            close();
          }}
        />
        <Menu.CommandItem
          icon={faTableColumns}
          label={m.layout_panelTabBar_splitRight_label()}
          shortcut="⌘\"
          disabled={!onSplitHorizontal}
          onclick={() => {
            onSplitHorizontal?.();
            close();
          }}
        />
        <Menu.CommandItem
          icon={faGripLines}
          label={m.layout_panelTabBar_splitDown_label()}
          shortcut="⇧⌘\"
          disabled={!onSplitVertical}
          onclick={() => {
            onSplitVertical?.();
            close();
          }}
        />
      </div>
    {/snippet}
  </DropdownMenu>
{/snippet}

{#snippet panelCloseButton()}
  {#if onClosePanel}
    <Tooltip content={m.layout_panelTabBar_closePanel_label()} side="bottom" delayDuration={300}>
      <Button
        variant="ghost-light"
        size="icon-sm"
        onclick={onClosePanel}
        aria-label={m.layout_panelTabBar_closePanel_label()}
        data-testid="panel-close-button"
      >
        <Fa icon={faXmark} size={14} class="size-3.5!" />
      </Button>
    </Tooltip>
  {/if}
{/snippet}

{#snippet panelIdentity(tab: PanelTab, compact = false)}
  {@const resourceKind = getResourceIconKind(tab.type)}
  {#if tab.type === 'agent' && tab.agentId}
    <AgentAvatarWithState
      agentId={tab.agentId}
      variant={compact ? 'standard' : 'emphasized'}
      state={getAgentAvatarState(tab)}
      specialist={getAgentSpecialistType(tab) as
        import('$lib/constants/specialists').BuiltinSpecialistId | null}
    />
  {:else if resourceKind}
    <ResourceIconTile kind={resourceKind} variant={compact ? 'standard' : 'emphasized'} />
  {:else if tab.faviconUrl}
    <img
      src={tab.faviconUrl}
      alt=""
      width={compact ? 14 : 16}
      height={compact ? 14 : 16}
      class="rounded-sm"
    />
  {:else}
    <Fa
      icon={getTabIcon(tab.type)}
      size={compact ? 14 : 16}
      class="shrink-0 text-muted-foreground"
    />
  {/if}
{/snippet}

<svelte:window onkeydown={handlePanelDragKeyDown} onpointermove={handleIdentityWindowPointerMove} />

<!-- Tab bar + Header wrapper -->
<div class="panel-tab-wrapper flex flex-col">
  <!-- Tab bar (traditional tabs) -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={tabBarRef}
    class={cn(
      'panel-tab-bar group/tabbar relative flex items-center h-[var(--panel-header-height)] border-b border-border bg-card',
      !showTabStrip && 'hidden',
    )}
    data-panel-tab-bar
    ondblclick={handlePanelHeaderDoubleClick}
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
        <!-- i18n-ignore (scanner false positive on the < comparison) -->
        {@const shortcutKey = index < 9 ? `⌘${index + 1}` : null}
        {@const isDragOver = dragOverTabId === tab.id}
        {@const tabTitle = getTabTitle(tab)}
        {@const resourceKind = getResourceIconKind(tab.type)}
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
                ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ring'
                : 'text-muted-foreground hover:text-foreground',
              draggedTabId === tab.id && 'opacity-50',
            )}
            onclick={() => handleTabClick(tab.id)}
            onmousedown={() => handleTabClick(tab.id)}
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
                <AgentAvatarWithState
                  agentId={tab.agentId}
                  size={16}
                  state={getAgentAvatarState(tab)}
                  specialist={getAgentSpecialistType(tab) as
                    import('$lib/constants/specialists').BuiltinSpecialistId | null}
                  class="shrink-0"
                />
              {:else if resourceKind}
                <ResourceIconTile kind={resourceKind} />
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
                  >{m.layout_panelTabBar_bgBadge_label()}</span
                >
              {/if}

              {#if tab.hasUnsavedChanges}
                <span class="unsaved-dot w-1.5 h-1.5 rounded-full bg-primary"></span>
              {/if}

              {#if tab.closable}
                <!-- User close of an agent-owned browser tab hides it (webview
                     kept alive for the agent, monorepo#2857) — say so. -->
                <button
                  class={cn(
                    'tab-close ml-1 p-0.5 rounded transition-opacity cursor-pointer',
                    isActive
                      ? 'opacity-60 hover:opacity-100 focus-visible:opacity-100'
                      : 'opacity-0 group-hover:opacity-60 group-focus-within:opacity-60',
                  )}
                  onclick={(e) => handleTabClose(e, tab.id)}
                  title={tab.type === 'browser' && tab.ownerAgentId
                    ? m.layout_panelTabBar_hideOwnedTab_tooltip()
                    : undefined}
                  aria-label={tab.type === 'browser' && tab.ownerAgentId
                    ? m.layout_panelTabBar_hideOwnedTab_ariaLabel()
                    : m.layout_panelTabBar_closeTab_ariaLabel()}
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
          class="shrink-0 flex items-center self-stretch pl-1 pr-1 transition-opacity sticky right-0 bg-card"
        >
          <DropdownMenu align="start" side="bottom">
            {#snippet trigger({ props }: { props: Record<string, unknown> })}
              <Tooltip
                content={m.layout_panelTabBar_new_tooltip()}
                side="bottom"
                delayDuration={300}
                class="flex"
              >
                <Button
                  {...props}
                  variant="ghost-light"
                  size="icon-xs"
                  class="opacity-30 group-hover/tabbar:opacity-100"
                  aria-label={m.layout_panelTabBar_createNew_ariaLabel()}
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
                    <AgentAvatar agentId="blank" size={16} />
                    <span>{m.layout_panelTabBar_blankAgent_label()}</span>
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
                      <AgentAvatar agentId="blank" size={16} specialist={specialist.id} />
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
                    <span>{m.layout_panelTabBar_manageSpecialists_label()}</span>
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
                    <span>{m.menu_new_agent()}</span>
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
                    <Fa icon={RESOURCE_ICON_BY_KIND.note} size="xs" class="text-ghost" />
                    <span>{m.menu_new_note()}</span>
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
                    <span>{m.menu_new_terminal()}</span>
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
                    <span>{m.menu_new_browser()}</span>
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
        class="panel-actions flex items-center gap-0 px-1 opacity-30 group-hover/tabbar:opacity-100 focus-within:opacity-100 transition-opacity z-20"
        data-panel-header-actions
      >
        {#if $panelOpenMode$ === 'pin'}
          {@render panelPinButton()}
        {/if}
        {@render contentActions?.primary?.()}
        {@render panelActionsDropdown()}
        {@render panelCloseButton()}
      </div>
    </div>
  </div>

  <!-- Compact header bar (breadcrumb style) -->
  {#if activeTab}
    {@const activeTabPath = getTabPath(activeTab)}
    {@const activeTabTitle = getTabTitle(activeTab)}
    {@const activeIdentityContext = getPanelIdentityContext(
      activeTabTitle,
      activeTabPath ?? activeTab.browserUrl ?? null,
    )}
    {@const activeAgentSpecialist = getAgentSpecialist(activeTab)}
    {@const activeAgentSpecialistName = getDistinctPanelIdentityValue(activeAgentSpecialist?.name, [
      activeTabTitle,
    ])}
    {@const activeAgentSpecialistDescription = getDistinctPanelIdentityValue(
      activeAgentSpecialist?.description,
      [activeTabTitle, activeAgentSpecialistName],
    )}
    {@const activeAgentDelegatedBy = getDistinctPanelIdentityValue(activeAgentDelegatedByName, [
      activeTabTitle,
    ])}
    {@const activeAgentStateLabel =
      activeTab.type === 'agent' ? getAgentAvatarStateLabel(activeAgentAvatarState) : null}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'panel-header group/header relative flex h-[var(--panel-header-height)] cursor-grab items-center border-b border-border bg-card pr-2.5 active:cursor-grabbing',
        isFocused && 'focused',
      )}
      oncontextmenu={(event) => handlePanelContextMenu(event, activeTab.id)}
      ondblclick={handlePanelHeaderDoubleClick}
      draggable="true"
      ondragstart={handlePanelDragStart}
      ondragend={handlePanelDragEnd}
      data-panel-tabless-header
      data-panel-content-header
    >
      <!-- Left: one content title + optional context (changes tabs provide their own header). -->
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <!-- Type identity opens the existing ordered tabs for this panel column. -->
        <span
          class="shrink-0 self-center"
          onpointerenter={handleIdentityTriggerPointerEnter}
          onpointerleave={handleIdentityTriggerPointerLeave}
        >
          <Menu.Root bind:open={identityMenuOpen} onOpenChange={handleIdentityOpenChange}>
            <Menu.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  bind:this={identityTriggerRef}
                  type="button"
                  class="panel-header-leading-surface flex size-6 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:bg-accent focus-visible:text-accent-foreground"
                  aria-label={m.layout_panelTabBar_identityHistory_ariaLabel()}
                  onfocus={handleIdentityTriggerFocus}
                  data-testid={activeTab.type === 'agent'
                    ? 'panel-header-agent-avatar-slot'
                    : 'panel-identity-history-trigger'}
                  data-panel-identity-history-trigger
                  data-panel-header-leading-surface
                >
                  {@render panelIdentity(activeTab)}
                </button>
              {/snippet}
            </Menu.Trigger>
            <Menu.Content
              bind:ref={identityMenuRef}
              align="start"
              side="bottom"
              collisionPadding={8}
              class="w-64 max-w-[calc(100vw-1rem)] p-1.5 focus-visible:border-border focus-visible:ring-0 data-[state=closed]:animate-none!"
              maxHeight="min(28rem, calc(100dvh - 1rem))"
              aria-label={m.layout_panelTabBar_identityHistory_ariaLabel()}
              onpointerenter={handleIdentityMenuPointerEnter}
              onpointerleave={handleIdentityMenuPointerLeave}
              data-panel-identity-history-menu
            >
              <div
                class="flex min-w-0 items-start gap-2 px-2 pb-1.5 pt-1"
                data-panel-identity-current
              >
                <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                  {@render panelIdentity(activeTab, true)}
                </span>
                <div class="min-w-0 flex-1">
                  <div
                    class="truncate text-sm font-medium text-foreground"
                    data-panel-identity-title
                  >
                    {activeTabTitle}
                  </div>
                  {#if activeAgentStateLabel}
                    <div
                      class="type-caption truncate text-muted-foreground"
                      data-panel-identity-agent-state
                    >
                      {activeAgentStateLabel}
                    </div>
                  {/if}
                  {#if activeIdentityContext}
                    <div
                      class="type-caption truncate text-muted-foreground"
                      data-panel-identity-context
                    >
                      {activeIdentityContext}
                    </div>
                  {/if}
                  {#if activeAgentSpecialistName}
                    <div
                      class="type-caption truncate text-muted-foreground"
                      data-panel-identity-specialist
                    >
                      {m.layout_panelTabBar_specialistAgent_label({
                        specialist: activeAgentSpecialistName,
                      })}
                    </div>
                  {/if}
                  {#if activeAgentSpecialistDescription}
                    <div
                      class="type-caption line-clamp-2 text-muted-foreground"
                      data-panel-identity-specialist-description
                    >
                      {activeAgentSpecialistDescription}
                    </div>
                  {/if}
                  {#if activeAgentDelegatedBy}
                    <div
                      class="type-caption truncate text-muted-foreground"
                      data-panel-identity-delegated-by
                    >
                      {m.layout_panelTabBar_delegatedBy_label({ name: activeAgentDelegatedBy })}
                    </div>
                  {/if}
                </div>
              </div>
              {#if showIdentityHistory}
                <div data-panel-identity-history-section>
                  <Menu.Separator />
                  <div class="flex items-center gap-2 px-1 py-1" data-panel-identity-navigation>
                    <div
                      class="shrink-0 px-1 text-base font-medium text-muted-foreground"
                      data-panel-identity-history-title
                    >
                      {m.layout_panelTabBar_identityHistory_ariaLabel()}
                    </div>
                    {#if showIdentitySearch}
                      <label class="relative min-w-0 flex-1">
                        <span class="sr-only">{m.ui_searchableSelect_search_placeholder()}</span>
                        <Fa
                          icon={faMagnifyingGlass}
                          size="xs"
                          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          bind:value={identitySearchQuery}
                          type="search"
                          noFocusStyle
                          aria-label={m.ui_searchableSelect_search_placeholder()}
                          placeholder={m.ui_searchableSelect_search_placeholder()}
                          class="h-7 w-full rounded-md border border-border bg-transparent pl-7 pr-2 text-xs outline-none focus:border-input focus:ring-1 focus:ring-border"
                          data-panel-identity-search
                        />
                      </label>
                    {/if}
                    <div class="ml-auto flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost-light"
                        size="icon-sm"
                        class="focus:border-border focus:bg-accent focus:text-accent-foreground focus:ring-0 focus-visible:border-border focus-visible:ring-0"
                        disabled={!backPanelTabId}
                        aria-label={m.ui_contentHeader_goBack_tooltip()}
                        onclick={() => activateIdentityTab(backPanelTabId)}
                        data-panel-identity-back
                      >
                        <Fa icon={faArrowLeft} size="xs" />
                      </Button>
                      <Button
                        variant="ghost-light"
                        size="icon-sm"
                        class="focus:border-border focus:bg-accent focus:text-accent-foreground focus:ring-0 focus-visible:border-border focus-visible:ring-0"
                        disabled={!forwardPanelTabId}
                        aria-label={m.ui_contentHeader_goForward_tooltip()}
                        onclick={() => activateIdentityTab(forwardPanelTabId)}
                        data-panel-identity-forward
                      >
                        <Fa icon={faArrowRight} size="xs" />
                      </Button>
                    </div>
                  </div>
                  <div class="max-h-64 overflow-y-auto overscroll-contain" data-panel-identity-list>
                    {#each filteredIdentityTabs as tab (tab.id)}
                      {@const current = tab.id === activeTabId}
                      <Menu.Item
                        class="min-h-8"
                        aria-current={current ? 'page' : undefined}
                        onclick={() => activateIdentityTab(tab.id)}
                        data-panel-identity-item={tab.id}
                        data-panel-identity-type={tab.type}
                      >
                        <span class="flex size-5 shrink-0 items-center justify-center">
                          {@render panelIdentity(tab, true)}
                        </span>
                        <span class="min-w-0 flex-1 truncate">{getTabTitle(tab)}</span>
                        {#if current}
                          <Fa icon={faCheck} size="xs" class="shrink-0 text-primary" />
                        {/if}
                      </Menu.Item>
                    {:else}
                      <div class="px-2 py-3 text-center text-xs text-muted-foreground">
                        {m.ui_combobox_noOptions_message()}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </Menu.Content>
          </Menu.Root>
        </span>
        <!-- Single content title; type/category is conveyed by the content itself. -->
        <div class="panel-header-title min-w-0 shrink" data-panel-header-title>
          {#if isTabRenameable(activeTab) && onTabRename}
            <EditableName
              value={activeTabTitle}
              onSave={(newName) => handleTabRename(activeTab, newName)}
              textClass="text-sm shrink font-medium {isFocused ? 'text-foreground' : 'text-subtle'}"
              title={m.ui_editableName_rename_tooltip()}
              maxWidth={240}
            />
          {:else}
            <span
              class="block truncate text-sm font-medium {isFocused
                ? 'text-foreground'
                : 'text-subtle'}"
            >
              {activeTabTitle}
            </span>
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

      <!-- Right: stable content controls, grouped actions, and close. -->
      <div class="flex shrink-0 items-center gap-0" data-panel-header-actions>
        {#if $panelOpenMode$ === 'pin'}
          {@render panelPinButton()}
        {/if}
        {@render contentActions?.primary?.()}
        {@render panelActionsDropdown()}
        {@render panelCloseButton()}
      </div>
    </div>
  {/if}
</div>

<!-- Context Menu -->
{#if contextMenuTab}
  {@const menuTabId = contextMenuTab.tabId}
  {@const menuPosition = getContextMenuPosition()}
  {@const contextTab =
    contextMenuTab.source === 'tab' ? tabs.find((t) => t.id === menuTabId) : undefined}
  <Portal zIndex={50}>
    <div
      class="fixed inset-0 z-50"
      role="presentation"
      oncontextmenu={(e) => {
        e.preventDefault();
        closeContextMenu();
      }}
    >
      <button
        type="button"
        class="absolute inset-0 bg-transparent border-0 p-0 cursor-default"
        aria-label={m.layout_panelTabBar_closeContextMenu_ariaLabel()}
        onclick={closeContextMenu}
      ></button>
      <div
        bind:this={contextMenuElement}
        class="absolute bg-popover border border-border shadow w-56 max-h-[calc(100vh-1rem)] overflow-y-auto z-10"
        style="left: {menuPosition.x}px; top: {menuPosition.y}px;"
        data-panel-context-menu={contextMenuTab.source}
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
            {m.layout_panelTabBar_revealInSidebar_label()}
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
            {m.layout_panelTabBar_copyRelativePath_label()}
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
            onclick={() => {
              copyAbsolutePath(contextTab);
              closeContextMenu();
            }}
          >
            <Fa icon={faCopy} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_copyAbsolutePath_label()}
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
            onclick={() => {
              copyFileName(contextTab);
              closeContextMenu();
            }}
          >
            <Fa icon={faCopy} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_copyFilename_label()}
          </button>
          {#if $isWorkspaceHostLocal$}
            <button
              class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
              onclick={() => {
                revealInFinder(contextTab);
                closeContextMenu();
              }}
            >
              <Fa icon={faFolderOpen} size="xs" class="text-ghost" />
              {m.layout_panelTabBar_revealIn_label({ fileManager: fileManagerName })}
            </button>
          {/if}
        {/if}
        <!-- Type-specific actions for browser tabs -->
        {#if contextTab && contextTab.type === 'browser' && contextTab.browserUrl}
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between gap-4"
            onclick={() => {
              copyBrowserUrl(contextTab);
              closeContextMenu();
            }}
          >
            <span class="flex items-center gap-2">
              <Fa icon={faCopy} size="xs" class="text-ghost" />
              {m.layout_panelTabBar_copyUrl_label()}
            </span>
            <span class="text-subtle text-xs">{copyBrowserUrlShortcutHint}</span>
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
            onclick={() => {
              openInExternalBrowser(contextTab);
              closeContextMenu();
            }}
          >
            <Fa icon={faArrowUpRightFromSquare} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_openInBrowser_label()}
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
            {m.layout_panelTabBar_copyRelativePath_label()}
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
            onclick={() => {
              copyAgentAbsolutePath(contextTab);
              closeContextMenu();
            }}
          >
            <Fa icon={faCopy} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_copyAbsolutePath_label()}
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
            onclick={() => {
              copyAgentFileName(contextTab);
              closeContextMenu();
            }}
          >
            <Fa icon={faCopy} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_copyFilename_label()}
          </button>
          {#if $isWorkspaceHostLocal$}
            <button
              class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
              onclick={() => {
                revealAgentInFinder(contextTab);
                closeContextMenu();
              }}
            >
              <Fa icon={faFolderOpen} size="xs" class="text-ghost" />
              {m.layout_panelTabBar_revealIn_label({ fileManager: fileManagerName })}
            </button>
          {/if}
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
            {m.layout_panelTabBar_copyRelativePath_label()}
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
            onclick={() => {
              copyNoteAbsolutePath(contextTab);
              closeContextMenu();
            }}
          >
            <Fa icon={faCopy} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_copyAbsolutePath_label()}
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
            onclick={() => {
              copyNoteFileName(contextTab);
              closeContextMenu();
            }}
          >
            <Fa icon={faCopy} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_copyFilename_label()}
          </button>
          {#if $isWorkspaceHostLocal$}
            <button
              class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center gap-2"
              onclick={() => {
                revealNoteInFinder(contextTab);
                closeContextMenu();
              }}
            >
              <Fa icon={faFolderOpen} size="xs" class="text-ghost" />
              {m.layout_panelTabBar_revealIn_label({ fileManager: fileManagerName })}
            </button>
          {/if}
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
            {m.layout_panelTabBar_copyTerminalName_label()}
          </button>
        {/if}
        {#if contextTab}
          <div class="border-t border-border"></div>
        {/if}
        <!-- Zoom toggle -->
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
          onclick={() => {
            onZoomToggle?.();
            closeContextMenu();
          }}
        >
          {isZoomed
            ? m.layout_panelTabBar_unzoomPanel_label()
            : m.layout_panelTabBar_zoomPanel_label()}
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
            {m.layout_panelTabBar_splitRight_label()}
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
            {m.layout_panelTabBar_splitDown_label()}
          </span>
          <span class="text-subtle text-xs">⇧⌘\</span>
        </button>
        <div class="border-t border-border"></div>
        {#if contextMenuTab.source === 'tab'}
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
            onclick={() => {
              onTabClose?.(menuTabId);
              closeContextMenu();
            }}
          >
            {m.layout_panelTabBar_close_label()}
            <span class="text-subtle text-xs">⌘W</span>
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
            onclick={() => {
              onCloseOtherTabs?.(menuTabId);
              closeContextMenu();
            }}
          >
            {m.layout_panelTabBar_closeOtherTabs_label()}
            <span class="text-subtle text-xs"></span>
          </button>
          <button
            class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
            onclick={() => {
              onCloseTabsToRight?.(menuTabId);
              closeContextMenu();
            }}
          >
            {m.layout_panelTabBar_closeTabsToRight_label()}
            <span class="text-subtle text-xs"></span>
          </button>
        {/if}
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
          onclick={() => {
            onClosePanel?.();
            closeContextMenu();
          }}
        >
          {m.layout_panelTabBar_closePanel_label()}
          <span class="text-subtle text-xs"></span>
        </button>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between"
          onclick={() => {
            onCloseAllOthersEverywhere?.(menuTabId);
            closeContextMenu();
          }}
        >
          {m.layout_panelTabBar_closeAllOthers_label()}
          <span class="text-subtle text-xs"></span>
        </button>
      </div>
    </div>
  </Portal>
{/if}

<style>
  /* CSS variables for panel tab bar heights */
  .panel-tab-wrapper {
    --panel-header-height: clamp(2rem, 3rem, 10cqh);
  }

  .panel-header {
    padding-inline-start: calc(
      (var(--panel-header-height) - var(--agent-avatar-emphasized-surface-size)) / 2
    );
  }

  .panel-header-leading-surface {
    position: relative;
    top: 0.5px;
  }
</style>
