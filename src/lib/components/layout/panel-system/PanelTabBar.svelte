<script lang="ts">
  import { observeOverflow } from '$lib/actions/observe-overflow';

  let selectorTitleOverflow = $state(false);
  let tabTitleOverflow = $state<Record<string, boolean>>({});
  import { Input } from '$lib/components/ui/input';
  /* eslint-disable max-lines */
  /**
   * PanelTabBar - Compact header bar for a panel
   *
   * Displays the active icon/title as a pane selector, with content and layout
   * commands in the action menu and a separate close button.
   */

  import type { PanelTab } from '$features/layout/panel-layout-adapter';
  import { cn } from '$lib/utils';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import {
    faXmark,
    faFile,
    faCrosshairs,
    faCopy,
    faFolderOpen,
    faArrowUpRightFromSquare,
    faExpand,
    faCompress,
    faTableColumns,
    faArrowLeft,
    faArrowRight,
    faCheck,
    faComment,
  } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { notify } from '$lib/components/patterns/notify';
  import { locateItemInSidebarRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import Fa from 'svelte-fa';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { onDestroy, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { selectIsDragging } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { startDrag, endDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { toggleExpandPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    PANE_DRAG_MIME,
    clearDraggedPaneState,
    createPaneDragImage,
    getDraggedPane,
    setDraggedPane,
  } from './panel-drag';

  import { isSpecNote } from '$shared/constants/notes';

  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import PanelHeaderAgentAvatar from './PanelHeaderAgentAvatar.svelte';
  import BrowserFavicon from './BrowserFavicon.svelte';
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
  import { getResourceIconKind } from '$lib/components/shared/resource-icon';
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
  const canOpenExternalEditors = hasCapability('externalEditors');
  const copyBrowserUrlShortcut$ = effectiveShortcutReadable('panel.copy-browser-url');
  const closePaneShortcut$ = effectiveShortcutReadable('navigation.close-tab');
  const zoomPanelShortcut$ = effectiveShortcutReadable('panel.maximize');
  const createColumnRightShortcut$ = effectiveShortcutReadable('panel.create-column-right');
  const movePaneLeftShortcut$ = effectiveShortcutReadable('panel.move-pane-previous-column');
  const movePaneRightShortcut$ = effectiveShortcutReadable('panel.move-pane-next-column');
  const copyBrowserUrlShortcutHint = $derived(formatShortcut($copyBrowserUrlShortcut$));
  const closePaneShortcutHint = $derived(formatShortcut($closePaneShortcut$));
  const createColumnRightShortcutHint = $derived(formatShortcut($createColumnRightShortcut$));
  const movePaneLeftShortcutHint = $derived(formatShortcut($movePaneLeftShortcut$));
  const movePaneRightShortcutHint = $derived(formatShortcut($movePaneRightShortcut$));
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
    onMovePaneUp?: () => void;
    onMovePaneDown?: () => void;
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
    isFocused = false,
    isRightmostPanel: _isRightmostPanel = false,
    contentActions = null,
    showTabStrip = false,
    onTabClick,
    onTabClose,
    onTabReorder,
    onTabMoveToPanel,
    onPaneDragFinish,
    onMovePaneUp,
    onMovePaneDown,
    onMovePaneLeft,
    onMovePaneRight,
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
  let contextMenuTab = $state<(SidebarContextPosition & { tabId: string }) | null>(null);
  const contextTab = $derived(tabs.find((tab) => tab.id === contextMenuTab?.tabId));

  let paneStackMenuOpen = $state(false);
  let panelActionsMenuOpen = $state({ tabBar: false, compact: false });
  const pendingPaneMoves: Record<'tabBar' | 'compact', (() => void) | null> = {
    tabBar: null,
    compact: null,
  };

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
  $effect(() => {
    workspaceIdStore.set(workspaceId);
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
      const note = selectNoteById.select(
        appStore.state,
        tab.workspaceId ?? workspaceId,
        tab.noteId,
      );
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
    // A browser tab's title is canonical registry data; none yet shows the label.
    if (tab.type === 'browser') return tab.title || m.layout_panelLayout_browser_fallback();
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
  const paneMoveDirections = $derived([
    {
      direction: 'up',
      label: m.layout_panelTabBar_movePanelUp_label(),
      enabled: !!onMovePaneUp,
      move: () => onMovePaneUp?.(),
    },
    {
      direction: 'right',
      label: m.layout_panelTabBar_movePanelRight_label(),
      enabled: !!onMovePaneRight,
      move: () => onMovePaneRight?.(),
    },
    {
      direction: 'down',
      label: m.layout_panelTabBar_movePanelDown_label(),
      enabled: !!onMovePaneDown,
      move: () => onMovePaneDown?.(),
    },
    {
      direction: 'left',
      label: m.layout_panelTabBar_movePanelLeft_label(),
      enabled: !!onMovePaneLeft,
      move: () => onMovePaneLeft?.(),
    },
  ]);

  function activatePane(tabId: string) {
    handleTabClick(tabId);
    paneStackMenuOpen = false;
  }

  function handleTabClose(e: MouseEvent, tabId: string) {
    e.stopPropagation();
    onTabClose?.(tabId);
  }

  function handleTabContextMenu(e: MouseEvent | KeyboardEvent, tabId: string) {
    const position = getSidebarContextPosition(e);
    if (!position) return;
    panelActionsMenuOpen.tabBar = false;
    panelActionsMenuOpen.compact = false;
    contextMenuTab = { tabId, ...position };
  }

  function handlePanelContextMenu(e: MouseEvent) {
    const target = e.target;
    if (target instanceof Element && target.closest(PANEL_HEADER_INTERACTIVE_SELECTOR)) return;
    e.preventDefault();
    contextMenuTab = null;
    panelActionsMenuOpen.compact = true;
  }

  function closeContextMenu() {
    contextMenuTab = null;
  }

  const tabContextItems: SidebarMenuEntry[] = $derived.by(() => {
    const tab = contextTab;
    if (!tab) return [];
    const items: SidebarMenuEntry[] = [];
    if (canLocateInSidebar(tab)) {
      items.push({
        id: 'locate',
        label: m.layout_panelTabBar_revealInSidebar_label(),
        icon: faCrosshairs,
        onClick: () => handleLocateInSidebar(tab),
      });
    }
    const pathActions =
      tab.type === 'file' || tab.type === 'diff'
        ? {
            relative: copyRelativePath,
            absolute: copyAbsolutePath,
            filename: copyFileName,
            reveal: revealInFinder,
          }
        : tab.type === 'agent'
          ? {
              relative: copyAgentRelativePath,
              absolute: copyAgentAbsolutePath,
              filename: copyAgentFileName,
              reveal: revealAgentInFinder,
            }
          : tab.type === 'note'
            ? {
                relative: copyNoteRelativePath,
                absolute: copyNoteAbsolutePath,
                filename: copyNoteFileName,
                reveal: revealNoteInFinder,
              }
            : null;
    if (pathActions) {
      items.push(
        {
          id: 'copy-relative-path',
          label: m.layout_panelTabBar_copyRelativePath_label(),
          icon: faCopy,
          onClick: () => void pathActions.relative(tab),
        },
        {
          id: 'copy-absolute-path',
          label: m.layout_panelTabBar_copyAbsolutePath_label(),
          icon: faCopy,
          onClick: () => void pathActions.absolute(tab),
        },
        {
          id: 'copy-filename',
          label: m.layout_panelTabBar_copyFilename_label(),
          icon: faCopy,
          onClick: () => void pathActions.filename(tab),
        },
      );
      if ($isWorkspaceHostLocal$)
        items.push({
          id: 'reveal-file',
          label: m.layout_panelTabBar_revealIn_label({ fileManager: fileManagerName }),
          icon: faFolderOpen,
          onClick: () => void pathActions.reveal(tab),
        });
    } else if (tab.type === 'browser' && tab.browserUrl) {
      items.push(
        {
          id: 'copy-url',
          label: m.layout_panelTabBar_copyUrl_label(),
          icon: faCopy,
          shortcut: copyBrowserUrlShortcutHint,
          onClick: () => void copyBrowserUrl(tab),
        },
        {
          id: 'open-browser',
          label: m.layout_panelTabBar_openInBrowser_label(),
          icon: faArrowUpRightFromSquare,
          onClick: () => void openInExternalBrowser(tab),
        },
      );
    } else if (tab.type === 'terminal') {
      items.push({
        id: 'copy-terminal-name',
        label: m.layout_panelTabBar_copyTerminalName_label(),
        icon: faCopy,
        onClick: () => void copyTabTitle(tab),
      });
    }
    items.push(
      { type: 'separator' },
      {
        id: 'zoom-panel',
        label: isZoomed
          ? m.layout_panelTabBar_unzoomPanel_label()
          : m.layout_panelTabBar_zoomPanel_label(),
        icon: isZoomed ? faCompress : faExpand,
        shortcut: formatShortcut($zoomPanelShortcut$),
        disabled: !onZoomToggle,
        onClick: () => onZoomToggle?.(),
      },
      {
        id: 'move-panel-left',
        label: m.layout_panelTabBar_movePanelLeft_label(),
        icon: faArrowLeft,
        shortcut: movePaneLeftShortcutHint,
        disabled: !onMovePaneLeft,
        onClick: () => onMovePaneLeft?.(),
      },
      {
        id: 'move-panel-right',
        label: m.layout_panelTabBar_movePanelRight_label(),
        icon: faArrowRight,
        shortcut: movePaneRightShortcutHint,
        disabled: !onMovePaneRight,
        onClick: () => onMovePaneRight?.(),
      },
      {
        id: 'split-panel',
        label: m.layout_panelTabBar_splitRight_label(),
        icon: faTableColumns,
        shortcut: createColumnRightShortcutHint,
        disabled: !onSplitHorizontal,
        onClick: () => onSplitHorizontal?.(),
      },
      { type: 'separator' },
      {
        id: 'close-tab',
        label: m.layout_panelTabBar_close_label(),
        shortcut: closePaneShortcutHint,
        disabled: !onTabClose || tab.closable === false,
        onClick: () => onTabClose?.(tab.id),
      },
      {
        id: 'close-other-tabs',
        label: m.layout_panelTabBar_closeOtherTabs_label(),
        disabled: !onCloseOtherTabs,
        onClick: () => onCloseOtherTabs?.(tab.id),
      },
      {
        id: 'close-tabs-right',
        label: m.layout_panelTabBar_closeTabsToRight_label(),
        disabled: !onCloseTabsToRight,
        onClick: () => onCloseTabsToRight?.(tab.id),
      },
      {
        id: 'close-panel',
        label: m.layout_panelTabBar_closePanel_label(),
        disabled: !onClosePanel,
        onClick: () => onClosePanel?.(),
      },
      {
        id: 'close-all-others',
        label: m.layout_panelTabBar_closeAllOthers_label(),
        disabled: !onCloseAllOthersEverywhere,
        onClick: () => onCloseAllOthersEverywhere?.(tab.id),
      },
    );
    return items;
  });

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
      notify.success(m.layout_panelTabBar_pathCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyPathFailed_error());
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
      notify.success(m.layout_panelTabBar_absolutePathCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyPathFailed_error());
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
      notify.success(m.layout_panelTabBar_filenameCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyFilenameFailed_error());
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
      notify.error(m.layout_panelTabBar_revealFailed_error({ fileManager: fileManagerName }));
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
      notify.success(m.layout_panelTabBar_pathCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy the absolute path of an agent session file
   */
  async function copyAgentAbsolutePath(tab: PanelTab) {
    const absolutePath = await getAgentSessionAbsolutePath(tab);
    if (!absolutePath) {
      notify.error(m.layout_panelTabBar_agentPathUnresolved_error());
      return;
    }
    try {
      await navigator.clipboard.writeText(toNativePath(absolutePath));
      notify.success(m.layout_panelTabBar_absolutePathCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy just the filename of an agent session file
   */
  async function copyAgentFileName(tab: PanelTab) {
    const fileName = `${tab.agentId}.json`;
    try {
      await navigator.clipboard.writeText(fileName);
      notify.success(m.layout_panelTabBar_filenameCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyFilenameFailed_error());
    }
  }

  /**
   * Reveal an agent session file in the system file manager (Finder on macOS)
   */
  async function revealAgentInFinder(tab: PanelTab) {
    const absolutePath = await getAgentSessionAbsolutePath(tab);
    if (!absolutePath) {
      notify.error(m.layout_panelTabBar_agentPathUnresolved_error());
      return;
    }
    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch {
      notify.error(m.layout_panelTabBar_revealFailed_error({ fileManager: fileManagerName }));
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
      notify.success(m.layout_panelTabBar_pathCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy the absolute path of a note file
   */
  async function copyNoteAbsolutePath(tab: PanelTab) {
    const absolutePath = await getNoteAbsolutePath(tab);
    if (!absolutePath) {
      notify.error(m.layout_panelTabBar_notePathUnresolved_error());
      return;
    }
    try {
      await navigator.clipboard.writeText(toNativePath(absolutePath));
      notify.success(m.layout_panelTabBar_absolutePathCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyPathFailed_error());
    }
  }

  /**
   * Copy just the filename of a note file
   */
  async function copyNoteFileName(tab: PanelTab) {
    const fileName = `${tab.noteId}.md`;
    try {
      await navigator.clipboard.writeText(fileName);
      notify.success(m.layout_panelTabBar_filenameCopied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyFilenameFailed_error());
    }
  }

  /**
   * Reveal a note file in the system file manager (Finder on macOS)
   */
  async function revealNoteInFinder(tab: PanelTab) {
    const absolutePath = await getNoteAbsolutePath(tab);
    if (!absolutePath) {
      notify.error(m.layout_panelTabBar_notePathUnresolved_error());
      return;
    }
    try {
      await invoke('shell:showItemInFolder', { path: absolutePath });
    } catch {
      notify.error(m.layout_panelTabBar_revealFailed_error({ fileManager: fileManagerName }));
    }
  }

  /**
   * Copy the browser URL to the clipboard
   */
  async function copyBrowserUrl(tab: PanelTab) {
    if (!tab.browserUrl) return;
    try {
      await writeTextToClipboard(tab.browserUrl);
      notify.success(m.layout_panelTabBar_urlCopied_label());
    } catch (error) {
      logger.error('Failed to copy browser tab URL', error, { url: tab.browserUrl });
      notify.error(m.layout_panelTabBar_copyUrlFailed_error());
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
      notify.error(m.layout_panelTabBar_openInBrowserFailed_error());
    }
  }

  /**
   * Copy the tab title to the clipboard (useful for agents, notes, etc.)
   */
  async function copyTabTitle(tab: PanelTab) {
    const title = getTabTitle(tab);
    try {
      await navigator.clipboard.writeText(title);
      notify.success(m.layout_panelTabBar_copied_label());
    } catch {
      notify.error(m.layout_panelTabBar_copyFailed_error());
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
   * Start inline renaming from a tab or the panel action menu
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
        onTabRename?.(tab, trimmed);
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
  function handleLocateInSidebar(tab: PanelTab) {
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
    onOpenChangeComplete={async (open) => {
      if (open) return;
      const move = pendingPaneMoves[location];
      pendingPaneMoves[location] = null;
      if (!move) return;
      // Remove the portalled menu before a move can unmount its owner.
      await tick();
      move();
    }}
    align="end"
    side="bottom"
    contentClass="panel-header-menu panel-actions-menu-content bg-background"
    subContentClass="panel-header-menu panel-header-submenu bg-background"
  >
    <!-- i18n-ignore -->
    {#snippet trigger({ props }: { props: Record<string, unknown> })}
      <Button
        {...props}
        variant="ghost-light"
        size="icon-sm"
        wrapContent={false}
        aria-label={m.ui_breadcrumb_more_label()}
        class="panel-header-action-button"
        data-testid="panel-actions-trigger"
      >
        <KebabIcon class="size-4!" />
      </Button>
    {/snippet}
    {#snippet content({ close }: { close: () => void })}
      {#if activeTab && isTabRenameable(activeTab) && onTabRename}
        <Menu.CommandItem
          label={m.workspace_notes_rename_label()}
          onclick={async () => {
            const tab = activeTab;
            close();
            // Let the menu restore trigger focus before mounting the editor.
            await tick();
            await startInlineRename(tab);
          }}
        />
        <Menu.Separator />
      {/if}
      {#if contentActions?.display}
        <Menu.Group data-panel-actions-section="display">
          {@render contentActions.display()}
        </Menu.Group>
        <Menu.Separator />
      {/if}
      {#if contentActions?.primary || contentActions?.actions || contentActions?.destructive}
        <Menu.Group data-panel-actions-section="actions">
          <Menu.Label>{m.layout_panelTabBar_actionsSection_label()}</Menu.Label>
          {@render contentActions.primary?.()}
          {@render contentActions.actions?.()}
          {@render contentActions.destructive?.()}
        </Menu.Group>
        {#if paneMoveDirections.some((direction) => direction.enabled)}
          <Menu.Separator />
        {/if}
      {/if}
      {#if paneMoveDirections.some((direction) => direction.enabled)}
        <Menu.Group data-panel-actions-section="move">
          <Menu.Label>{m.layout_panelTabBar_movePanel_label()}</Menu.Label>
          <div class="panel-move-pad">
            {#each paneMoveDirections as direction (direction.direction)}
              <Menu.Item
                class="panel-move-direction panel-move-{direction.direction}"
                aria-label={direction.label}
                disabled={!direction.enabled}
                onSelect={() => {
                  pendingPaneMoves[location] = direction.move;
                  close();
                }}
              >
                <svg viewBox="0 0 16 16" fill="none" class="size-4!" aria-hidden="true">
                  <g transform="rotate(-90 8 8)" stroke="currentColor" stroke-width="1.33">
                    <path d="M3 8H12" stroke-linecap="square" />
                    <path
                      d="M8.518 3 12.634 7.116C13.122 7.604 13.122 8.396 12.634 8.884L8.518 13"
                      stroke-linejoin="round"
                    />
                  </g>
                </svg>
              </Menu.Item>
            {/each}
          </div>
        </Menu.Group>
      {/if}
      {#if ($isWorkspaceHostLocal$ && canOpenExternalEditors) || activeTab?.type === 'browser'}
        {#if activeTab}
          {@const externalTarget = getPanelExternalOpenTarget(
            activeTab,
            workspaceId,
            $isWorkspaceHostLocal$,
          )}
          <Menu.Separator />
          <div data-panel-actions-section="open-in">
            {#if externalTarget.kind === 'browser'}
              <Menu.CommandItem
                icon={faArrowUpRightFromSquare}
                label={m.layout_panelTabBar_openInBrowser_label()}
                iconWeight="regular"
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
                  showPathCopy={false}
                  showFileNameCopy={false}
                  layout="submenu"
                  iconWeight="regular"
                  onClose={close}
                />
              {/await}
            {:else}
              <Menu.CommandItem
                icon={faArrowUpRightFromSquare}
                label={m.ui_fileActions_noRepoPath_tooltip()}
                iconWeight="regular"
                disabled
              />
            {/if}
          </div>
        {/if}
      {/if}
      {#if contentActions?.additional}
        <Menu.Separator />
        <Menu.Group data-panel-actions-section="additional">
          {@render contentActions.additional(panelActionsMenuOpen[location])}
        </Menu.Group>
      {/if}
    {/snippet}
  </DropdownMenu>
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
        wrapContent={false}
        onclick={() => (tab ? onTabClose?.(tab.id) : onClosePanel?.())}
        aria-label={closeLabel}
        class="panel-header-action-button"
        data-testid="panel-close-button"
        data-pane-close={tab?.id}
      >
        <svg viewBox="0 0 16 16" fill="none" class="size-4!" aria-hidden="true">
          <path
            d="M3.5 3.5 6.5 6.5C7.328 7.328 7.328 8.672 6.5 9.5L3.5 12.5M12.5 12.5 9.5 9.5C8.672 8.672 8.672 7.328 9.5 6.5L12.5 3.5"
            stroke="currentColor"
            stroke-width="1.33"
          />
        </svg>
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
  <span
    class="pane-stack-selector relative z-10 min-w-0 shrink self-center"
    data-panel-header-identity
  >
    <Menu.Root bind:open={paneStackMenuOpen}>
      <Menu.Trigger>
        {#snippet child({ props })}
          {@const selectorLabel = activeTab
            ? m.layout_panelTabBar_paneSelectorNamed_ariaLabel({
                title: getTabTitle(activeTab),
                count: tabs.length,
              })
            : m.layout_panelTabBar_paneSelector_ariaLabel({ count: tabs.length })}
          {@const activePath = activeTab ? getTabPath(activeTab) : null}
          {@const commitHash =
            activeTab?.type === 'diff'
              ? (activeTab.data?.change as { commitHash?: string } | undefined)?.commitHash
              : undefined}
          <Tooltip
            class="block w-full min-w-0"
            content={[activeTab ? getTabTitle(activeTab) : selectorLabel, activePath, commitHash]
              .filter(Boolean)
              .join(' · ')}
            side="bottom"
            delayDuration={300}
            disabled={paneStackMenuOpen ||
              (!!activeTab && !activePath && !commitHash && !selectorTitleOverflow)}
          >
            <Button
              {...props}
              variant="plain"
              size="lg"
              class="panel-selector-button w-full min-w-0 max-w-full justify-start bg-sidebar dark:bg-muted"
              wrapContent={false}
              aria-label={selectorLabel}
              data-testid="pane-stack-selector-trigger"
              data-pane-stack-selector-trigger
              data-attention={inactiveAttentionCount > 0 ||
              (activeTab && attentionPaneIds.has(activeTab.id))
                ? ''
                : undefined}
            >
              {#if activeTab}
                <span
                  class="panel-header-leading-surface flex shrink-0 items-center justify-center"
                  data-panel-header-leading-surface
                >
                  {#if activeTab.type === 'agent' && activeTab.agentId}
                    {#key activeTab.agentId}
                      <PanelHeaderAgentAvatar agentId={activeTab.agentId} />
                    {/key}
                  {:else}
                    {@render panelIdentity(activeTab)}
                  {/if}
                </span>
                <span
                  class="panel-selector-title min-w-0 flex-1 truncate text-left"
                  use:observeOverflow={(overflow) => (selectorTitleOverflow = overflow)}
                  data-panel-header-title
                >
                  {getTabTitle(activeTab)}
                </span>
              {/if}
              <svg
                viewBox="0 0 8 14"
                fill="none"
                class="h-3.5! w-2! shrink-0 text-muted-foreground"
                aria-hidden="true"
              >
                <path
                  d="M6.532 4 4.332 1.067C3.932.533 3.132.533 2.732 1.067L.532 4M.532 10 2.732 12.933C3.132 13.467 3.932 13.467 4.332 12.933L6.532 10"
                  stroke="currentColor"
                  stroke-width="1.33"
                  stroke-linejoin="round"
                />
              </svg>
              {#if inactiveAttentionCount > 0 || (activeTab && attentionPaneIds.has(activeTab.id))}
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
        class="panel-header-menu panel-selector-menu bg-background"
        maxHeight="var(--bits-dropdown-menu-content-available-height, calc(100dvh - 1rem))"
        aria-label={m.layout_panelTabBar_paneMenu_ariaLabel()}
        data-pane-stack-menu
      >
        <div class="overflow-y-auto overscroll-contain" data-pane-stack-list>
          {#each tabs.toReversed() as tab (tab.id)}
            {@const current = tab.id === activeTabId}
            <Menu.Item
              class="panel-selector-row"
              aria-current={current ? 'page' : undefined}
              aria-label={attentionPaneIds.has(tab.id)
                ? m.layout_panelTabBar_paneMenuAttention_ariaLabel({ title: getTabTitle(tab) })
                : getTabTitle(tab)}
              onclick={() => activatePane(tab.id)}
              data-pane-stack-item={tab.id}
              data-attention={attentionPaneIds.has(tab.id) ? '' : undefined}
            >
              {#snippet leading()}
                <span
                  class="panel-selector-row-avatar flex shrink-0 items-center justify-center"
                  data-pane-stack-item-identity={tab.type}
                >
                  {#if tab.type === 'agent' && tab.agentId}
                    {#key tab.agentId}<PanelHeaderAgentAvatar agentId={tab.agentId} />{/key}
                  {:else}
                    {@render panelIdentity(tab, true)}
                  {/if}
                </span>
              {/snippet}
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
                  <Fa icon={faCheck} size="xs" class="text-muted-foreground" />
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
      'panel-tab-bar group/tabbar relative flex items-center h-[var(--panel-header-height)] bg-background',
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
          disabled={!(shortcutKey && isFocused) && !tabTitleOverflow[tab.id]}
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
            onkeydown={(e) => {
              if (e.key === 'Enter') handleTabClick(tab.id);
              else handleTabContextMenu(e, tab.id);
            }}
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
                <Input
                  bind:ref={renameInputRef}
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
                <span
                  class="tab-title font-medium truncate max-w-24"
                  use:observeOverflow={(overflow) => (tabTitleOverflow[tab.id] = overflow)}
                  >{tabTitle}</span
                >
              {/if}

              {#if isBackgroundAgent(tab)}
                <span class="text-ui font-medium text-muted-foreground bg-muted px-1 py-0.5 rounded"
                  >{m.layout_panelTabBar_bgBadge_label()}</span
                >
              {/if}

              {#if tab.hasUnsavedChanges}
                <span class="unsaved-dot w-1.5 h-1.5 rounded-full bg-primary"></span>
              {/if}

              {#if tab.closable}
                <!-- User close of an agent-owned browser tab hides it (webview
                     kept alive for the agent, monorepo#2857) — say so. -->
                <Button
                  variant="ghost-light"
                  size="icon-compact"
                  iconOnly
                  class={cn(
                    'tab-close ml-1 transition-opacity cursor-pointer',
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
                </Button>
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
    </div>

    <!-- Panel Actions (on tab bar) -->
    <div class="shrink-0 h-full flex items-center">
      <div class="panel-actions flex items-center gap-0.5 px-1 z-20" data-panel-header-actions>
        {@render panelActionsDropdown('tabBar')}
        {@render panelCloseButton(activeTab)}
      </div>
    </div>
  </div>

  <!-- Compact header bar (breadcrumb style) -->
  {#if activeTab}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'panel-header group/header relative flex h-[var(--panel-header-height)] cursor-grab items-center bg-background pr-2.5 active:cursor-grabbing',
        activeTab.type === 'agent' && 'panel-agent-header',
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
      {#if renamingTabId === activeTab.id && !showTabStrip}
        <Input
          bind:ref={renameInputRef}
          bind:value={renameValue}
          class="min-w-0 flex-1"
          aria-label={m.ui_editableName_rename_tooltip()}
          onblur={saveInlineRename}
          onkeydown={async (event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            const header = event.currentTarget.closest('[data-panel-tabless-header]');
            if (event.key === 'Enter') saveInlineRename();
            else cancelInlineRename();
            await tick();
            header?.querySelector<HTMLButtonElement>('[data-pane-stack-selector-trigger]')?.focus();
          }}
        />
      {:else}
        {@render paneStackSelector()}
      {/if}
      <div class="min-w-0 flex-1" aria-hidden="true"></div>

      <!-- Right: all actions at the far edge in stable order. -->
      <div class="flex shrink-0 items-center gap-0.5" data-panel-header-actions>
        {@render panelActionsDropdown('compact')}
        {@render panelCloseButton(activeTab)}
      </div>
    </div>
  {:else}
    <div
      class={cn(
        'panel-header group/header relative flex items-center pr-2.5',
        isFocused && 'focused',
      )}
      style:height="var(--panel-header-height)"
      data-column-focused={isFocused ? '' : undefined}
      data-panel-tabless-header
      data-empty-panel-header
    >
      <div class="min-w-0 flex-1" aria-hidden="true"></div>
      <div class="flex shrink-0 items-center gap-0.5" data-panel-header-actions>
        {@render panelActionsDropdown('compact')}
        {@render panelCloseButton()}
      </div>
    </div>
  {/if}
</div>

<!-- Context Menu -->
{#if contextMenuTab && contextTab}
  <SidebarContextMenu
    x={contextMenuTab.x}
    y={contextMenuTab.y}
    returnFocus={contextMenuTab.returnFocus}
    items={tabContextItems}
    onClickOutside={closeContextMenu}
  />
{/if}

<style>
  :global(.panel-header-menu) {
    border: 1px solid hsl(var(--border));
    border-radius: 9px;
    padding: 4px;
    max-width: calc(100vw - 1rem);
    box-shadow: var(--surface-shadow-3);
    font-size: 14px;
    line-height: 1.2;
    font-weight: 500;
  }
  :global(
    :is(.panel-header-action-button, .panel-selector-button):not(
      :disabled,
      [data-disabled],
      [aria-disabled='true']
    )
  ),
  :global(
    .panel-header-menu
      :is([data-menu-item], [data-panel-menu-row], button, a[href], [role='option']):not(
        :disabled,
        [data-disabled],
        [aria-disabled='true']
      )
  ) {
    cursor: pointer;
  }
  :global(.panel-header-menu [data-proximity-highlight='selected']),
  :global(.panel-header-submenu [data-navigation-message-id][aria-selected='true']) {
    background: color-mix(in srgb, hsl(var(--background)), hsl(var(--foreground)) 5%);
  }
  :global(.panel-header-menu [data-proximity-highlight='hover']),
  :global(.panel-header-submenu [data-navigation-message-id]:hover) {
    background: color-mix(in srgb, hsl(var(--background)), hsl(var(--foreground)) 7%);
  }
  :global(.panel-header-menu [data-slot='menu-separator']) {
    margin-inline: -4px;
    margin-block: 6px;
  }
  :global(.panel-header-submenu) {
    min-width: min(224px, calc(100vw - 1rem));
  }
  :global(.panel-header-submenu :is([data-slot='input'], button[role='combobox'])) {
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
    height: 32px;
    padding-left: 10px;
    border-radius: 7px;
    background: hsl(var(--background));
  }

  :global(.panel-actions-menu-content) {
    width: 192px;
    min-width: min(192px, calc(100vw - 1rem));
    border-radius: 7px;
    padding-block: 5px;
  }

  /* CSS variables for panel tab bar heights */
  .panel-tab-wrapper {
    --panel-header-height: 52px;
    container-type: inline-size;
  }

  .panel-header {
    padding-inline: 8px;
    gap: 4px;
  }

  .panel-header-leading-surface {
    width: 26px;
    height: 26px;
    --agent-avatar-emphasized-surface-size: 26px;
    --agent-avatar-emphasized-art-size: 18px;
    --agent-avatar-emphasized-corner-radius: 5px;
  }
  .pane-stack-selector {
    width: 194px;
  }
  :global(.panel-selector-button) {
    height: 36px;
    padding: 4px 11px 4px 4px;
    gap: 8px;
    border: 1px solid hsl(var(--border));
    border-radius: 9px;
  }
  :global(.panel-selector-button:hover) {
    background-color: color-mix(in srgb, hsl(var(--sidebar)), hsl(var(--foreground)) 4%);
  }
  :global(.dark .panel-selector-button:hover) {
    background-color: color-mix(in srgb, hsl(var(--muted)), hsl(var(--foreground)) 4%);
  }
  .panel-selector-title {
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
  }
  :global(.panel-selector-menu) {
    width: var(--bits-dropdown-menu-anchor-width, 194px);
    min-width: 0;
  }
  :global(.panel-selector-menu [data-menu-item]) {
    align-items: center;
    min-height: 34px;
    gap: 8px;
    padding: 6px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
  }
  :global(.panel-selector-menu [data-slot='menu-command-item'] span.truncate) {
    white-space: normal;
  }
  :global(.panel-header-menu [data-slot='menu-command-item'] > span:last-child:has(kbd)) {
    margin-left: 6px;
  }
  :global(.panel-selector-menu [data-slot='menu-item-leading']) {
    width: 22px;
    height: 22px;
  }
  .panel-selector-row-avatar {
    width: 22px;
    height: 22px;
    --agent-avatar-emphasized-surface-size: 22px;
    --agent-avatar-emphasized-art-size: 15px;
    --agent-avatar-emphasized-corner-radius: 5px;
  }
  :global(
    .panel-header-menu:not(.panel-selector-menu) :is([data-menu-item], [data-panel-menu-row])
  ) {
    min-height: 30px;
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
    padding: 6px 10px;
    gap: 10px;
    border-radius: 7px;
  }
  :global(.panel-header-menu [data-panel-menu-row]) {
    height: auto;
  }
  :global(.panel-header-menu :is([data-slot='menu-label'], [data-panel-menu-label])) {
    font-size: 13px;
    line-height: 1.3;
    font-weight: 500;
    padding: 6px 8px;
    color: hsl(var(--muted-foreground));
  }
  :global(.panel-header-menu:not(.panel-selector-menu) [data-slot='menu-item-leading']) {
    width: 12px;
  }
  :global(.panel-header-menu:not(.panel-selector-menu) [data-slot='menu-item-leading'] svg),
  :global(.panel-header-menu [data-slot='menu-sub-chevron'] svg) {
    width: 12px;
    height: 12px;
  }
  :global(.panel-header-menu [data-slot='menu-command-item'] kbd) {
    font-size: 11px;
    color: hsl(var(--muted-foreground));
  }
  :global(.panel-header-menu [data-slot='menu-radio-item']) {
    align-items: center;
  }
  :global(.panel-header-menu [data-slot='menu-radio-item'] > [data-slot='menu-item-leading']) {
    display: none;
  }
  :global(.panel-header-menu [data-slot='menu-radio-item'] > [data-slot='menu-item-indicator']) {
    order: -1;
    width: 12px;
    height: 12px;
    margin: 0;
  }
  :global(.panel-header-menu [data-slot='menu-radio-item'] [data-slot='menu-item-indicator'] svg) {
    display: none;
  }
  :global(
    .panel-header-menu
      [data-slot='menu-radio-item'][data-state='checked']
      [data-slot='menu-item-indicator']::after
  ) {
    content: '';
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: hsl(var(--success));
  }
  .panel-move-pad {
    position: relative;
    width: 120px;
    height: 120px;
    margin: 6px auto 12px;
  }
  :global(
    .panel-actions-menu-content:has(
        [data-panel-actions-section='move']:hover,
        .panel-move-direction[data-highlighted]
      )
      > [data-slot='menu-list-highlight']
      [data-proximity-highlight='hover']
  ) {
    visibility: hidden;
  }
  :global(.panel-actions-menu-content .panel-move-direction) {
    position: absolute;
    inset: 0;
    width: 120px;
    height: 120px;
    min-height: 0;
    padding: 0;
    border-radius: 0;
    background: hsl(var(--selected));
    clip-path: polygon(
      15% 0,
      85% 0,
      88.333% 3.333%,
      88.333% 10%,
      53.333% 45%,
      46.667% 45%,
      11.667% 10%,
      11.667% 3.333%
    );
  }
  :global(.panel-move-direction > [data-slot='menu-item-leading']) {
    display: none;
  }
  :global(.panel-move-direction > svg) {
    position: absolute;
    left: 52px;
    top: 15px;
  }
  :global(.panel-actions-menu-content .panel-move-direction[data-disabled]) {
    opacity: 1;
    color: hsl(var(--muted-foreground));
  }
  :global(.panel-actions-menu-content .panel-move-direction[data-disabled] svg) {
    opacity: 0.45;
  }
  :global(.panel-actions-menu-content .panel-move-direction[data-highlighted]) {
    background: hsl(var(--accent));
  }
  :global(.panel-move-right) {
    transform: rotate(90deg);
  }
  :global(.panel-move-down) {
    transform: rotate(180deg);
  }
  :global(.panel-move-left) {
    transform: rotate(270deg);
  }
  @container (max-width: 420px) {
    .panel-header {
      padding-inline: 8px;
      gap: 4px;
    }
    :global(.panel-selector-button) {
      gap: 8px;
      padding-inline: 6px;
    }
    .panel-header-leading-surface {
      width: 26px;
      height: 26px;
      --agent-avatar-emphasized-surface-size: 26px;
      --agent-avatar-emphasized-art-size: 18px;
    }
  }
</style>
