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
    faArrowLeft,
    faArrowRight,
    faArrowUp,
    faArrowDown,
    faCheck,
    faComment,
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
  import type { TransitionConfig } from 'svelte/transition';
  import { Button } from '$lib/components/ui/button';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { startDrag, endDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    setPanelColumnCount,
    toggleExpandPanel,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { isPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import {
    PANE_DRAG_MIME,
    clearDraggedPaneState,
    createPaneDragImage,
    getDraggedPane,
    setDraggedPane,
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
  import PanelHeaderAgentAvatar from './PanelHeaderAgentAvatar.svelte';
  import BrowserFavicon from './BrowserFavicon.svelte';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import {
    selectIsWorkspaceHostLocal,
    selectWorkspaceById,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { writable } from 'svelte/store';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import { stripWorkspacePrefix } from '$lib/utils/file-utils';
  import { toNativePath } from '$lib/utils/path-utils';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { createLogger } from '$lib/utils/client-logger';
  import { formatShortcut } from '$lib/utils/shortcuts';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { effectiveShortcutReadable } from '$lib/utils/effective-shortcuts';
  import type { PanelHeaderActions } from './panel-header-context.svelte';
  import ResourceIconTile from '$lib/components/shared/ResourceIconTile.svelte';
  import { getResourceIconKind, RESOURCE_ICON_BY_KIND } from '$lib/components/shared/resource-icon';
  import { getPanelExternalOpenTarget } from './panel-external-open-target';

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
  const copyBrowserUrlShortcut$ = effectiveShortcutReadable('panel.copy-browser-url');
  const closePaneShortcut$ = effectiveShortcutReadable('navigation.close-tab');
  const createColumnRightShortcut$ = effectiveShortcutReadable('panel.create-column-right');
  const movePaneLeftShortcut$ = effectiveShortcutReadable('panel.move-pane-previous-column');
  const movePaneRightShortcut$ = effectiveShortcutReadable('panel.move-pane-next-column');
  const previousPaneShortcut$ = effectiveShortcutReadable('panel.previous-pane');
  const nextPaneShortcut$ = effectiveShortcutReadable('panel.next-pane');
  const copyBrowserUrlShortcutHint = $derived(formatShortcut($copyBrowserUrlShortcut$));
  const closePaneShortcutHint = $derived(formatShortcut($closePaneShortcut$));
  const createColumnRightShortcutHint = $derived(formatShortcut($createColumnRightShortcut$));
  const addColumnLinkModifierHint = formatShortcut('mod');
  const movePaneLeftShortcutHint = $derived(formatShortcut($movePaneLeftShortcut$));
  const movePaneRightShortcutHint = $derived(formatShortcut($movePaneRightShortcut$));
  const previousPaneShortcutHint = $derived(formatShortcut($previousPaneShortcut$));
  const nextPaneShortcutHint = $derived(formatShortcut($nextPaneShortcut$));
  const MAX_VISIBLE_PANE_STACK_LINES = 6;
  const PANE_STACK_LINE_BOTTOM_Y = 12;
  const PANE_STACK_LINE_GAP = 2;
  const CONTEXT_MENU_MARGIN = 8;
  const CONTEXT_MENU_OFFSET = 4;
  const CONTEXT_MENU_FALLBACK_WIDTH = 224;
  const CONTEXT_MENU_FALLBACK_HEIGHT = 360;
  const PANEL_HEADER_INTERACTIVE_SELECTOR =
    'button, a, input, textarea, select, [role="button"], [role="tab"], [contenteditable="true"]';

  interface Props {
    tabs: PanelTab[];
    activeTabId: string | null;
    attentionTabIds?: string[];
    panelId: string;
    workspaceId: string;
    layoutId?: string;
    availableCanvasWidth?: number;
    isFocused?: boolean;
    isRightmostPanel?: boolean;
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
    /** Idempotently finishes the active-pane drag before layout mutation. */
    onPaneDragFinish?: () => void;
    onMovePaneLeft?: () => void;
    onMovePaneRight?: () => void;
    onMoveLeft?: () => void;
    onMoveRight?: () => void;
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
  }

  let {
    tabs,
    activeTabId,
    attentionTabIds = [],
    panelId,
    workspaceId,
    layoutId,
    availableCanvasWidth,
    isFocused = false,
    isRightmostPanel: _isRightmostPanel = false,
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
    onPaneDragFinish,
    onMovePaneLeft,
    onMovePaneRight,
    onMoveLeft,
    onMoveRight,
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
  }: Props = $props();

  // Panel identity is immutable for this component lifetime. Cleanup must not
  // re-read a parent prop after reactive layout removal has started.
  // svelte-ignore state_referenced_locally
  const stablePanelId = panelId;

  const isDragging = selectIsDragging();
  // Context menu state
  let contextMenuTab = $state<{
    source: 'tab' | 'panel';
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  let contextMenuElement = $state<HTMLDivElement | null>(null);

  let paneStackMenuOpen = $state(false);
  let panelActionsMenuOpen = $state({ tabBar: false, compact: false });

  $effect(() => {
    void activeTabId;
    panelActionsMenuOpen.tabBar = false;
    panelActionsMenuOpen.compact = false;
  });

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
  const panelColumnCount$ = selectPanelColumnCount(panelLayoutIdStore);

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

  function isAgentOwnedBrowserPane(tab: PanelTab): boolean {
    return tab.type === 'browser' && Boolean(tab.ownerAgentId);
  }

  const attentionPaneIds = $derived(new Set(attentionTabIds));
  const inactiveAttentionCount = $derived(
    tabs.filter((tab) => tab.id !== activeTabId && attentionPaneIds.has(tab.id)).length,
  );
  const activePaneIndex = $derived(tabs.findIndex((tab) => tab.id === activeTabId));
  const previousPane = $derived(activePaneIndex > 0 ? tabs[activePaneIndex - 1] : undefined);
  const nextPane = $derived(
    activePaneIndex >= 0 && activePaneIndex < tabs.length - 1
      ? tabs[activePaneIndex + 1]
      : undefined,
  );

  function handleAddPanelColumn() {
    const nextCount = $panelColumnCount$ + 1;
    if (!isPanelColumnCount(nextCount)) return;
    appStore.dispatch(
      setPanelColumnCount(layoutId ?? workspaceId, nextCount, undefined, availableCanvasWidth),
    );
  }

  function activatePane(tabId: string) {
    handleTabClick(tabId);
    paneStackMenuOpen = false;
  }

  function panePosition(tabId: string): number {
    return tabs.findIndex((tab) => tab.id === tabId) + 1;
  }

  function handleTabClose(e: MouseEvent, tabId: string) {
    e.stopPropagation();
    onTabClose?.(tabId);
  }

  function handleTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    contextMenuTab = { source: 'tab', tabId, x: e.clientX, y: e.clientY };
  }

  function handlePanelContextMenu(e: MouseEvent) {
    const target = e.target;
    if (target instanceof Element && target.closest(PANEL_HEADER_INTERACTIVE_SELECTOR)) return;
    e.preventDefault();
    contextMenuTab = null;
    panelActionsMenuOpen.compact = true;
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
  const TAB_DRAG_MIME = PANE_DRAG_MIME;

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
    e.dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify({ tabId, panelId: stablePanelId }));

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

  // --- Active pane drag (grab the header to move only the visible pane) ---
  function handlePaneDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
    // Don't hijack drags that started on an interactive control
    const target = e.target as HTMLElement;
    if (target.closest('button, input, [contenteditable="true"]')) {
      e.preventDefault();
      return;
    }
    if (!activeTab) {
      e.preventDefault();
      return;
    }
    const draggedPane = { tabId: activeTab.id, panelId: stablePanelId };
    setDraggedPane(draggedPane);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PANE_DRAG_MIME, JSON.stringify(draggedPane));

    const dragImage = createPaneDragImage(activeTab.title ?? '');
    e.dataTransfer.setDragImage(dragImage, 16, 16);
    requestAnimationFrame(() => dragImage.remove());

    appStore.dispatch(startDrag());
  }

  function finishPaneDrag() {
    const finish = onPaneDragFinish;
    if (finish) finish();
    else {
      clearDraggedPaneState();
      appStore.dispatch(endDrag());
    }
  }

  function handlePaneDragEnd() {
    if (getDraggedPane()?.panelId === stablePanelId) finishPaneDrag();
  }

  function handlePaneDragKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || getDraggedPane()?.panelId !== stablePanelId) return;
    finishPaneDrag();
  }

  onDestroy(() => {
    if (getDraggedPane()?.panelId === stablePanelId) finishPaneDrag();
  });

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
      if (fromPanelId === stablePanelId) {
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
      if (fromPanelId === stablePanelId) {
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

  function paneStackLineMotion(_node: Element, { offset }: { offset: number }): TransitionConfig {
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    return {
      duration: reducedMotion ? 0 : 160,
      css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * offset}px);`,
    };
  }

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
      getDraggedPane() !== null
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    appStore.dispatch(toggleExpandPanel(layoutId ?? workspaceId, stablePanelId));
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

{#snippet panelActionsDropdown(location: 'tabBar' | 'compact')}
  <DropdownMenu
    bind:open={panelActionsMenuOpen[location]}
    align="end"
    side="bottom"
    contentClass="panel-actions-menu-content w-72 [&_[data-slot=menu-command-item]>kbd]:text-muted-foreground"
  >
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
          <KebabIcon class="pointer-events-none size-3.5!" />
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
        <Menu.CommandItem
          icon={faArrowLeft}
          label={m.layout_panelTabBar_moveLeft_label()}
          disabled={!onMoveLeft}
          onclick={() => {
            onMoveLeft?.();
            close();
          }}
        />
        <Menu.CommandItem
          icon={faArrowRight}
          label={m.layout_panelTabBar_moveRight_label()}
          disabled={!onMoveRight}
          onclick={() => {
            onMoveRight?.();
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
          icon={faArrowLeft}
          label={m.layout_panelTabBar_movePaneLeft_label()}
          shortcut={movePaneLeftShortcutHint}
          disabled={!onMovePaneLeft}
          onclick={() => {
            onMovePaneLeft?.();
            close();
          }}
        />
        <Menu.CommandItem
          icon={faArrowRight}
          label={m.layout_panelTabBar_movePaneRight_label()}
          shortcut={movePaneRightShortcutHint}
          disabled={!onMovePaneRight}
          onclick={() => {
            onMovePaneRight?.();
            close();
          }}
        />
        <Menu.CommandItem
          icon={faTableColumns}
          label={m.layout_panelTabBar_splitRight_label()}
          shortcut={createColumnRightShortcutHint}
          disabled={!onSplitHorizontal}
          onclick={() => {
            onSplitHorizontal?.();
            close();
          }}
        />
      </div>

      <Menu.Separator />

      <div class="type-caption px-2 pb-0.5 pt-1.5 font-medium text-muted-foreground">
        {m.settings_section_openIn()}
      </div>
      <div data-panel-actions-section="open-in">
        {#if activeTab}
          {@const externalTarget = getPanelExternalOpenTarget(
            activeTab,
            workspaceId,
            $isWorkspaceHostLocal$,
          )}
          {#if externalTarget.kind === 'browser'}
            <Menu.CommandItem
              icon={faArrowUpRightFromSquare}
              label={m.layout_panelTabBar_openInBrowser_label()}
              onclick={() => {
                openInExternalBrowser(activeTab);
                close();
              }}
            />
          {:else if externalTarget.kind === 'path'}
            {#await import('$features/workspace/components/WorkspaceActionsMenu.svelte') then module}
              {@const WorkspaceActionsMenu = module.default}
              <WorkspaceActionsMenu
                filePath={externalTarget.filePath}
                workspaceId={externalTarget.workspaceId}
                isDirectory={externalTarget.isDirectory}
                isDiff={externalTarget.isDiff ?? false}
                isWorkspaceRoot={externalTarget.isWorkspaceRoot ?? false}
                workspaceFolderPath={externalTarget.workspaceFolderPath ?? ''}
                showDeleteOption={false}
                showArchiveOption={false}
                showFileNameCopy={false}
                onClose={close}
              />
            {/await}
          {:else}
            <Menu.CommandItem
              icon={faArrowUpRightFromSquare}
              label={m.ui_fileActions_noRepoPath_tooltip()}
              disabled
            />
          {/if}
        {/if}
      </div>
    {/snippet}
  </DropdownMenu>
{/snippet}

{#snippet addPanelColumnButton()}
  {@const atColumnLimit = $panelColumnCount$ === 4}
  <Button
    variant="ghost-light"
    size="icon-sm"
    class="aria-disabled:pointer-events-auto"
    aria-label={atColumnLimit
      ? m.workspace_sidebarHeader_panelColumns_addLimit_ariaLabel({ count: 4 })
      : m.workspace_sidebarHeader_panelColumns_add_ariaLabel()}
    aria-disabled={atColumnLimit}
    tooltip={atColumnLimit
      ? m.workspace_sidebarHeader_panelColumns_addLimit_tooltip({ count: 4 })
      : m.workspace_sidebarHeader_panelColumns_add_tooltip({
          modifier: addColumnLinkModifierHint,
        })}
    tooltipSide="bottom"
    tooltipDelayDuration={300}
    onclick={handleAddPanelColumn}
    data-add-panel-column
  >
    <Fa icon={faPlus} size="xs" />
  </Button>
{/snippet}

{#snippet contentActionsDivider()}
  {#if contentActions?.primary}
    <span
      class="mx-1 h-4 border-l border-border"
      aria-hidden="true"
      data-panel-content-actions-divider
    ></span>
  {/if}
{/snippet}

{#snippet panelControlsDivider()}
  <span
    class="mx-1 h-4 border-l border-border"
    aria-hidden="true"
    data-panel-content-actions-divider
    data-panel-controls-divider
  ></span>
{/snippet}

{#snippet panelCloseButton(tab: PanelTab | null = null)}
  {#if (tab && onTabClose) || (!tab && onClosePanel)}
    {@const isOwnedBrowser = tab?.type === 'browser' && tab.ownerAgentId}
    {@const closeLabel = tab
      ? isOwnedBrowser
        ? m.layout_panelTabBar_hideOwnedTab_ariaLabel()
        : m.layout_panelTabBar_closePane_ariaLabel()
      : m.layout_panelTabBar_closePanel_label()}
    {@const closeTooltip =
      tab && !isOwnedBrowser
        ? m.layout_panelTabBar_actionWithShortcut_tooltip({
            label: closeLabel,
            shortcut: closePaneShortcutHint,
          })
        : closeLabel}
    <Tooltip content={closeTooltip} side="bottom" delayDuration={300}>
      <Button
        variant="ghost-light"
        size="icon-sm"
        onclick={() => (tab ? onTabClose?.(tab.id) : onClosePanel?.())}
        aria-label={closeLabel}
        data-testid="panel-close-button"
        data-pane-close={tab?.id}
      >
        <Fa icon={faXmark} size={14} class="size-3.5!" />
      </Button>
    </Tooltip>
  {/if}
{/snippet}

{#snippet panelIdentity(tab: PanelTab, compact = false)}
  {@const resourceKind = getResourceIconKind(tab.type)}
  {#if tab.type === 'agent'}
    <Fa
      icon={faComment}
      size={compact ? 14 : 16}
      class="shrink-0 text-muted-foreground"
      data-panel-agent-chat-glyph
    />
  {:else if resourceKind}
    <ResourceIconTile kind={resourceKind} variant={compact ? 'standard' : 'emphasized'} />
  {:else if tab.type === 'browser'}
    <BrowserFavicon faviconUrl={tab.faviconUrl} size={compact ? 14 : 16} />
  {:else}
    <Fa
      icon={getTabIcon(tab.type)}
      size={compact ? 14 : 16}
      class="shrink-0 text-muted-foreground"
    />
  {/if}
{/snippet}

{#snippet paneStackSelector()}
  <span class="pane-stack-selector relative z-10 shrink-0 self-center">
    <Menu.Root bind:open={paneStackMenuOpen}>
      <Menu.Trigger>
        {#snippet child({ props })}
          {@const selectorLabel = m.layout_panelTabBar_paneSelector_ariaLabel({
            count: tabs.length,
          })}
          <Tooltip content={selectorLabel} side="bottom" delayDuration={300}>
            <Button
              {...props}
              variant="plain"
              size="icon-sm"
              iconOnly
              class={cn(
                'relative flex size-7 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground shadow-none outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                inactiveAttentionCount > 0 && 'text-foreground',
              )}
              aria-label={selectorLabel}
              data-testid="pane-stack-selector-trigger"
              data-pane-stack-selector-trigger
              data-attention={inactiveAttentionCount > 0 ? '' : undefined}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
                class="pane-stack-glyph size-3.5! shrink-0"
                data-pane-stack-glyph
                data-pane-stack-visible-lines={Math.min(tabs.length, MAX_VISIBLE_PANE_STACK_LINES)}
                data-pane-stack-total={tabs.length}
              >
                {#each Array.from({ length: Math.min(tabs.length, MAX_VISIBLE_PANE_STACK_LINES) }, (_, index) => index + 1) as line (line)}
                  {@const targetY = PANE_STACK_LINE_BOTTOM_Y - (line - 1) * PANE_STACK_LINE_GAP}
                  {@const offset = line * PANE_STACK_LINE_GAP}
                  <g
                    transition:paneStackLineMotion={{ offset }}
                    data-pane-stack-line={line}
                    data-pane-stack-line-target-y={targetY}
                    data-pane-stack-line-transition-offset={offset}
                  >
                    <line
                      x1="2"
                      x2="12"
                      y1={targetY}
                      y2={targetY}
                      stroke="currentColor"
                      stroke-width="1.25"
                      stroke-linecap="round"
                      vector-effect="non-scaling-stroke"
                    />
                  </g>
                {/each}
              </svg>
              {#if inactiveAttentionCount > 0}
                <span
                  class="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                ></span>
              {/if}
            </Button>
          </Tooltip>
        {/snippet}
      </Menu.Trigger>
      <Menu.Content
        align="start"
        side="bottom"
        collisionPadding={8}
        class="w-64 max-w-[calc(100vw-1rem)] p-1.5"
        maxHeight="min(28rem, calc(100dvh - 1rem))"
        aria-label={m.layout_panelTabBar_paneMenu_ariaLabel()}
        data-pane-stack-menu
      >
        <Menu.CommandItem
          icon={faArrowUp}
          label={m.layout_panelTabBar_openPaneAbove_label()}
          shortcut={previousPaneShortcutHint}
          disabled={!previousPane}
          onclick={() => previousPane && activatePane(previousPane.id)}
          data-pane-stack-open-above
        />
        <Menu.CommandItem
          icon={faArrowDown}
          label={m.layout_panelTabBar_openPaneBelow_label()}
          shortcut={nextPaneShortcutHint}
          disabled={!nextPane}
          onclick={() => nextPane && activatePane(nextPane.id)}
          data-pane-stack-open-below
        />
        <Menu.Separator />
        <div class="max-h-64 overflow-y-auto overscroll-contain" data-pane-stack-list>
          {#each tabs as tab (tab.id)}
            {@const current = tab.id === activeTabId}
            <Menu.Item
              class={cn('min-h-8', current && 'bg-accent/60 text-accent-foreground')}
              aria-current={current ? 'page' : undefined}
              aria-label={attentionPaneIds.has(tab.id)
                ? m.layout_panelTabBar_paneMenuAttention_ariaLabel({ title: getTabTitle(tab) })
                : getTabTitle(tab)}
              onclick={() => activatePane(tab.id)}
              data-pane-stack-item={tab.id}
              data-attention={attentionPaneIds.has(tab.id) ? '' : undefined}
            >
              <span
                class="flex size-5 shrink-0 items-center justify-center"
                data-pane-stack-item-identity={tab.type}
              >
                {#if tab.type === 'agent' && tab.agentId}
                  <AgentAvatar agentId={tab.agentId} variant="standard" />
                {:else}
                  {@render panelIdentity(tab, true)}
                {/if}
              </span>
              <span class="min-w-0 flex-1 truncate">{getTabTitle(tab)}</span>
              {#if attentionPaneIds.has(tab.id)}
                <span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
              {/if}
              {#if current}
                <span
                  class="flex size-4 shrink-0 items-center justify-center"
                  aria-hidden="true"
                  data-pane-stack-current-check
                >
                  <Fa icon={faCheck} size="xs" class="text-primary" />
                </span>
              {/if}
            </Menu.Item>
          {/each}
        </div>
      </Menu.Content>
    </Menu.Root>
  </span>
{/snippet}

<svelte:window onkeydown={handlePaneDragKeyDown} />

<!-- Tab bar + Header wrapper -->
<div class="panel-tab-wrapper flex flex-col">
  <!-- Tab bar (traditional tabs) -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={tabBarRef}
    class={cn(
      'panel-tab-bar group/tabbar relative flex items-center h-[var(--panel-header-height)] bg-card',
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
              {#if tab.type === 'agent'}
                <Fa
                  icon={faComment}
                  size={16}
                  class="shrink-0 text-muted-foreground"
                  data-panel-agent-chat-glyph
                />
              {:else if resourceKind}
                <ResourceIconTile kind={resourceKind} />
              {:else if tab.type === 'browser'}
                <BrowserFavicon
                  faviconUrl={tab.faviconUrl}
                  size={16}
                  fallbackClass="tab-icon opacity-50"
                />
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
                  title={isAgentOwnedBrowserPane(tab)
                    ? m.layout_panelTabBar_hideOwnedTab_tooltip()
                    : undefined}
                  aria-label={isAgentOwnedBrowserPane(tab)
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
            <!-- i18n-ignore (Svelte snippet signature, not user-facing text) -->
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
                    <AgentAvatar agentId="blank" variant="compact" />
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
                      <AgentAvatar
                        agentId="blank"
                        variant="compact"
                        specialist={specialist.id}
                        icon={specialist.icon}
                      />
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
        {@render panelActionsDropdown('tabBar')}
        {@render contentActionsDivider()}
        {@render contentActions?.primary?.()}
        {@render panelCloseButton(activeTab)}
      </div>
    </div>
  </div>

  <!-- Compact header bar (breadcrumb style) -->
  {#if activeTab}
    {@const activeTabPath = getTabPath(activeTab)}
    {@const activeTabTitle = getTabTitle(activeTab)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'panel-header group/header relative flex h-[var(--panel-header-height)] cursor-grab items-center bg-card pr-2.5 active:cursor-grabbing',
        isFocused && 'focused',
      )}
      data-column-focused={isFocused ? '' : undefined}
      oncontextmenu={handlePanelContextMenu}
      ondblclick={handlePanelHeaderDoubleClick}
      draggable="true"
      ondragstart={handlePaneDragStart}
      ondragend={handlePaneDragEnd}
      data-panel-tabless-header
      data-panel-content-header
      role="group"
      aria-label={m.layout_panelTabBar_paneStack_ariaLabel({ count: tabs.length })}
      data-pane-stack
      data-pane-stack-size={tabs.length}
    >
      {#if activeTab.type === 'agent'}
        <!-- Agent headers keep the current avatar and editable name. -->
        <div
          class="flex min-w-0 shrink items-center gap-2 bg-card pl-1"
          aria-label={m.layout_panelTabBar_activePane_ariaLabel({
            title: activeTabTitle,
            position: panePosition(activeTab.id),
            count: tabs.length,
          })}
          aria-current="true"
          data-pane-stack-active={activeTab.id}
          data-attention={attentionPaneIds.has(activeTab.id) ? '' : undefined}
          data-panel-agent-header-identity
        >
          <span
            class="panel-header-leading-surface flex size-6 shrink-0 items-center justify-center self-center"
            data-testid="panel-header-agent-avatar-slot"
            data-panel-header-leading-surface
          >
            {#if activeTab.agentId}
              {#key activeTab.agentId}
                <PanelHeaderAgentAvatar agentId={activeTab.agentId} />
              {/key}
            {/if}
          </span>
          <div class="panel-header-title min-w-0 shrink" data-panel-header-title>
            {#if onTabRename}
              <EditableName
                value={activeTabTitle}
                onSave={(newName) => handleTabRename(activeTab, newName)}
                textClass="text-sm shrink font-medium {isFocused
                  ? 'text-foreground'
                  : 'text-subtle'}"
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
        </div>
      {:else}
        <!-- Non-agent panes retain the current flat identity and complete selector. -->
        <div
          class="pane-stack-control flex min-w-0 shrink items-center overflow-hidden"
          data-panel-header-identity
        >
          <div
            class="pane-stack-active flex min-w-0 shrink items-center gap-2 overflow-hidden bg-card pl-1"
            aria-label={m.layout_panelTabBar_activePane_ariaLabel({
              title: activeTabTitle,
              position: panePosition(activeTab.id),
              count: tabs.length,
            })}
            aria-current="true"
            data-pane-stack-active={activeTab.id}
            data-attention={attentionPaneIds.has(activeTab.id) ? '' : undefined}
          >
            <span
              class="panel-header-leading-surface flex size-6 shrink-0 items-center justify-center self-center"
              data-panel-header-leading-surface
            >
              {@render panelIdentity(activeTab)}
            </span>
            <!-- Single content title; type/category is conveyed by the content itself. -->
            <div class="panel-header-title min-w-0 shrink" data-panel-header-title>
              {#if isTabRenameable(activeTab) && onTabRename}
                <EditableName
                  value={activeTabTitle}
                  onSave={(newName) => handleTabRename(activeTab, newName)}
                  textClass="text-sm shrink font-medium {isFocused
                    ? 'text-foreground'
                    : 'text-subtle'}"
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

            {#if attentionPaneIds.has(activeTab.id)}
              <span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
            {/if}
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
        </div>
      {/if}

      <div class="min-w-0 flex-1" aria-hidden="true"></div>

      <!-- Right: all actions at the far edge in stable order. -->
      <div class="flex shrink-0 items-center gap-0" data-panel-header-actions>
        {#if contentActions?.primary}
          <span class="flex items-center" data-panel-header-content-actions>
            {@render contentActions.primary()}
          </span>
        {/if}
        {@render panelActionsDropdown('compact')}
        {@render panelControlsDivider()}
        {#if tabs.length > 1}
          {@render paneStackSelector()}
        {/if}
        {@render addPanelColumnButton()}
        {@render panelCloseButton(activeTab)}
      </div>
    </div>
  {:else}
    <div
      class={cn(
        'panel-header group/header relative flex items-center bg-sidebar pr-2.5',
        isFocused && 'focused',
      )}
      style:height="var(--panel-header-height)"
      data-column-focused={isFocused ? '' : undefined}
      data-panel-tabless-header
      data-empty-panel-header
    >
      <div class="min-w-0 flex-1" aria-hidden="true"></div>
      <div class="flex shrink-0 items-center gap-0" data-panel-header-actions>
        {@render addPanelColumnButton()}
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
        {#if contextMenuTab.source === 'panel'}
          <Button
            variant="ghost-light"
            size="sm"
            class="h-auto w-full justify-start rounded-none px-3 py-1.5 text-left"
            disabled={!onMoveLeft}
            onclick={() => {
              onMoveLeft?.();
              closeContextMenu();
            }}
          >
            <Fa icon={faArrowLeft} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_moveLeft_label()}
          </Button>
          <Button
            variant="ghost-light"
            size="sm"
            class="h-auto w-full justify-start rounded-none px-3 py-1.5 text-left"
            disabled={!onMoveRight}
            onclick={() => {
              onMoveRight?.();
              closeContextMenu();
            }}
          >
            <Fa icon={faArrowRight} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_moveRight_label()}
          </Button>
          <div class="border-t border-border"></div>
        {/if}
        <Button
          variant="ghost-light"
          size="sm"
          class="h-auto w-full justify-between rounded-none px-3 py-1.5 text-left"
          disabled={!onMovePaneLeft}
          onclick={() => {
            onMovePaneLeft?.();
            closeContextMenu();
          }}
        >
          <span class="flex items-center gap-2">
            <Fa icon={faArrowLeft} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_movePaneLeft_label()}
          </span>
          <span class="text-subtle text-xs">{movePaneLeftShortcutHint}</span>
        </Button>
        <Button
          variant="ghost-light"
          size="sm"
          class="h-auto w-full justify-between rounded-none px-3 py-1.5 text-left"
          disabled={!onMovePaneRight}
          onclick={() => {
            onMovePaneRight?.();
            closeContextMenu();
          }}
        >
          <span class="flex items-center gap-2">
            <Fa icon={faArrowRight} size="xs" class="text-ghost" />
            {m.layout_panelTabBar_movePaneRight_label()}
          </span>
          <span class="text-subtle text-xs">{movePaneRightShortcutHint}</span>
        </Button>
        <div class="border-t border-border"></div>
        <button
          class="w-full px-3 py-1.5 text-sm text-left hover:bg-sidebar cursor-pointer flex items-center justify-between disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!onSplitHorizontal}
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
          <span class="text-subtle text-xs">{createColumnRightShortcutHint}</span>
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
            <span class="text-subtle text-xs">{closePaneShortcutHint}</span>
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
  :global(.panel-actions-menu-content) {
    min-width: min(14rem, calc(100vw - 1rem));
    max-width: calc(100vw - 1rem);
  }

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

  .pane-stack-glyph {
    color: currentColor;
    overflow: visible;
  }

  @media (forced-colors: active) {
    .pane-stack-glyph {
      color: CanvasText;
      forced-color-adjust: auto;
    }
  }
</style>
