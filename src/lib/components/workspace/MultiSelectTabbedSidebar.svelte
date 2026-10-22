<script lang="ts">
  import { isCmdClickModifier } from '$shared/utils/link-helpers';
  import './multi-select-sidebar-transitions.css';
  import {
    selectStagedWorkingChanges,
    selectUnstagedWorkingChanges,
  } from '$store/renderer/slices/changes/changes-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import {
    selectActiveTab,
    selectAllTabs,
    selectFocusedPanelId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import {
    markNoteRead,
    refreshUnreadNotes,
  } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import {
    fetchBackgroundAgentsRequested,
    fetchDelegatedAgentsRequested,
    fetchOrphanedDelegatedAgentsRequested,
    fetchRetiredAgentsRequested,
    restoreRetiredAgentRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    selectAllWorkspaceAgents,
    selectBackgroundAgentsLoaded,
    selectDelegatedAgentsLoaded,
    selectDelegatedCounts,
    selectIsLoadingAgents,
    selectIsLoadingBackgroundAgents,
    selectIsLoadingDelegatedAgents,
    selectIsLoadingOrphanedDelegatedAgents,
    selectIsLoadingRetiredAgents,
    selectLoadedDelegatedParentIds,
    selectLoadingDelegatedParentIds,
    selectOrphanedDelegatedAgentIds,
    selectOrphanedDelegatedAgentsLoaded,
    selectRetiredAgentsLoaded,
    selectRetiredCount,
    selectScopeCounts,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { selectAgentIsRunning } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { cn } from '$lib/utils';
  import { scrollFade } from '$lib/actions/scroll-fade';
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
  import { buildWorkspacePRPresentationModel } from './sidebar/workspace-pr-presentation';
  import { constructPrUrl, legacyWorkspacePullRequest } from './sidebar/sidebar-changes-utils';
  import { selectReviewMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
  import { onMount, type Snippet } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import CreateAgentSection from './CreateAgentSection.svelte';
  import ExpandableFileSearch from './sidebar/ExpandableFileSearch.svelte';
  import { FilesPanel, SidebarChangesPanel, isSpecNote } from './sidebar';
  import AddContextSection from './sidebar/AddContextSection.svelte';
  import ContextPanel from './sidebar/ContextPanel.svelte';
  import SidebarExpandableSearch from './sidebar/SidebarExpandableSearch.svelte';
  import SidebarHeaderAction from './sidebar/SidebarHeaderAction.svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';
  import WorkspacePeopleActivity from '$features/presence/components/WorkspacePeopleActivity.svelte';
  import { selectWorkspacePeopleTilePeople } from '$store/renderer/slices/presence/presence-selectors';
  import { openShareDialog } from '$store/renderer/slices/workspace-share/workspace-share-slice';
  import WorkspaceTokenUsage from './sidebar/WorkspaceTokenUsage.svelte';
  import SidebarPrDropdown from './sidebar/SidebarPrDropdown.svelte';
  import WorkspaceAgentsList from './WorkspaceAgentsList.svelte';
  import WorkspaceShellList from './WorkspaceShellList.svelte';
  import SidebarSectionTabs from './sidebar/SidebarSectionTabs.svelte';
  import SidebarBrowserList from './SidebarBrowserList.svelte';
  import { selectEffectiveFileExplorerWorkspacePath } from '$store/renderer/slices/file-explorer/file-explorer-selectors';
  import {
    selectCanShareWorkspace,
    selectIsWorkspaceCollaborator,
    selectWorkspaceActivePullRequest,
    selectWorkspaceById,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectAllNotes,
    selectNotesLoading,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { openTerminalOverlay } from '$store/renderer/slices/terminals/terminals-slice';
  import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectMultiSelectSidebarSelectedTabIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { selectIsCollapsed } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
    normalizeSelectedTabs,
    OWNER_ONLY_TAB_IDS,
    TAB_DEFINITIONS,
    type TabId,
  } from './multi-select-sidebar-tabs';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    active?: boolean;
    panelLayoutId?: string;
    onCreateNote?: () => void;
    onCreateFile?: (folderPath: string, fileName?: string) => void | Promise<void>;
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    isNewWorkspaceSession?: boolean;
    onCreateAgent?: () => void;
    onCreateAgentWithSpecialist?: (specialistId: string | null) => void;
    onAcceptChanges?: () => void;
    class?: string;
  }

  let {
    workspaceId,
    active = true,
    panelLayoutId = workspaceId,
    onCreateNote,
    onCreateFile,
    onFileRenamed,
    onCreateAgent,
    onCreateAgentWithSpecialist,
    onAcceptChanges,
    class: className,
  }: Props = $props();

  let changesRefreshAction = $state<Snippet>();
  const collapsed$ = selectIsCollapsed();

  // Reactive writable store that mirrors workspaceId so Redux selectors
  // re-evaluate whenever the prop changes (called at component init time).
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect.pre below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  $effect.pre(() => {
    workspaceIdStore.set(workspaceId);
  });
  const fileExplorerWorkspacePath = selectEffectiveFileExplorerWorkspacePath(workspaceIdStore);

  // Transient signal: panel tab "Reveal in Sidebar" → scroll & highlight.
  const pendingLocateInSidebar$ = selectPendingLocateInSidebar();

  const workspace = selectWorkspaceById(workspaceIdStore);
  const activePullRequest$ = selectWorkspaceActivePullRequest(workspaceIdStore);
  const prMonitors$ = selectReviewMonitors(workspaceIdStore);
  // Every PR attributable to the workspace (branch PRs, cross-repo entries,
  // agent PR monitors), deduplicated and ordered by status priority.
  const workspacePrRows = $derived.by(() => {
    const ws = $workspace;
    if (!ws) return [];
    const workspaceRepo =
      ws.repositoryOwner && ws.repositoryName
        ? `${ws.repositoryOwner}/${ws.repositoryName}`
        : undefined;
    return buildWorkspacePRPresentationModel({
      workspacePRs: ws.pullRequests,
      activePR: $activePullRequest$ ?? ws.activePullRequest ?? legacyWorkspacePullRequest(ws),
      monitors: $prMonitors$,
      workspaceRepo,
      buildPrUrl: (prNumber, fallbackUrl) =>
        constructPrUrl(prNumber, ws.repositoryOwner, ws.repositoryName, fallbackUrl),
      getDisplayTitle: (pr) => pr.title,
    });
  });
  const notes = selectAllNotes(workspaceIdStore);
  const notesLoading$ = selectNotesLoading(workspaceIdStore);
  const allWorkspaceAgents = selectAllWorkspaceAgents(workspaceIdStore);
  const agentsLoading = selectIsLoadingAgents(workspaceIdStore);
  const retiredCount$ = selectRetiredCount(workspaceIdStore);
  const retiredAgentsLoaded$ = selectRetiredAgentsLoaded(workspaceIdStore);
  const loadingRetired$ = selectIsLoadingRetiredAgents(workspaceIdStore);
  const scopeCounts$ = selectScopeCounts(workspaceIdStore);
  const delegatedAgentsLoaded$ = selectDelegatedAgentsLoaded(workspaceIdStore);
  const loadingDelegated$ = selectIsLoadingDelegatedAgents(workspaceIdStore);
  const delegatedCounts$ = selectDelegatedCounts(workspaceIdStore);
  const loadedDelegatedParentIds$ = selectLoadedDelegatedParentIds(workspaceIdStore);
  const loadingDelegatedParentIds$ = selectLoadingDelegatedParentIds(workspaceIdStore);
  const orphanedDelegatedAgentsLoaded$ = selectOrphanedDelegatedAgentsLoaded(workspaceIdStore);
  const orphanedDelegatedAgentIds$ = selectOrphanedDelegatedAgentIds(workspaceIdStore);
  const loadingOrphanedDelegated$ = selectIsLoadingOrphanedDelegatedAgents(workspaceIdStore);
  const backgroundAgentsLoaded$ = selectBackgroundAgentsLoaded(workspaceIdStore);
  const loadingBackground$ = selectIsLoadingBackgroundAgents(workspaceIdStore);
  const isCollaborator$ = selectIsWorkspaceCollaborator(workspaceIdStore);
  const isCollaborator = $derived($isCollaborator$);
  const presencePeople$ = selectWorkspacePeopleTilePeople(workspaceIdStore);
  const showPeople = $derived($presencePeople$.length > 0);
  const canShare$ = selectCanShareWorkspace(workspaceIdStore);
  const selectedTabIds = selectMultiSelectSidebarSelectedTabIds(workspaceIdStore);
  const selectedTabs = $derived(normalizeSelectedTabs($selectedTabIds, isCollaborator, showPeople));
  let agentSearchQuery = $state('');
  let contextSearchQuery = $state('');
  const activeTabId = $derived([...selectedTabs][0] ?? 'agents');
  const panelId = $props.id();
  let mountedTabIds = $state<string[]>([]);
  let direction = $state<'left' | 'right'>('right');
  let previousTabId = $state('');

  $effect(() => {
    const id = activeTabId;
    if (!mountedTabIds.includes(id)) mountedTabIds = [...mountedTabIds, id];
    if (previousTabId && previousTabId !== id) {
      const order = TAB_DEFINITIONS.map((tab) => tab.id);
      direction = order.indexOf(id) > order.indexOf(previousTabId) ? 'right' : 'left';
    }
    previousTabId = id;
  });

  const runningAgentIds = $derived(
    $allWorkspaceAgents
      .filter((agent) => selectAgentIsRunning.select(appStore.state, agent.id))
      .map((agent) => agent.id),
  );

  function persistSelectedTabs(next: Set<TabId>) {
    if (workspaceId) appStore.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, [...next]));
  }

  function createBrowser() {
    panelLayoutManager.openBrowserPanel();
  }

  function createTerminal() {
    appStore.dispatch(openTerminalOverlay(workspaceId));
  }

  function shareWorkspace() {
    if (!$workspace || !selectCanShareWorkspace.select(appStore.state, workspaceId)) return;
    appStore.dispatch(openShareDialog({ workspaceId, workspaceTitle: $workspace.title }));
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

  $effect(() => {
    workspaceId;
    agentSearchQuery = '';
    contextSearchQuery = '';
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

  type PaneOpenEvent = MouseEvent | KeyboardEvent;

  function isAdjacentOpen(event?: PaneOpenEvent): boolean {
    return event ? isCmdClickModifier({ event }) : false;
  }

  function handleOpenAgentInPanel(agentId: string, event?: PaneOpenEvent) {
    if (!$allWorkspaceAgents.some((agent) => agent.id === agentId)) return;
    const sourcePanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
    const openInAdjacentPanel = isAdjacentOpen(event);
    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId,
        panelLayoutId,
        ...(openInAdjacentPanel ? { openInAdjacentPanel: true } : {}),
      }),
    );
  }

  function handleOpenNoteInPanel(noteId: string, event?: PaneOpenEvent) {
    const note = $notes.find((n) => n.id === noteId);
    const title = note?.title || m.workspace_addContext_note_label();
    const tab = {
      type: 'note',
      title,
      closable: true,
      noteId,
      workspaceId,
    } as const;
    if (isAdjacentOpen(event)) {
      const sourcePanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
      panelLayoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId, { force: true });
    } else {
      panelLayoutManager.openUserTab(tab);
    }

    // Mark note as read when opened to clear unread indicator
    appStore.dispatch(markNoteRead(workspaceId, noteId));
  }

  function handleOpenFileInPanel(filePath: string, event?: PaneOpenEvent) {
    const fileName = filePath.split('/').pop() || filePath;
    const tab = {
      type: 'file',
      title: fileName,
      closable: true,
      filePath,
      workspaceId,
    } as const;
    if (isAdjacentOpen(event)) {
      const sourcePanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
      panelLayoutManager.openTabInAdjacentOrSplit(tab, sourcePanelId, { force: true });
    } else {
      panelLayoutManager.openTab(tab);
    }
  }

  function handleOpenCodeReviewInPanel() {
    panelLayoutManager.openTab({
      type: 'code-review',
      title: m.workspace_multiSelectSidebar_codeReview_label(),
      closable: true,
      workspaceId,
    });
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

  let sidebarElement: HTMLDivElement | null = $state(null);

  // Map registry sidebar tab IDs to MultiSelectTabbedSidebar tab IDs
  function mapSidebarTabId(registryTabId: string): TabId | null {
    const mapping: Record<string, TabId> = {
      notes: 'context',
      agents: 'agents',
      files: 'files',
      terminals: 'shell',
      changes: 'changes',
      browser: 'browser',
    };
    return mapping[registryTabId] ?? null;
  }

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.metaKey && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        const workspacePath = selectEffectiveFileExplorerWorkspacePath.select(
          appStore.state,
          workspaceId,
        );
        if (workspacePath) {
          navigator.clipboard.writeText(workspacePath);
          import('$lib/components/patterns/notify').then(({ notify }) => {
            notify.success(m.ui_openCombo_pathCopied_label());
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
    if (!pending || !active) return;
    if (pending.workspaceId !== workspaceId) return;

    const { sidebarTabId, type, noteId, filePath, agentId } = pending.target;

    // Switch to the appropriate sidebar tab
    const targetTab = mapSidebarTabId(sidebarTabId);
    if (targetTab && !(isCollaborator && OWNER_ONLY_TAB_IDS.has(targetTab))) {
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
</script>

<div
  bind:this={sidebarElement}
  class={cn('flex h-full min-w-0 flex-col overflow-hidden bg-sidebar', className)}
  data-workspace-sidebar
>
  <div class="shrink-0 px-4 pt-4 pb-2" data-workspace-title-region>
    <WorkspaceProgressCard {workspaceId} {active} onOpenNote={handleOpenNoteInPanel} />
  </div>
  <div class="shrink-0 px-3 pb-1" hidden={$collapsed$} inert={$collapsed$} data-sidebar-navigation>
    <SidebarSectionTabs {workspaceId} {panelId} />
  </div>
  <div
    class="mx-3 mt-2 mb-3 min-h-0 flex-1 overflow-hidden rounded-(--radius-large) bg-background ring-1 ring-inset ring-border/50"
    data-sidebar-panels
    data-direction={direction}
  >
    {#each TAB_DEFINITIONS.filter(({ id }) => (id !== 'people' || showPeople) && !(isCollaborator && OWNER_ONLY_TAB_IDS.has(id))) as tab (tab.id)}
      {@const tabId = tab.id}
      <section
        id={`${panelId}-${tabId}`}
        role="tabpanel"
        aria-label={tab.label}
        tabindex="0"
        class="sidebar-section h-full min-h-0 flex-col outline-none"
        style:display={tabId === activeTabId ? 'flex' : 'none'}
        hidden={tabId !== activeTabId}
        inert={tabId !== activeTabId}
        data-sidebar-section={tabId}
        data-active={tabId === activeTabId || undefined}
      >
        {#if mountedTabIds.includes(tabId)}
          {#if tab && !tab.hideHeader}
            <div class="shrink-0 px-3 pt-3 pb-2" data-sidebar-section-header>
              <h6 class="flex min-h-7 items-center gap-2 text-sm font-medium text-foreground">
                <span class="min-w-0 truncate">{tab.label}</span>
                <span class="ml-auto flex min-w-0 items-center gap-1">
                  {#if tabId === 'people'}
                    {#if $canShare$}
                      <SidebarHeaderAction
                        icon="plus"
                        label={m.workspace_share_menu_label()}
                        onclick={shareWorkspace}
                      />
                    {/if}
                  {:else if tabId === 'agents'}
                    <WorkspaceTokenUsage {workspaceId} />
                    <SidebarExpandableSearch
                      bind:query={agentSearchQuery}
                      active={active && activeTabId === 'agents'}
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
                      active={active && activeTabId === 'context'}
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
                  {:else if tabId === 'files' && $fileExplorerWorkspacePath}
                    <OpenComboButton
                      filePath={$fileExplorerWorkspacePath}
                      {workspaceId}
                      isDirectory
                      side="bottom"
                      variant="sidebar"
                      iconOnly
                    >
                      <Fa icon={faArrowUpRightFromSquare} class="size-4" />
                      <span class="sr-only">{m.ui_openCombo_openInApp_tooltip()}</span>
                    </OpenComboButton>
                  {:else if tabId === 'changes'}
                    {@render changesRefreshAction?.()}
                    {#if workspacePrRows.length > 0}
                      <SidebarPrDropdown rows={workspacePrRows} {workspaceId} side="bottom" />
                    {/if}
                  {/if}
                </span>
              </h6>
            </div>
          {/if}
          {#key workspaceId}
            <div
              class="min-h-0 flex-1 px-1 pb-2 {tabId === 'files' || tabId === 'changes'
                ? 'overflow-hidden'
                : 'overflow-y-auto'}"
              data-sidebar-section-scroll={tabId}
              use:scrollFade
            >
              {#if tabId === 'people'}
                <WorkspacePeopleActivity {workspaceId} {panelLayoutId} />
              {:else if tabId === 'agents'}
                <div class="min-w-0" data-testid="agent-panel">
                  <WorkspaceAgentsList
                    agents={$allWorkspaceAgents}
                    loading={$agentsLoading}
                    searchQuery={agentSearchQuery}
                    {runningAgentIds}
                    selectedAgentId={effectiveSelectedAgentId}
                    retiredCount={$retiredCount$}
                    retiredAgentsLoaded={$retiredAgentsLoaded$}
                    loadingRetired={$loadingRetired$}
                    onLoadRetired={() => {
                      appStore.dispatch(fetchRetiredAgentsRequested(workspaceId));
                    }}
                    scopeCounts={$scopeCounts$}
                    delegatedAgentsLoaded={$delegatedAgentsLoaded$}
                    loadingDelegated={$loadingDelegated$}
                    onLoadDelegated={(parentAgentId) => {
                      appStore.dispatch(fetchDelegatedAgentsRequested(workspaceId, parentAgentId));
                    }}
                    delegatedCounts={$delegatedCounts$}
                    loadedDelegatedParentIds={$loadedDelegatedParentIds$}
                    loadingDelegatedParentIds={$loadingDelegatedParentIds$}
                    orphanedDelegatedAgentsLoaded={$orphanedDelegatedAgentsLoaded$}
                    orphanedDelegatedAgentIds={$orphanedDelegatedAgentIds$}
                    loadingOrphanedDelegated={$loadingOrphanedDelegated$}
                    onLoadOrphanedDelegated={() => {
                      appStore.dispatch(fetchOrphanedDelegatedAgentsRequested(workspaceId));
                    }}
                    backgroundAgentsLoaded={$backgroundAgentsLoaded$}
                    loadingBackground={$loadingBackground$}
                    onLoadBackground={() => {
                      appStore.dispatch(fetchBackgroundAgentsRequested(workspaceId));
                    }}
                    onSelect={({ agentId, event }) => handleOpenAgentInPanel(agentId, event)}
                    onRestoreRetired={({ agentId }) => {
                      appStore.dispatch(restoreRetiredAgentRequested(workspaceId, agentId));
                    }}
                  />
                </div>
              {:else if tabId === 'context'}
                <div class="min-w-0">
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
                <div class="flex h-full min-h-0 flex-col" data-sidebar-changes-panel>
                  <div class="min-h-0 w-full flex-1">
                    <SidebarChangesPanel
                      {workspaceId}
                      active={active && tabId === activeTabId}
                      onRefreshActionChange={(action) => (changesRefreshAction = action)}
                      activeFilePath={effectiveActiveFilePath}
                      activeFileStaged={effectiveActiveFileStaged}
                      isAllChangesViewActive={effectiveIsAllChangesViewActive}
                      onOpenChange={(change, event) => {
                        const sourcePanelId =
                          selectFocusedPanelId.select(appStore.state, panelLayoutId) ?? undefined;
                        appStore.dispatch(
                          openWorkspaceDiff(workspaceId, change as never, {
                            filePath: change.relativePath || change.file,
                            changeId: change.id,
                            openInAdjacentPanel: isAdjacentOpen(event),
                            sourcePanelId,
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
                <div class="flex h-full min-h-0 flex-col">
                  <!-- File filter controls -->
                  <div class="flex shrink-0 items-center gap-1 px-2 pb-2" data-file-tree-toolbar>
                    <ExpandableFileSearch
                      bind:query={fileSearchQuery}
                      active={active && activeTabId === 'files'}
                      onKeydown={(event) => filesPanelRef?.handleSearchKeyDown(event)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      class="shrink-0 text-muted-foreground"
                      tooltip={m.workspace_multiSelectSidebar_newFile_tooltip()}
                      onclick={() => filesPanelRef?.startCreatingFile()}
                    >
                      <Fa icon={faPlus} class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      class="shrink-0 {showOnlyChangedFiles
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground'}"
                      aria-pressed={showOnlyChangedFiles}
                      tooltip={showOnlyChangedFiles
                        ? m.workspace_multiSelectSidebar_showAllFiles_tooltip()
                        : m.workspace_multiSelectSidebar_showOnlyChangedFiles_tooltip()}
                      onclick={() => (showOnlyChangedFiles = !showOnlyChangedFiles)}
                    >
                      <Fa icon={faPencil} class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      class="shrink-0 text-muted-foreground"
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
                        class="size-3.5"
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
                  />
                </div>
              {:else if tabId === 'browser'}
                <SidebarBrowserList {workspaceId} {panelLayoutId} />
              {:else if tabId === 'shell'}
                <WorkspaceShellList {workspaceId} />
              {/if}
            </div>
          {/key}
        {/if}
      </section>
    {/each}
  </div>
</div>
