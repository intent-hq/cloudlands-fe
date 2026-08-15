<script lang="ts">
  /* eslint-disable max-lines -- splitting this workspace sidebar is outside launcher-only scope */
  import { navigateAfterWorkspaceRemoval } from '$lib/utils/workspace-navigation';
  import './multi-select-sidebar-transitions.css';
  import {
    selectStagedWorkingChanges,
    selectUnstagedWorkingChanges,
  } from '$store/renderer/slices/changes/changes-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { loadChatTranscript } from '$features/agent/chat-read-service';
  import {
    selectActiveTab,
    selectAllTabs,
    selectFocusedPanelId,
    getPanelTabOpenState,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import AuggieAvatarWithState from '$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import { faNote } from '$lib/icons/faNote';

  import {
    markNoteRead,
    refreshUnreadNotes,
  } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { initializeNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import {
    selectAllWorkspaceAgents,
    selectIsLoadingAgents,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    selectAgentIsRunning,
    selectAgentSessionStreamingContent,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { cn } from '$lib/utils';
  import { scrollFade } from '$lib/actions/scroll-fade';

  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    locateItemInSidebarConsumed,
    openAgentTabRequested,
  } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingLocateInSidebar } from '$store/renderer/slices/app-layout/app-layout-selectors';
  import {
    faArrowUpRightFromSquare,
    faCompressAlt,
    faExpandAlt,
    faPencil,
    faPlus,
  } from '@fortawesome/free-solid-svg-icons';

  import { onMount, tick } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import type { TransitionConfig } from 'svelte/transition';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import ExpandableFileSearch from './sidebar/ExpandableFileSearch.svelte';
  import { FilesPanel, SidebarChangesPanel, isChildNote, isSpecNote } from './sidebar';
  import AddContextSection from './sidebar/AddContextSection.svelte';
  import ContextPanel from './sidebar/ContextPanel.svelte';
  import SidebarExpandableSearch from './sidebar/SidebarExpandableSearch.svelte';
  import SidebarHeaderAction from './sidebar/SidebarHeaderAction.svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';
  import SidebarLauncherHoverCard from './sidebar/SidebarLauncherHoverCard.svelte';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';
  import WorkspaceTerminalDock from './WorkspaceTerminalDock.svelte';
  import WorkspaceShellList from './WorkspaceShellList.svelte';
  import SidebarExpandedTabStrip from './SidebarExpandedTabStrip.svelte';
  import SidebarBrowserLauncher from './SidebarBrowserLauncher.svelte';
  import SidebarBrowserList from './SidebarBrowserList.svelte';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectAllNotes,
    selectNotesLoading,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { openTerminalOverlay } from '$store/renderer/slices/terminals/terminals-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectMultiSelectSidebarSelectedTabIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { store as appStore } from '$store/renderer/store';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import {
    deriveAgentLauncherItems,
    deriveNoteLauncherItems,
    getAgentLauncherPreview,
    getNoteLauncherPreview,
  } from './utils/sidebar-launcher-preview';
  import {
    LAUNCHER_GRID_POSITIONS,
    normalizeSelectedTabs,
    TAB_DEFINITIONS,
    type LauncherTabId,
    type TabId,
  } from './multi-select-sidebar-tabs';
  import { getFixedContainingBlockOffset } from './utils/fixed-containing-block';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import OpenPanelIndicator from './sidebar/OpenPanelIndicator.svelte';

  interface Props {
    workspaceId: string;
    panelLayoutId?: string;
    availablePanelCanvasWidth?: number;
    onCreateNote?: () => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    isNewWorkspaceSession?: boolean;
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onAcceptChanges?: () => void;
    onCloseWorkspace?: (event: MouseEvent) => void;
    draggableTitleRegion?: boolean;
    class?: string;
  }

  let {
    workspaceId,
    panelLayoutId = workspaceId,
    availablePanelCanvasWidth = 0,
    onCreateNote,
    onCreateFile,
    onFileRenamed,
    isNewWorkspaceSession = false,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onAcceptChanges,
    onCloseWorkspace,
    draggableTitleRegion = false,
    class: className,
  }: Props = $props();

  // Reactive writable store that mirrors workspaceId so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  const LAUNCHER_ICON_LIMIT = 6;
  const LAUNCHER_ICON_STACK_CLASS =
    'isolate grid h-7 w-full min-w-0 grid-flow-col items-start overflow-visible text-muted-foreground';
  const LAUNCHER_ICON_BUTTON_CLASS =
    'launcher-icon-button group/preview pointer-events-auto relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none transition-colors hover:z-20 hover:text-foreground focus-visible:z-30 focus-visible:text-foreground';
  const LAUNCHER_GLYPH_CLASS =
    'launcher-glyph flex size-4.5 items-center justify-center rounded-sm bg-card transition-colors group-hover/preview:bg-background/70 group-focus-visible/preview:bg-background/80';
  const LAUNCHER_AGENT_GLYPH_CLASS =
    // i18n-ignore (Tailwind utility classes)
    'launcher-glyph flex size-5.5 items-center justify-center rounded-sm bg-card transition-colors group-hover/preview:bg-background/70 group-focus-visible/preview:bg-background/80';
  const LAUNCHER_OVERFLOW_BUTTON_CLASS =
    // i18n-ignore (Tailwind utility classes)
    'launcher-overflow-button pointer-events-auto relative z-10 flex h-7 min-w-7 w-auto shrink-0 cursor-pointer items-center justify-start rounded-none! border-0! bg-transparent! p-0! text-xs font-medium leading-3 whitespace-nowrap text-muted-foreground shadow-none! outline-none transition-colors hover:z-20 hover:bg-transparent! hover:text-foreground focus-visible:z-30 focus-visible:bg-transparent! focus-visible:text-foreground focus-visible:underline';
  const LAUNCHER_OVERFLOW_STYLE =
    'line-height: 12px; font-weight: 500; background: transparent; border: 0; border-radius: 0; padding: 0; box-shadow: none;';
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  // Transient signal: panel tab "Reveal in Sidebar" → scroll & highlight.
  const pendingLocateInSidebar$ = selectPendingLocateInSidebar();

  const workspace = selectWorkspaceById(workspaceIdStore);
  const notes = selectAllNotes(workspaceIdStore);
  const launcherNoteState = $derived(
    deriveNoteLauncherItems(
      $notes,
      LAUNCHER_ICON_LIMIT,
      (note, allNotes) => !isChildNote(note, allNotes),
    ),
  );
  const launcherNotes = $derived(launcherNoteState.launcherNotes);
  const launcherNoteOverflowCount = $derived(launcherNoteState.overflowCount);
  const launcherNoteOverflowLabel = $derived(
    m.lib_commandPalette_showMoreNotes_label({
      count: formatInteger(launcherNoteOverflowCount),
    }),
  );
  const notesLoading$ = selectNotesLoading(workspaceIdStore);
  const allWorkspaceAgents = selectAllWorkspaceAgents(workspaceIdStore);
  const agentsLoading = selectIsLoadingAgents(workspaceIdStore);
  const launcherAgentState = $derived.by(() =>
    deriveAgentLauncherItems(
      $allWorkspaceAgents,
      LAUNCHER_ICON_LIMIT,
      (agent) => selectAgentIsRunning.select(appStore.state, agent.id),
      (agent, isRunning) =>
        getAgentLauncherPreview(
          agent,
          isRunning ? selectAgentSessionStreamingContent.select(appStore.state, agent.id) : '',
        ),
    ),
  );
  const launcherAgents = $derived(launcherAgentState.launcherAgents);
  const runningLauncherAgents = $derived(launcherAgentState.runningAgents);
  const launcherAgentTotal = $derived(launcherAgentState.totalAgents);
  const launcherAgentOverflowCount = $derived(launcherAgentState.overflowCount);
  const launcherAgentCountLabel = $derived(
    m.workspace_multiSelectSidebar_agentsLauncherCount_ariaLabel({
      count: formatInteger(launcherAgentTotal),
    }),
  );
  const launcherAgentOverflowLabel = $derived(
    m.workspace_multiSelectSidebar_agentsLauncherOverflow_ariaLabel({
      remaining: formatInteger(launcherAgentOverflowCount),
      total: formatInteger(launcherAgentTotal),
    }),
  );

  function isAgentLauncherTab(tabId: string): boolean {
    return tabId === 'agents';
  }

  function launcherItemCount(tabId: string): number {
    if (tabId === 'agents') {
      return launcherAgents.length + (launcherAgentOverflowCount > 0 ? 1 : 0);
    }
    if (tabId === 'context') {
      return launcherNotes.length + (launcherNoteOverflowCount > 0 ? 1 : 0);
    }
    return 1;
  }
  const selectedTabIds = selectMultiSelectSidebarSelectedTabIds(workspaceIdStore);
  const selectedTabs = $derived(normalizeSelectedTabs($selectedTabIds));
  let agentSearchQuery = $state('');
  let contextSearchQuery = $state('');
  const expandedStripTabs = $derived(
    TAB_DEFINITIONS.filter((definition) => definition.id !== 'overview').map(({ id, label }) => ({
      id,
      label,
    })),
  );
  let openLauncherHoverKey = $state<string | null>(null);
  const launcherRects = new Map<LauncherTabId, DOMRect>();
  const expandedCardRects = new Map<LauncherTabId, DOMRect>();

  function handleLauncherHoverOpenChange(key: string, open: boolean) {
    if (open) {
      openLauncherHoverKey = key;
    } else if (openLauncherHoverKey === key) {
      openLauncherHoverKey = null;
    }
  }

  function cardMorph(
    node: HTMLElement,
    { tabId, direction }: { tabId: LauncherTabId; direction: 'expand' | 'collapse' },
  ): TransitionConfig {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };

    const mountedLauncherRect =
      direction === 'collapse'
        ? sidebarElement
            ?.querySelector<HTMLElement>(`[data-sidebar-launcher="${tabId}"]`)
            ?.getBoundingClientRect()
        : undefined;
    const launcherRect = mountedLauncherRect ?? launcherRects.get(tabId);
    const cardRect =
      direction === 'collapse'
        ? (expandedCardRects.get(tabId) ?? node.getBoundingClientRect())
        : node.getBoundingClientRect();
    if (!launcherRect || cardRect.width === 0 || cardRect.height === 0) return { duration: 0 };

    const translateX = launcherRect.left - cardRect.left;
    const translateY = launcherRect.top - cardRect.top;
    const scaleX = launcherRect.width / cardRect.width;
    const scaleY = launcherRect.height / cardRect.height;
    const fixedContainingBlockOffset = getFixedContainingBlockOffset(node);
    const fixedLeft = cardRect.left - fixedContainingBlockOffset.x;
    const fixedTop = cardRect.top - fixedContainingBlockOffset.y;

    return {
      duration: 300,
      css: (t) => {
        const shellProgress = direction === 'expand' ? cubicOut(t) : cubicIn(t);
        const shellInverse = 1 - shellProgress;
        const contentProgress = Math.max(0, Math.min(1, (t - 0.72) / 0.28));
        return `position: fixed; left: ${fixedLeft}px; top: ${fixedTop}px; width: ${cardRect.width}px; height: ${cardRect.height}px; transform-origin: top left; transform: translate(${shellInverse * translateX}px, ${shellInverse * translateY}px) scale(${scaleX + shellProgress * (1 - scaleX)}, ${scaleY + shellProgress * (1 - scaleY)}); background-color: hsl(var(--card)); --sidebar-card-content-opacity: ${contentProgress}; --sidebar-card-content-y: ${(1 - contentProgress) * 4}px; will-change: transform;`;
      },
    };
  }

  function launcherGridReveal(_node: Element): TransitionConfig {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };

    return {
      delay: 210,
      duration: 90,
      css: (t) => `opacity: ${t};`,
    };
  }

  function persistSelectedTabs(nextSelectedTabs: Set<TabId>) {
    if (!workspaceId) return;
    appStore.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [...nextSelectedTabs]));
  }

  function handleTabClick(tabId: TabId) {
    const previousTabId = [...selectedTabs][0] ?? 'overview';
    const nextTabId = previousTabId === tabId ? 'overview' : tabId;
    if (previousTabId === 'agents' && nextTabId !== 'agents') agentSearchQuery = '';
    if (previousTabId === 'context' && nextTabId !== 'context') contextSearchQuery = '';
    if (previousTabId === 'overview' && tabId !== 'overview') {
      const launcher = sidebarElement?.querySelector<HTMLElement>(
        `[data-sidebar-launcher="${tabId}"]`,
      );
      if (launcher) launcherRects.set(tabId as LauncherTabId, launcher.getBoundingClientRect());
    } else if (previousTabId !== 'overview' && nextTabId === 'overview') {
      const expandedCard = sidebarElement?.querySelector<HTMLElement>('.sidebar-expanded-card');
      if (expandedCard) {
        expandedCardRects.set(previousTabId as LauncherTabId, expandedCard.getBoundingClientRect());
      }
    }
    persistSelectedTabs(new Set([nextTabId]));
  }

  function createBrowser() {
    panelLayoutManager.openBrowserPanel();
  }

  function createTerminal() {
    appStore.dispatch(openTerminalOverlay(workspaceId));
  }

  let pendingLauncherFocusTabId = $state<LauncherTabId | null>(null);

  function dismissExpandedCard(restoreLauncherFocus: boolean) {
    const expandedTabId = [...selectedTabs].find((tabId) => tabId !== 'overview') as
      LauncherTabId | undefined;
    if (!expandedTabId) return;
    pendingLauncherFocusTabId = restoreLauncherFocus ? expandedTabId : null;
    handleTabClick(expandedTabId);
  }

  function handleExpandedOverlayClick(event: MouseEvent) {
    if ((event.target as Element).closest('.sidebar-expanded-card')) return;
    dismissExpandedCard(false);
  }

  function isTabSelected(tabId: TabId): boolean {
    return selectedTabs.has(tabId);
  }

  const stagedChanges$ = selectStagedWorkingChanges(workspaceIdStore);
  const unstagedChanges$ = selectUnstagedWorkingChanges(workspaceIdStore);
  const panelLayoutManager = $derived(getPanelLayoutManager(panelLayoutId));
  const panelLayoutIdStore = writable(panelLayoutId);
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
  const activeTab$ = selectActiveTab(panelLayoutIdStore);
  const allPanelTabs$ = selectAllTabs(panelLayoutIdStore);
  const focusedContentType = $derived($activeTab$?.type ?? null);
  const focusedContentNoteId = $derived($activeTab$?.noteId ?? null);
  const focusedContentAgentId = $derived($activeTab$?.agentId ?? null);
  const focusedContentFilePath = $derived($activeTab$?.filePath ?? null);
  const focusedContentDiffPath = $derived($activeTab$?.diffPath ?? null);
  let lastInitializedNotesWorkspaceId: string | null = null;

  $effect(() => {
    workspaceId;
    agentSearchQuery = '';
    contextSearchQuery = '';
  });

  $effect(() => {
    if (!workspaceId || lastInitializedNotesWorkspaceId === workspaceId) return;
    lastInitializedNotesWorkspaceId = workspaceId;
    const initialSelectedNoteId = focusedContentType === 'note' ? focusedContentNoteId : undefined;
    appStore.dispatch(initializeNotes(workspaceId, initialSelectedNoteId ?? undefined));
  });

  const effectiveSelectedNoteId = $derived(
    focusedContentType === 'note' ? focusedContentNoteId : null,
  );
  const effectiveSelectedAgentId = $derived(
    focusedContentType === 'agent' ? focusedContentAgentId : null,
  );
  const effectiveSelectedFile = $derived(
    focusedContentType === 'file' ? focusedContentFilePath : null,
  );
  const effectiveActiveFilePath = $derived(
    focusedContentType === 'diff' ? focusedContentDiffPath : null,
  );
  const effectiveActiveFileStaged = $derived.by(() => {
    if (!effectiveActiveFilePath) return null;
    if (
      $stagedChanges$.some(
        (change) =>
          change.file === effectiveActiveFilePath ||
          change.relativePath === effectiveActiveFilePath,
      )
    ) {
      return true;
    }
    if (
      $unstagedChanges$.some(
        (change) =>
          change.file === effectiveActiveFilePath ||
          change.relativePath === effectiveActiveFilePath,
      )
    ) {
      return false;
    }
    return null;
  });
  const effectiveIsAllChangesViewActive = $derived(focusedContentType === 'local-changes');
  function getAgentPanelState(agentId: string) {
    return getPanelTabOpenState($allPanelTabs$, $activeTab$, workspaceId, {
      type: 'agent',
      agentId,
      workspaceId,
    });
  }

  function getNotePanelState(noteId: string) {
    return getPanelTabOpenState($allPanelTabs$, $activeTab$, workspaceId, {
      type: 'note',
      noteId,
      workspaceId,
    });
  }

  function handleOpenAgentInPanel(agentId: string) {
    if (!$allWorkspaceAgents.some((agent) => agent.id === agentId)) return;
    const sourcePanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId,
        panelLayoutId,
        openInNewColumn: true,
        adaptiveFirstChat: true,
        availablePanelCanvasWidth,
      }),
    );
  }

  function handleOpenNoteInPanel(noteId: string) {
    const note = $notes.find((n) => n.id === noteId);
    const title = note?.title || m.workspace_addContext_note_label();
    panelLayoutManager.openUserTab({
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    });

    // Mark note as read when opened to clear unread indicator
    appStore.dispatch(markNoteRead(workspaceId, noteId));
  }

  function handleOpenFileInPanel(filePath: string) {
    const fileName = filePath.split('/').pop() || filePath;
    panelLayoutManager.openTab({
      type: 'file',
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    });
  }

  function handleOpenCodeReviewInPanel() {
    panelLayoutManager.openTab({
      type: 'code-review',
      title: m.workspace_multiSelectSidebar_codeReview_label(),
      closable: true,
      workspaceId,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleArchiveWorkspace() {
    if (!$workspace) return;
    const { toast } = await import('svelte-sonner');
    const workspaceTitle = $workspace.title || m.workspace_multiSelectSidebar_space_label();

    const result = await workspaceClient.archive($workspace.id);
    if (result.ok) {
      appStore.dispatch(loadWorkspacesRequested());
      toast.warning(m.workspace_multiSelectSidebar_archivedSpace_toast({ title: workspaceTitle }), {
        duration: 15000,
        action: {
          label: m.workspace_multiSelectSidebar_undo_label(),
          onClick: async () => {
            const undoResult = await workspaceClient.unarchive($workspace.id);
            if (undoResult.ok) {
              appStore.dispatch(loadWorkspacesRequested());
            }
          },
        },
      });
      await navigateAfterWorkspaceRemoval($workspace.id);
    } else {
      toast.error(m.workspace_multiSelectSidebar_archiveFailed_error());
    }
  }

  // File panel state
  let showOnlyChangedFiles = $state(false);
  let fileSearchQuery = $state('');
  let filesPanelRef: FilesPanel | null = $state(null);
  let filesExpandedTick = $state(0);

  const hasExpandedDirectories = $derived.by(() => {
    void filesExpandedTick;
    return filesPanelRef?.getHasExpandedDirectories() ?? false;
  });

  // Sidebar element ref
  let sidebarElement: HTMLDivElement | null = $state(null);
  let bottomLaunchersElement: HTMLDivElement | null = $state(null);
  let expandedOverlayTop = $state(88);
  let expandedOverlayBottom = $state(68);

  function updateExpandedOverlayBounds() {
    if (!sidebarElement) return;
    const sidebarRect = sidebarElement.getBoundingClientRect();
    if (sidebarRect.height <= 0) return;
    const localHeight = sidebarElement.clientHeight || sidebarRect.height;
    const viewportPixelsPerCssPixel = sidebarRect.height / localHeight;

    const identityBoundary = sidebarElement.querySelector<HTMLElement>(
      '[data-sidebar-repository-branch-metadata]',
    );
    const progressBoundary = sidebarElement.querySelector<HTMLElement>(
      '[data-workspace-task-progress]',
    );
    const boundaryBottom = Math.max(
      identityBoundary?.getBoundingClientRect().bottom ?? sidebarRect.top,
      progressBoundary?.getBoundingClientRect().bottom ?? sidebarRect.top,
    );
    const bottomLauncherTop =
      bottomLaunchersElement?.getBoundingClientRect().top ?? sidebarRect.bottom;
    const nextBottom = Math.max(
      0,
      Math.round((sidebarRect.bottom - bottomLauncherTop) / viewportPixelsPerCssPixel),
    );
    const maxTop = Math.max(0, Math.round(localHeight - nextBottom - 96));

    expandedOverlayTop = Math.min(
      maxTop,
      Math.max(0, Math.round((boundaryBottom - sidebarRect.top) / viewportPixelsPerCssPixel + 4)),
    );
    expandedOverlayBottom = nextBottom;
  }

  onMount(() => {
    updateExpandedOverlayBounds();
    const frame = requestAnimationFrame(updateExpandedOverlayBounds);
    if (typeof ResizeObserver === 'undefined' || !sidebarElement) {
      return () => cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(updateExpandedOverlayBounds);
    observer.observe(sidebarElement);
    const titleRegion = sidebarElement.querySelector<HTMLElement>('[data-workspace-title-region]');
    if (titleRegion) observer.observe(titleRegion);
    if (bottomLaunchersElement) observer.observe(bottomLaunchersElement);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  // Map registry sidebar tab IDs to MultiSelectTabbedSidebar tab IDs
  function mapSidebarTabId(registryTabId: string): TabId | null {
    const mapping: Record<string, TabId> = {
      notes: 'context',
      agents: 'agents',
      files: 'files',
      terminals: 'agents', // terminals don't have their own tab, fall back to agents
      changes: 'changes',
      browser: 'agents',
    };
    return mapping[registryTabId] ?? null;
  }

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        const workspacePath = selectEffectiveFileExplorerWorkspacePath.select(
          appStore.state,
          workspaceId,
        );
        if (workspacePath) {
          navigator.clipboard.writeText(workspacePath);
          import('$lib/components/ui/toast').then(({ toast }) => {
            toast.success(m.ui_openCombo_pathCopied_label());
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  // Handle "Reveal in Sidebar" requests dispatched from panel tab context menus.
  $effect(() => {
    const pending = $pendingLocateInSidebar$;
    if (!pending) return;
    if (pending.workspaceId !== workspaceId) return;

    const { sidebarTabId, type, noteId, filePath, agentId } = pending.target;

    // Switch to the appropriate sidebar tab
    const targetTab = mapSidebarTabId(sidebarTabId);
    if (targetTab) {
      persistSelectedTabs(new Set([targetTab]));
    }

    // Scroll to the item after a short delay to allow tab switch to render
    const timeoutId = setTimeout(() => {
      let selector: string | null = null;

      switch (type) {
        case 'note':
          if (noteId) selector = `[data-note-id="${noteId}"]`;
          break;
        case 'file':
        case 'diff':
          if (filePath) selector = `[data-file-path="${CSS.escape(filePath)}"]`;
          break;
        case 'agent':
          if (agentId) selector = `[data-agent-id="${agentId}"]`;
          break;
      }

      if (selector && sidebarElement) {
        const element = sidebarElement.querySelector(selector);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Add a brief highlight effect
          element.classList.add('sidebar-locate-highlight');
          setTimeout(() => {
            element.classList.remove('sidebar-locate-highlight');
          }, 1500);
        }
      }
      appStore.dispatch(locateItemInSidebarConsumed(workspaceId));
    }, 150);

    return () => {
      clearTimeout(timeoutId);
    };
  });
  // Refresh unread notes — only dispatch when note data actually changes
  let lastRefreshKey: string | undefined;
  $effect(() => {
    if (workspaceId && $notes.length > 0) {
      const trackableNotes = $notes.filter((n) => !isSpecNote(n.id as string));
      const notesWithTimestamps = trackableNotes.map((n) => ({
        id: n.id as string,
        updatedAt: n.updatedAt || n.updated_at || n.createdAt || n.created_at || '',
        createdAt: n.createdAt || n.created_at,
      }));
      const refreshKey =
        workspaceId + ':' + notesWithTimestamps.map((n) => n.id + ':' + n.updatedAt).join(',');
      if (refreshKey !== lastRefreshKey) {
        lastRefreshKey = refreshKey;
        appStore.dispatch(refreshUnreadNotes(workspaceId, notesWithTimestamps));
      }
    }
  });

  const orderedSelectedTabs = $derived(
    TAB_DEFINITIONS.map((tab) => tab.id as TabId).filter(
      (id) => id !== 'overview' && selectedTabs.has(id),
    ),
  );
  const isLauncherOverview = $derived(isTabSelected('overview'));

  $effect(() => {
    if (isLauncherOverview) return;
    return pushEscapeLayer(() => dismissExpandedCard(true));
  });

  $effect(() => {
    if (!isLauncherOverview || !pendingLauncherFocusTabId) return;
    const tabId = pendingLauncherFocusTabId;
    pendingLauncherFocusTabId = null;
    void tick().then(() => {
      sidebarElement
        ?.querySelector<HTMLButtonElement>(
          `[data-sidebar-launcher="${tabId}"] button[aria-expanded="false"]`,
        )
        ?.focus();
    });
  });
</script>

<div
  bind:this={sidebarElement}
  class={cn('relative flex h-full flex-col overflow-hidden bg-transparent', className)}
>
  <!-- Fixed Top Section: Progress Card -->
  <div class="shrink-0 px-6 pb-2 pt-5" data-workspace-title-region draggable={draggableTitleRegion}>
    <WorkspaceProgressCard
      {workspaceId}
      onOpenNote={handleOpenNoteInPanel}
      {onCloseWorkspace}
      hideActionsMenu={!isLauncherOverview}
    />
  </div>

  {#if !isNewWorkspaceSession}
    <div
      class={cn(
        'sidebar-stage grid min-h-0 flex-1',
        isLauncherOverview ? 'grid-rows-[minmax(0,1fr)_232px]' : 'grid-rows-[minmax(0,1fr)_0px]',
      )}
      data-sidebar-stage
    >
      <div class={isLauncherOverview ? 'min-h-0 overflow-hidden' : 'min-h-0 overflow-visible'}>
        {#if isLauncherOverview}
          <div class="h-full min-h-0" aria-hidden="true"></div>
        {:else}
          <!-- One expanded tile fills the body beneath the workspace identity. -->
          {@html '<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->'}
          <div
            role="presentation"
            class="absolute inset-x-0 z-20 flex min-h-0 min-w-0 flex-col overflow-hidden px-4 pb-1 pt-3"
            style={`top: ${expandedOverlayTop}px; bottom: ${expandedOverlayBottom}px;`}
            data-sidebar-overlay
            onclick={handleExpandedOverlayClick}
          >
            {#each orderedSelectedTabs as tabId (tabId)}
              {@const tab = TAB_DEFINITIONS.find((t) => t.id === tabId)}
              <div
                class="sidebar-expanded-card relative z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
                data-sidebar-card-surface
                in:cardMorph|global={{
                  tabId: tabId as LauncherTabId,
                  direction: 'expand',
                }}
                out:cardMorph|global={{
                  tabId: tabId as LauncherTabId,
                  direction: 'collapse',
                }}
              >
                <div
                  class="sidebar-expanded-content flex min-h-0 flex-1 flex-col"
                  data-sidebar-expanded-content
                >
                  <!-- Panel header/description -->
                  {#if tab && !tab.hideHeader}
                    <div class="px-4 pb-1 pt-4">
                      <h6
                        class="text-ui font-semibold text-foreground flex items-center gap-2 mb-0.5"
                      >
                        {tab.label}
                        <span class="ml-auto flex items-center gap-1">
                          {#if tabId === 'agents'}
                            <SidebarExpandableSearch
                              bind:query={agentSearchQuery}
                              scope="agents"
                              placeholder={m.workspace_multiSelectSidebar_searchAgents_placeholder()}
                            />
                            {#if onCreateAgent || onCreateAgentWithSpecialist}
                              <CreateAgentSection
                                onCreate={onCreateAgent}
                                onCreateWithSpecialist={onCreateAgentWithSpecialist}
                                compact
                              />
                            {/if}
                          {:else if tabId === 'context'}
                            <SidebarExpandableSearch
                              bind:query={contextSearchQuery}
                              scope="context"
                              placeholder={m.workspace_multiSelectSidebar_searchContext_placeholder()}
                            />
                            <AddContextSection onAddNote={onCreateNote} compact />
                          {:else if tabId === 'browser'}
                            <SidebarHeaderAction
                              icon="plus"
                              label={m.menu_new_browser()}
                              onclick={createBrowser}
                            />
                          {:else if tabId === 'shell'}
                            <SidebarHeaderAction
                              icon="plus"
                              label={m.menu_new_terminal()}
                              onclick={createTerminal}
                            />
                          {/if}
                          <SidebarHeaderAction
                            icon="close"
                            label={m.ui_tab_close_ariaLabel()}
                            onclick={() => dismissExpandedCard(true)}
                          />
                        </span>
                      </h6>
                      {#if tabId !== 'agents' && tabId !== 'shell'}
                        <p
                          class="text-ui text-subtle mt-0.5 leading-snug transition-all duration-200"
                        >
                          {#if tabId === 'context' && $workspace?.isRemote}
                            {tab.description}
                            {m.workspace_multiSelectSidebar_notesLiveOn_before()}
                            <span class="font-mono text-subtle"
                              >{$workspace.environmentConfig?.ssh?.host
                                ? `${$workspace.environmentConfig.ssh.host}:`
                                : ''}{$workspace.id}<!-- i18n-ignore (file path) -->/.workspace</span
                            >.
                          {:else if tabId === 'context' && $workspace?.path}
                            {tab.description}
                            {m.workspace_multiSelectSidebar_notesLiveIn_before()}
                            <span class="inline-flex items-baseline gap-1">
                              <OpenComboButton
                                filePath={$workspace.path + '/.workspace'}
                                {workspaceId}
                                isDirectory={true}
                                variant="sidebar"
                                compact
                                class="inline-flex"
                              >
                                <span
                                  class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                                  ><!-- i18n-ignore (file path) -->/{$workspace.path
                                    .split(/[/\\]/)
                                    .slice(-1)[0]}/.workspace<!-- i18n-ignore (file path) --></span
                                >
                              </OpenComboButton></span
                            >.
                          {:else if tabId === 'files' && $fileExplorerWorkspacePath}
                            {$workspace?.skipWorktree
                              ? m.workspace_multiSelectSidebar_workingDirectlyIn_before()
                              : m.workspace_multiSelectSidebar_repoCopyLivesIn_before()}
                            <span class="inline-flex items-baseline gap-1">
                              <OpenComboButton
                                filePath={$fileExplorerWorkspacePath}
                                {workspaceId}
                                isDirectory={true}
                                variant="sidebar"
                                compact
                                class="inline-flex"
                              >
                                <span
                                  class="text-inherit underline underline-offset-2 decoration-muted-foreground/20"
                                  >/{$fileExplorerWorkspacePath
                                    .split(/[/\\]/)
                                    .slice(-2)
                                    .join('/')}.</span
                                >
                              </OpenComboButton></span
                            >
                          {:else}
                            {tab.description}
                          {/if}
                        </p>
                      {/if}
                    </div>
                  {/if}
                  <!-- Panel content -->
                  <!-- {#key workspaceId} forces remount of agent-related panels on workspace switch,
                 ensuring onMount stream listeners and subscriptions rebind correctly -->
                  {#key workspaceId}
                    <div
                      class="min-h-0 flex-1 pt-2 {tabId === 'files'
                        ? 'overflow-hidden pb-0'
                        : 'overflow-y-auto pb-6'}"
                      use:scrollFade
                    >
                      {#if tabId === 'agents'}
                        <div class="px-4 transition-all duration-200" data-testid="agent-panel">
                          <WorkspaceAgentsList
                            agents={$allWorkspaceAgents}
                            loading={$agentsLoading}
                            searchQuery={agentSearchQuery}
                            runningAgentIds={runningLauncherAgents.map((agent) => agent.id)}
                            selectedAgentId={effectiveSelectedAgentId}
                            {workspaceId}
                            openPanelTabs={$allPanelTabs$}
                            activePanelTab={$activeTab$}
                            onSelect={({ agentId }) => handleOpenAgentInPanel(agentId)}
                          />
                        </div>
                      {:else if tabId === 'context'}
                        <div class="px-4 transition-all duration-200">
                          <ContextPanel
                            notes={$notes}
                            {workspaceId}
                            selectedNoteId={effectiveSelectedNoteId}
                            onOpenNote={handleOpenNoteInPanel}
                            onOpenAgent={handleOpenAgentInPanel}
                            {onCreateNote}
                            loading={$notesLoading$}
                            openPanelTabs={$allPanelTabs$}
                            activePanelTab={$activeTab$}
                            searchQuery={contextSearchQuery}
                            showAddSection={false}
                          />
                        </div>
                      {:else if tabId === 'changes'}
                        <div
                          class="flex h-full flex-1 flex-col px-4 transition-all duration-200"
                          data-sidebar-changes-panel
                        >
                          <div class="w-full flex-1">
                            <SidebarChangesPanel
                              {workspaceId}
                              activeFilePath={effectiveActiveFilePath}
                              activeFileStaged={effectiveActiveFileStaged}
                              isAllChangesViewActive={effectiveIsAllChangesViewActive}
                              onOpenChange={(change) => {
                                appStore.dispatch(
                                  openWorkspaceDiff(workspaceId, change as never, {
                                    filePath: change.relativePath || change.file,
                                    changeId: change.id,
                                  }),
                                );
                              }}
                              onOpenFullPanel={onAcceptChanges}
                              onOpenNote={handleOpenNoteInPanel}
                              onOpenCodeReview={handleOpenCodeReviewInPanel}
                              openPanelTabs={$allPanelTabs$}
                              activePanelTab={$activeTab$}
                            />
                          </div>
                        </div>
                      {:else if tabId === 'files'}
                        <div class="flex h-full min-h-0 flex-col px-4 transition-all duration-200">
                          <!-- File filter controls -->
                          <div class="flex shrink-0 items-center gap-2 pb-2" data-file-tree-toolbar>
                            <ExpandableFileSearch
                              bind:query={fileSearchQuery}
                              onKeydown={(event) => filesPanelRef?.handleSearchKeyDown(event)}
                            />
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="shrink-0 text-subtle"
                              tooltip={m.workspace_multiSelectSidebar_newFile_tooltip()}
                              onclick={() => filesPanelRef?.startCreatingFile()}
                            >
                              <Fa icon={faPlus} class="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="shrink-0 {showOnlyChangedFiles
                                ? 'text-primary'
                                : 'text-subtle'}"
                              tooltip={showOnlyChangedFiles
                                ? m.workspace_multiSelectSidebar_showAllFiles_tooltip()
                                : m.workspace_multiSelectSidebar_showOnlyChangedFiles_tooltip()}
                              onclick={() => (showOnlyChangedFiles = !showOnlyChangedFiles)}
                            >
                              <Fa icon={faPencil} class="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              class="shrink-0 text-subtle"
                              tooltip={hasExpandedDirectories
                                ? m.workspace_multiSelectSidebar_collapseAll_tooltip()
                                : m.workspace_multiSelectSidebar_expandAll_tooltip()}
                              onclick={async () => {
                                if (hasExpandedDirectories) {
                                  filesPanelRef?.collapseAll();
                                } else {
                                  await filesPanelRef?.expandAll();
                                }
                                filesExpandedTick++;
                              }}
                            >
                              <Fa
                                icon={hasExpandedDirectories ? faCompressAlt : faExpandAlt}
                                class="w-3 h-3"
                              />
                            </Button>
                          </div>
                          <FilesPanel
                            bind:this={filesPanelRef}
                            {workspaceId}
                            selectedFile={effectiveSelectedFile}
                            onOpenFile={handleOpenFileInPanel}
                            {onCreateFile}
                            {onFileRenamed}
                            onSelectAgent={handleOpenAgentInPanel}
                            showOnlyChanged={showOnlyChangedFiles}
                            searchQuery={fileSearchQuery}
                            openPanelTabs={$allPanelTabs$}
                            activePanelTab={$activeTab$}
                          />
                        </div>
                      {:else if tabId === 'browser'}
                        <SidebarBrowserList {workspaceId} {panelLayoutId} />
                      {:else if tabId === 'shell'}
                        <WorkspaceShellList {workspaceId} />
                      {/if}
                    </div>
                  {/key}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if isLauncherOverview}
        <!-- Lightweight launchers disappear while a section is expanded. -->
        <div
          class="flex h-full min-h-0 items-end px-6 pt-4"
          data-testid="sidebar-launchers"
          data-launcher-layout="tiles"
          in:launcherGridReveal|global
        >
          <div class="grid h-56 w-full auto-rows-fr grid-cols-2 gap-3" data-sidebar-launcher-grid>
            {#each TAB_DEFINITIONS.filter((definition) => definition.id in LAUNCHER_GRID_POSITIONS) as tab (tab.id)}
              <div
                class="group/launcher relative flex h-full min-h-0 w-full min-w-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-card p-2 text-foreground transition-colors"
                data-sidebar-launcher={tab.id}
                data-sidebar-card-surface
                data-launcher-top-inset="8"
                data-launcher-inline-inset="8"
              >
                <Button
                  variant="plain"
                  class="launcher-tile-action absolute inset-0 z-0 h-auto cursor-pointer rounded-lg outline-none focus-visible:bg-muted/50"
                  onclick={() => handleTabClick(tab.id)}
                  data-testid={isAgentLauncherTab(tab.id) ? 'agent-panel-toggle' : undefined}
                  aria-expanded="false"
                  aria-label={isAgentLauncherTab(tab.id)
                    ? undefined
                    : m.ui_vscodePanel_expand_ariaLabel()}
                  aria-labelledby={isAgentLauncherTab(tab.id)
                    ? `sidebar-launcher-label-${tab.id}-${workspaceId} sidebar-launcher-agent-count-${workspaceId}`
                    : undefined}
                ></Button>
                <div
                  class="pointer-events-none relative z-10 flex h-full min-h-0 w-full min-w-0 flex-col justify-between"
                >
                  <div
                    class={LAUNCHER_ICON_STACK_CLASS}
                    style={`grid-template-columns: repeat(${launcherItemCount(tab.id)}, minmax(0, 1fr));`}
                    data-sidebar-launcher-icons
                    data-launcher-pack="bounded-distribution"
                    data-launcher-layout="horizontal"
                    data-launcher-target-size="28"
                    data-launcher-visible-size={tab.id === 'agents' ? '22' : '18'}
                    data-launcher-visible-offset={tab.id === 'agents' ? '3' : '5'}
                  >
                    {#if tab.id === 'agents'}
                      {#each launcherAgents as { agent, isRunning, preview }, index (agent.id)}
                        {@const panelState = getAgentPanelState(agent.id)}
                        <SidebarLauncherHoverCard
                          title={agent.name ||
                            `${m.workspace_fileChanges_agent_label()} ${agent.id.slice(0, 8)}`}
                          status={isRunning ? m.chat_backgroundHooks_running_label() : undefined}
                          rows={[
                            {
                              label: m.chat_agentThread_you_label(),
                              text: preview.lastUserMessage,
                            },
                            {
                              label: m.workspace_fileChanges_agent_label(),
                              text: preview.response,
                            },
                          ]}
                          emptyText={m.layout_sidebarNav_noMessages_label()}
                          kind="agent"
                          gridPosition={index === 0
                            ? 'start'
                            : index === launcherItemCount('agents') - 1
                              ? 'end'
                              : 'center'}
                          open={openLauncherHoverKey === `agent:${agent.id}`}
                          onOpenChange={(open) => {
                            handleLauncherHoverOpenChange(`agent:${agent.id}`, open);
                            if (open && agent.messages.length === 0)
                              void loadChatTranscript(agent.id);
                          }}
                        >
                          <Button
                            variant="plain"
                            class={LAUNCHER_ICON_BUTTON_CLASS}
                            onclick={() => handleOpenAgentInPanel(agent.id)}
                            aria-label={agent.name || m.workspace_fileChanges_agent_label()}
                            data-sidebar-agent={agent.id}
                            data-sidebar-agent-state={isRunning ? 'running' : 'idle'}
                            data-launcher-leading-item={index === 0 ? 'true' : undefined}
                            data-launcher-preview-item
                          >
                            <span
                              class={LAUNCHER_AGENT_GLYPH_CLASS}
                              style="width: 22px; height: 22px; box-shadow: inset 0 0 0 1px var(--color-card);"
                              data-sidebar-launcher-glyph
                              data-launcher-avatar-seam="surface-1px"
                              data-launcher-avatar-size="22"
                            >
                              <AuggieAvatarWithState
                                agentId={agent.id}
                                specialist={agent.metadata?.specialist as
                                  BuiltinSpecialistId | undefined}
                                size={22}
                                state={isRunning ? 'running' : 'idle'}
                              />
                              <OpenPanelIndicator
                                count={panelState.count}
                                active={panelState.isActive}
                                overlay
                              />
                            </span>
                          </Button>
                        </SidebarLauncherHoverCard>
                      {/each}
                      {#if launcherAgentOverflowCount > 0}
                        <Button
                          variant="plain"
                          class={LAUNCHER_OVERFLOW_BUTTON_CLASS}
                          style={`${LAUNCHER_OVERFLOW_STYLE} justify-self: ${
                            launcherItemCount('agents') === 1 ? 'start' : 'end'
                          };`}
                          onpointerdown={(event) => event.stopPropagation()}
                          onclick={(event) => {
                            event.stopPropagation();
                            handleTabClick('agents');
                          }}
                          data-sidebar-agent-overflow={launcherAgentOverflowCount}
                          data-launcher-preview-item
                        >
                          <span aria-hidden="true">+{launcherAgentOverflowCount}</span>
                          <span class="sr-only">{launcherAgentOverflowLabel}</span>
                        </Button>
                      {/if}
                    {:else if tab.id === 'context'}
                      {#each launcherNotes as note, index (note.id)}
                        {@const panelState = getNotePanelState(note.id as string)}
                        <SidebarLauncherHoverCard
                          title={note.title || m.chat_mentions_untitledNote_label()}
                          rows={[{ text: getNoteLauncherPreview(note) }]}
                          emptyText="Empty note"
                          kind="note"
                          gridPosition={index === 0
                            ? 'start'
                            : index === launcherItemCount('context') - 1
                              ? 'end'
                              : 'center'}
                          open={openLauncherHoverKey === `note:${note.id}`}
                          onOpenChange={(open) =>
                            handleLauncherHoverOpenChange(`note:${note.id}`, open)}
                        >
                          <Button
                            variant="plain"
                            class={LAUNCHER_ICON_BUTTON_CLASS}
                            onclick={() => handleOpenNoteInPanel(note.id as string)}
                            aria-label={note.title || m.chat_mentions_untitledNote_label()}
                            data-sidebar-context={note.id}
                            data-launcher-leading-item={index === 0 ? 'true' : undefined}
                            data-launcher-preview-item
                          >
                            <span class={LAUNCHER_GLYPH_CLASS} data-sidebar-launcher-glyph>
                              <Fa icon={faNote} class="size-4.5!" />
                              <OpenPanelIndicator
                                count={panelState.count}
                                active={panelState.isActive}
                                overlay
                              />
                            </span>
                          </Button>
                        </SidebarLauncherHoverCard>
                      {/each}
                      {#if launcherNoteOverflowCount > 0}
                        <Button
                          variant="plain"
                          class={LAUNCHER_OVERFLOW_BUTTON_CLASS}
                          style={`${LAUNCHER_OVERFLOW_STYLE} justify-self: ${
                            launcherItemCount('context') === 1 ? 'start' : 'end'
                          };`}
                          onclick={() => handleTabClick('context')}
                          aria-label={launcherNoteOverflowLabel}
                          data-sidebar-context-overflow={launcherNoteOverflowCount}
                          data-launcher-preview-item
                        >
                          <span aria-hidden="true">+{launcherNoteOverflowCount}</span>
                        </Button>
                      {/if}
                    {/if}
                  </div>
                  <div
                    class="flex h-7 min-w-0 items-center justify-between gap-2"
                    data-sidebar-label-row
                  >
                    <span
                      id={`sidebar-launcher-label-${tab.id}-${workspaceId}`}
                      data-sidebar-launcher-label
                      class="truncate text-sm font-semibold">{tab.label}</span
                    >
                    {#if tab.id === 'agents'}
                      <span id={`sidebar-launcher-agent-count-${workspaceId}`} class="sr-only">
                        {launcherAgentCountLabel}
                      </span>
                    {/if}
                    {#if tab.id === 'files' && $fileExplorerWorkspacePath}
                      <span class="pointer-events-auto relative z-20 cursor-pointer">
                        <OpenComboButton
                          filePath={$fileExplorerWorkspacePath}
                          {workspaceId}
                          isDirectory={true}
                          side="top"
                          variant="sidebar"
                        >
                          <span
                            class="inline-flex size-7 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:text-foreground"
                            data-files-open-in
                          >
                            <Fa icon={faArrowUpRightFromSquare} class="size-4!" />
                            <span class="sr-only">{m.ui_openCombo_openInApp_tooltip()}</span>
                          </span>
                        </OpenComboButton>
                      </span>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
  <!-- Compact launchers stay fixed; only collapsed tabs resize beneath an expanded card. -->
  <div
    bind:this={bottomLaunchersElement}
    class={cn(
      'relative z-30 w-full shrink-0 pb-3 transition-all duration-500',
      isLauncherOverview ? 'grid gap-3 px-6 pt-3' : 'px-4 pt-2',
      isLauncherOverview ? (isNewWorkspaceSession ? 'grid-cols-1' : 'grid-cols-2') : '',
    )}
    data-sidebar-compact-bottom-row={isLauncherOverview || undefined}
  >
    {#if isLauncherOverview}
      {#if !isNewWorkspaceSession}
        <SidebarBrowserLauncher
          {workspaceId}
          {panelLayoutId}
          onExpand={() => handleTabClick('browser')}
          expanded={selectedTabs.has('browser')}
        />
      {/if}
      <WorkspaceTerminalDock
        {workspaceId}
        onExpand={() => handleTabClick('shell')}
        expanded={selectedTabs.has('shell')}
      />
    {:else}
      <SidebarExpandedTabStrip
        tabs={expandedStripTabs}
        activeTabId={orderedSelectedTabs[0]}
        closeLabel={m.ui_tab_close_ariaLabel()}
        onActivate={(tabId) => handleTabClick(tabId)}
      />
    {/if}
  </div>
</div>

<style>
  @media (forced-colors: active) {
    :global(.launcher-icon-button:focus-visible) {
      color: HighlightText;
    }

    :global(.launcher-icon-button:focus-visible) .launcher-glyph {
      background: Highlight;
      color: HighlightText;
    }

    :global(.launcher-overflow-button:focus-visible) {
      color: Highlight;
    }

    :global(.expanded-card-action:focus-visible),
    :global(.launcher-tile-action:focus-visible) {
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
