<script lang="ts">
  import { microConnectedReadable } from '$features/hardware-console/device/connection-status';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { homeWorkspaceMotion } from './home-workspace-motion.svelte';
  import { homeSidebarMotion } from './home-sidebar-motion';
  import './home.css';
  import { openAndShowWorkspace } from '$lib/utils/show-workspace';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import {
    selectLabelsSupported,
    selectPinnedWorkspaceIds,
    selectWorkspaceLabelsInUse,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { buildHomeListGroups } from './home-workspace-labels';
  import {
    createHomeDoubleClickOpener,
    openHomeWorkspaceFromEvent,
  } from './home-workspace-opening';
  import { createHomeWorkspaceMenu } from './home-workspace-menu';
  import { tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import HomeWorkspaceSettings from './HomeWorkspaceSettings.svelte';
  import HomeWorkspaceControls from './HomeWorkspaceControls.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Screen, EmptyState, ErrorState } from '$lib/components/patterns/screen';
  import HomeLoading from './HomeLoading.svelte';
  import { springIn, crispOut, animatedHeight } from '$lib/motion';
  import ChiefCard from '$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte';
  import HomeAssistantThreads from './HomeAssistantThreads.svelte';
  import HomeAssistantPanels from './HomeAssistantPanels.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import {
    buildRepoPathLookup,
    groupWorkspacesByRepository,
  } from '$lib/components/workspace/utils/workspace-grouping';
  import {
    selectWorkspaceItems,
    selectWorkspaceById,
    selectWorkspaceHasLoaded,
    selectIsCollaboratorOnlyClient,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectKnownRepos,
    selectKnownReposLoaded,
  } from '$store/renderer/slices/known-repos/known-repos-selectors';
  import { loadKnownRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
  import {
    openPanel,
    closePanel,
    setShowCreateModal,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectPanelItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { store } from '$store/renderer/store';
  import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
  import { compareHomeActivityDesc, getHomeActivityTime } from './home-activity';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import Fa from 'svelte-fa';
  import {
    faLayerGroup,
    faFolder,
    faCircleExclamation,
    faPlay,
    faHourglass,
    faPlus,
    faChevronRight,
  } from '@fortawesome/free-solid-svg-icons';
  import {
    getHomeTriageGroup,
    matchesHomeFilter,
    needsAttention,
    type HomeFilter,
    type HomeRepository,
  } from './home-model';
  import HomeWorkspaceDetail from './HomeWorkspaceDetail.svelte';
  import HomePreviewPane from './HomePreviewPane.svelte';
  import HomeWorkspaceBoard from './HomeWorkspaceBoard.svelte';
  import HomeWorkspaceList from './HomeWorkspaceList.svelte';
  import { groupHomeWorkspacesByStatus } from './home-workspace-status-groups';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import { openHomeIntegrationUrl } from './home-integrations-slice';
  import {
    selectHomeWorkspaceView,
    selectHomeWorkspaceError,
    selectHomeSetAsideWorkspaceIds,
    selectHomeWorkspaceIsSetAside,
    selectHomePersistenceScope,
  } from './home-workspaces-selectors';
  import {
    HOME_SET_ASIDE_GROUP,
    bringBackHomeWorkspaceNow,
    neighborHomeWorkspaceId,
    restoreHomeFocusAfterMove,
    setHomeWorkspaceAsideWithUndo,
  } from './home-set-aside';
  import { handleHomeSetAsideShortcut } from './home-set-aside-shortcut';
  import { updateHomeWorkspaceView } from './home-workspaces-slice';
  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import { homeRetiredWorkspaces } from './home-retired-workspaces.svelte';
  import { selectPrincipalActionContext as admissionSelector } from '$store/renderer/slices/principal/principal-selectors';
  import HomeIntegrations from './HomeIntegrations.svelte';
  import type { HomeIntegrationsState } from './home-integrations-types';

  let {
    preview = false,
    integrationPreview,
  }: {
    preview?: boolean;
    integrationPreview?: Partial<Record<'prs' | 'linear', HomeIntegrationsState>>;
  } = $props();
  const microConnected$ = microConnectedReadable();
  const pinnedIds$ = selectPinnedWorkspaceIds();
  const labelsInUse$ = selectWorkspaceLabelsInUse();
  const labelsSupported$ = selectLabelsSupported();
  let contextMenu = $state<(SidebarContextPosition & { workspace: Workspace }) | null>(null);
  function openWorkspace(id: string) {
    contextMenu = null;
    void openAndShowWorkspace(id);
  }
  function openSelectedWorkspace(id: string) {
    updateView({ selectedId: id });
    openWorkspace(id);
  }
  const doubleClick = createHomeDoubleClickOpener(openSelectedWorkspace);
  function openModifiedWorkspace(event: MouseEvent | KeyboardEvent, id: string) {
    if (event instanceof MouseEvent) doubleClick.arm(event, id);
    openHomeWorkspaceFromEvent(event, id, openWorkspace);
  }
  function showWorkspaceMenu(event: MouseEvent | KeyboardEvent, workspace: Workspace) {
    const position = getSidebarContextPosition(event);
    if (!position) return;
    contextMenu = {
      ...position,
      returnFocus:
        position.returnFocus?.closest<HTMLElement>('[role="option"], button') ??
        position.returnFocus,
      workspace,
    };
  }
  function showListMenu(
    event: MouseEvent | KeyboardEvent,
    workspace: Workspace,
    option?: HTMLElement,
  ) {
    showWorkspaceMenu(event, workspace);
    if (
      contextMenu &&
      option &&
      event instanceof KeyboardEvent &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      const bounds = option.getBoundingClientRect();
      contextMenu = { ...contextMenu, x: bounds.left, y: bounds.bottom, returnFocus: option };
    }
  }
  function workspaceMenu(workspace: Workspace): SidebarMenuEntry[] {
    return createHomeWorkspaceMenu(workspace, {
      microConnected: $microConnected$,
      pinned: $pinnedIds$.includes(workspace.id),
      onOpen: openWorkspace,
      onClose: () => (contextMenu = null),
      expandGroup: (key) =>
        updateView({ expandedGroups: { ...$view$.expandedGroups, [key]: true } }),
      getHomeElement: () => homeElement,
      aside: { setAside: asideSet.has(workspace.id), onToggle: () => toggleAside(workspace) },
    });
  }
  const asideIds$ = selectHomeSetAsideWorkspaceIds();
  const persistenceScope$ = selectHomePersistenceScope();
  const asideSet = $derived(new Set($asideIds$));
  // Moving a row keeps the selection (and its mounted preview and drafts); focus only
  // moves when it left with the row.
  function isLive(workspace: Workspace): boolean {
    return (
      workspace.status !== WorkspaceStatusEnum.Deleted &&
      workspace.status !== WorkspaceStatusEnum.Archived &&
      workspace.status !== WorkspaceStatusEnum.Retired &&
      !workspace.pendingDeleteAt
    );
  }
  function toggleAside(workspace: Workspace, focusMoved = false, expectedScope?: string) {
    if (expectedScope !== undefined) {
      const state = store.state;
      const live = selectWorkspaceById.select(state, workspace.id);
      if (
        selectHomePersistenceScope.select(state) !== expectedScope ||
        selectHomeWorkspaceIsSetAside.select(state, workspace.id) ||
        !live ||
        !isLive(live)
      )
        return;
      workspace = live;
    }
    const neighbor = focusMoved ? null : neighborHomeWorkspaceId(homeElement, workspace.id);
    if (asideSet.has(workspace.id)) bringBackHomeWorkspaceNow(workspace.id);
    else setHomeWorkspaceAsideWithUndo(workspace);
    restoreHomeFocusAfterMove(() => homeElement, neighbor, workspace.id);
  }
  const workspaces$ = selectWorkspaceItems();
  const hasLoaded$ = selectWorkspaceHasLoaded();
  const knownRepos$ = selectKnownRepos();
  const knownReposLoaded$ = selectKnownReposLoaded();
  const collaborator$ = selectIsCollaboratorOnlyClient();
  const panelItem$ = selectPanelItem();
  $effect(() => {
    if (!preview && !$collaborator$ && !$knownReposLoaded$) store.dispatch(loadKnownRepos());
  });
  const destination = $derived(
    !$collaborator$ && $panelItem$ === 'chief' ? 'assistant' : 'workspaces',
  );
  let mainDirection = $state(1);
  let previousDestination = untrack(() => destination);
  $effect.pre(() => {
    const next = destination;
    untrack(() => {
      if (next !== previousDestination) {
        mainDirection = next === 'assistant' ? 1 : -1;
        previousDestination = next;
      }
    });
  });
  let assistantActivated = $state(false);
  $effect(() => {
    if (destination === 'assistant') assistantActivated = true;
  });
  function chooseDestination(value: string) {
    if (value === 'assistant' && !$collaborator$) store.dispatch(openPanel('chief'));
    else if (value === 'workspaces') store.dispatch(closePanel());
  }
  const view$ = selectHomeWorkspaceView();
  const workspaceError$ = selectHomeWorkspaceError();
  const repoKey = $derived($view$.repoKey);
  const filter = $derived($view$.filter);
  const tab = $derived($view$.tab);
  const query = $derived($view$.query);
  const selectedId = $derived($view$.selectedId);
  function updateView(changes: Parameters<typeof updateHomeWorkspaceView>[0]) {
    store.dispatch(updateHomeWorkspaceView(changes));
  }
  const workspaces = $derived(
    $workspaces$.filter(
      (workspace) => workspace.status !== WorkspaceStatusEnum.Deleted && !workspace.pendingDeleteAt,
    ),
  );
  const repositoryGroups = $derived(
    groupWorkspacesByRepository({
      workspaces,
      knownRepos: $collaborator$ ? [] : $knownRepos$,
      repoPathLookup: buildRepoPathLookup(workspaces, $collaborator$ ? [] : $knownRepos$),
      includeKnownRepos: !$collaborator$,
    }).sort(
      (a, b) =>
        Math.max(0, ...b.workspaces.map(getHomeActivityTime)) -
          Math.max(0, ...a.workspaces.map(getHomeActivityTime)) || a.label.localeCompare(b.label),
    ),
  );
  const selectedRepository = $derived(repositoryGroups.find((repo) => repo.key === repoKey));
  // Counts and triage describe active work.
  function isActive(workspace: Workspace): boolean {
    return matchesHomeFilter(workspace, 'all') && !asideSet.has(workspace.id);
  }
  function countNeedsYou(items: readonly Workspace[]): number {
    return items.filter((workspace) => isActive(workspace) && needsAttention(workspace)).length;
  }
  // Local repositories participate in the same grouping and ordering as orgs.
  const sidebar = $derived.by(() => {
    const groups: { key: string; owner?: string; label: string; items: typeof repositoryGroups }[] =
      [];
    const unassigned: typeof repositoryGroups = [];
    for (const repo of repositoryGroups) {
      if (repo.key === m.workspace_grouping_unknownRepository_label()) {
        unassigned.push(repo);
        continue;
      }
      const key = repo.owner ? `org:${repo.owner.toLowerCase()}` : 'local';
      let group = groups.find((candidate) => candidate.key === key);
      if (!group) {
        group = {
          key,
          owner: repo.owner,
          label: repo.owner || m.onboarding_projectPicker_localFolder_label(),
          items: [],
        };
        groups.push(group);
      }
      group.items.push(repo);
    }
    const count = (items: typeof repositoryGroups) =>
      items.reduce((total, repo) => total + repo.workspaces.filter(isActive).length, 0);
    groups.sort((a, b) => count(b.items) - count(a.items) || a.label.localeCompare(b.label));
    for (const group of groups) {
      group.items.sort((a, b) => count([b]) - count([a]) || a.label.localeCompare(b.label));
    }
    return { groups, unassigned };
  });
  const selectedOrg = $derived(sidebar.groups.find((group) => `sidebar:${group.key}` === repoKey));
  const scopedWorkspaces = $derived(
    selectedRepository?.workspaces ??
      selectedOrg?.items.flatMap((repo) => repo.workspaces) ??
      workspaces,
  );
  let dateFilterNow = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      dateFilterNow = Date.now();
    }, 60_000);
    return () => clearInterval(timer);
  });
  const dateScopedWorkspaces = $derived(
    scopedWorkspaces.filter((workspace) => {
      const range = $view$.updatedWithin ?? 'all';
      if (range === 'all') return true;
      const days = range === 'day' ? 1 : range === 'week' ? 7 : 30;
      const time = getHomeActivityTime(workspace);
      return time > 0 && time <= dateFilterNow && time >= dateFilterNow - days * 86_400_000;
    }),
  );
  const repositories: HomeRepository[] = $derived(
    (selectedRepository ? [selectedRepository] : (selectedOrg?.items ?? repositoryGroups)).map(
      (repo) => ({
        key: repo.key,
        name: repo.name ?? repo.label,
        owner: repo.owner,
        path: repo.repoPath,
      }),
    ),
  );
  const filters = $derived(
    (
      [
        { id: 'all', label: m.home_integrations_all(), icon: faLayerGroup },
        { id: 'attention', label: m.home_filter_attention(), icon: faCircleExclamation },
        { id: 'running', label: m.home_filter_running(), icon: faPlay },
        { id: 'waiting', label: m.home_filter_waiting(), icon: faHourglass },
      ] as const satisfies readonly { id: HomeFilter; label: string; icon: unknown }[]
    ).map((item) => ({
      ...item,
      count: dateScopedWorkspaces.filter(
        (workspace) => matchesHomeFilter(workspace, item.id) && !asideSet.has(workspace.id),
      ).length,
    })),
  );
  const matchedWorkspaces = $derived(
    dateScopedWorkspaces
      .filter(
        (workspace) =>
          matchesHomeFilter(workspace, filter) &&
          (!query.trim() ||
            [
              workspace.title,
              workspace.repositoryName,
              workspace.repositoryOwner,
              workspace.branch,
              workspace.statusMessage,
            ].some((value) =>
              value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
            )),
      )
      .sort(
        (a, b) =>
          Number($pinnedIds$.includes(b.id)) - Number($pinnedIds$.includes(a.id)) ||
          Number(needsAttention(b)) - Number(needsAttention(a)) ||
          compareHomeActivityDesc(a, b),
      ),
  );
  // Archived is its own view; set-aside work has a separate collection.
  const filteredWorkspaces = $derived(
    filter === 'archived'
      ? matchedWorkspaces
      : matchedWorkspaces.filter((workspace) => !asideSet.has(workspace.id)),
  );
  const asideWorkspaces = $derived(
    filter === 'archived'
      ? []
      : matchedWorkspaces
          .filter((workspace) => asideSet.has(workspace.id))
          .sort(compareHomeActivityDesc),
  );
  const selectedWorkspace = $derived(
    filteredWorkspaces.find((workspace) => workspace.id === selectedId) ??
      asideWorkspaces.find((workspace) => workspace.id === selectedId),
  );
  // The shelf starts collapsed; a search opens it so matching work is never hidden.
  let asideCollapsedForQuery = $state<string | null>(null);
  const asideExpanded = $derived(
    query.trim()
      ? asideCollapsedForQuery !== query.trim()
      : $view$.expandedGroups[HOME_SET_ASIDE_GROUP] === true,
  );
  function setAsideExpanded(expanded: boolean) {
    if (query.trim()) {
      asideCollapsedForQuery = expanded ? null : query.trim();
      return;
    }
    updateView({ expandedGroups: { ...$view$.expandedGroups, [HOME_SET_ASIDE_GROUP]: expanded } });
  }
  const triageOrder = ['needs-you', 'running', 'waiting', 'inactive'] as const;
  // Hiding a group that holds the selected workspace also closes the preview;
  // otherwise the selection would keep the group open and the button inert.
  function setGroupExpanded(group: string, expanded: boolean, items: Workspace[]) {
    const holdsSelection = items.some((workspace) => workspace.id === selectedId);
    updateView({
      expandedGroups: { ...$view$.expandedGroups, [group]: expanded },
      ...(!expanded && holdsSelection ? { selectedId: null } : {}),
    });
  }
  function groupLabel(group: string): string {
    switch (group) {
      case 'needs-you':
        return m.home_filter_attention();
      case 'running':
        return m.home_filter_running();
      case 'waiting':
        return m.home_filter_waiting();
      case 'blocked':
        return m.home_filter_blocked();
      default:
        return m.home_board_done_idle();
    }
  }
  // Grouping is only meaningful on the unfiltered list; a status filter already
  // names the group, and archived rows have no live triage state.
  const triageGroups = $derived(
    filter === 'all' && $view$.groupBy === 'status'
      ? triageOrder.flatMap((id) => {
          const items = filteredWorkspaces.filter((workspace) => {
            const group = getHomeTriageGroup(workspace);
            return (
              (group === 'blocked'
                ? 'needs-you'
                : group === 'done' || group === 'idle'
                  ? 'inactive'
                  : group) === id
            );
          });
          if (items.length === 0) return [];
          const expanded =
            $view$.expandedGroups[id] !== false ||
            items.some((workspace) => workspace.id === selectedId);
          return [{ id, label: groupLabel(id), items, expanded, collapsible: true }];
        })
      : [],
  );
  const repositorySections = $derived(
    repositoryGroups.flatMap((repo) => {
      const items = filteredWorkspaces.filter((workspace) =>
        repo.workspaces.some((candidate) => candidate.id === workspace.id),
      );
      return items.length
        ? [
            {
              id: repo.key,
              label: repo.label,
              items,
              expanded:
                $view$.expandedGroups[repo.key] !== false ||
                items.some((workspace) => workspace.id === selectedId),
              collapsible: true,
            },
          ]
        : [];
    }),
  );
  const statusGroups = $derived(
    groupHomeWorkspacesByStatus(filteredWorkspaces).map((group) => ({
      ...group,
      expanded:
        $view$.expandedGroups[group.id] !== false ||
        group.items.some((workspace) => workspace.id === selectedId),
      collapsible: true,
    })),
  );
  const listGroups = $derived(
    buildHomeListGroups({
      groupBy: $view$.groupBy,
      filter,
      baseGroups:
        $view$.groupBy === 'repository'
          ? repositorySections
          : $view$.groupBy === 'workspace-status'
            ? statusGroups
            : triageGroups,
      workspaces: filteredWorkspaces,
      pinnedIds: $pinnedIds$,
      labels: $labelsInUse$,
      labelsSupported: $labelsSupported$,
      pinnedLabel: m.layout_activeCard_pinned_header(),
      expandedGroups: $view$.expandedGroups,
      selectedId,
    }),
  );
  const boardGroups = $derived(
    $view$.groupBy === 'repository'
      ? repositorySections
      : $view$.groupBy === 'none'
        ? [{ id: 'all', label: m.home_filter_all(), items: filteredWorkspaces }]
        : undefined,
  );
  const integrationWorkspaceId = $derived($collaborator$ ? scopedWorkspaces[0]?.id : undefined);
  const selectedRepositoryGithubUrl = $derived(
    selectedRepository?.owner && selectedRepository.name
      ? `https://github.com/${encodeURIComponent(selectedRepository.owner)}/${encodeURIComponent(selectedRepository.name)}`
      : selectedOrg?.owner
        ? `https://github.com/${encodeURIComponent(selectedOrg.owner)}`
        : null,
  );
  let homeElement = $state<HTMLDivElement | null>(null);
  const homePanes = new Map<HTMLElement, typeof tab>();
  let tabFocus = $state<{ value: typeof tab } | null>(null);
  function syncPaneOwnership(pane: HTMLElement, value: typeof tab) {
    pane.inert = destination !== 'workspaces' || value !== tab;
    if (!pane.inert) pane.removeAttribute('aria-hidden');
    else pane.setAttribute('aria-hidden', 'true');
  }
  function registerHomePane(pane: HTMLElement, value: typeof tab) {
    homePanes.set(pane, value);
    syncPaneOwnership(pane, value);
    return { destroy: () => homePanes.delete(pane) };
  }
  $effect.pre(() => {
    const activeTab = destination === 'workspaces' ? tab : null;
    untrack(() => {
      for (const [pane, value] of homePanes) syncPaneOwnership(pane, value);
      if (tabFocus?.value !== activeTab) tabFocus = null;
    });
  });
  $effect(() => {
    const intent = tabFocus;
    if (!intent || destination !== 'workspaces' || intent.value !== tab) return;
    void tick().then(() => {
      if (tabFocus !== intent || destination !== 'workspaces' || tab !== intent.value) return;
      const pane = [...homePanes].find(
        ([node, value]) => value === intent.value && node.isConnected && !node.inert,
      )?.[0];
      const trigger = pane?.querySelector<HTMLElement>(`[role=tab][data-value="${intent.value}"]`);
      trigger?.focus();
      if (trigger && document.activeElement === trigger) tabFocus = null;
    });
  });
  let pendingFocusId = $state<string | null>(null);
  function closePreview() {
    pendingFocusId = selectedId;
    updateView({ selectedId: null });
  }
  $effect(() => {
    if (selectedWorkspace || !pendingFocusId) return;
    const id = pendingFocusId;
    pendingFocusId = null;
    void tick().then(() => {
      const row = homeElement?.querySelector<HTMLElement>(
        `[data-home-workspace="${CSS.escape(id)}"]`,
      );
      row?.closest<HTMLElement>('[role="option"], button')?.focus();
    });
  });
  homeRetiredWorkspaces(() => ({ filter, preview }), workspaces$, admissionSelector());
  function chooseFilter(next: HomeFilter) {
    store.dispatch(closePanel());
    updateView({ filter: next, tab: 'workspaces', selectedId: null });
  }
  function chooseRepo(key: string | null) {
    store.dispatch(closePanel());
    updateView({
      repoKey: key,
      selectedId: null,
    });
  }
  homeWorkspaceMotion(
    () => homeElement ?? undefined,
    () => [
      listGroups,
      boardGroups,
      filteredWorkspaces,
      asideWorkspaces,
      asideExpanded,
      $view$.view,
    ],
    () => tab,
  );
  // New space resolves the selected Home repository itself
  // (`defaultToSidebarRepository`), so Home only opens it.
  function createWorkspace() {
    store.dispatch(setShowCreateModal(true));
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (
      destination === 'workspaces' &&
      tab === 'workspaces' &&
      handleHomeSetAsideShortcut(event, (id) => {
        const workspace = workspaces.find((candidate) => candidate.id === id);
        if (workspace && isLive(workspace)) toggleAside(workspace);
      })
    )
      return;
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      selectedWorkspace &&
      tab === 'workspaces'
    ) {
      event.preventDefault();
      void closePreview();
    }
  }}
/>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    returnFocus={contextMenu.returnFocus}
    items={workspaceMenu(contextMenu.workspace)}
    onClickOutside={() => (contextMenu = null)}
  />
{/if}

<div
  bind:this={homeElement}
  {@attach doubleClick.listen}
  class="home-layout h-full min-h-0 min-w-0 bg-sidebar text-foreground"
  class:home-assistant={destination === 'assistant' && !$collaborator$}
  data-home-page
  use:homeSidebarMotion={destination}
>
  <ResizablePanel
    storageKey="home-repository-sidebar-width"
    side="left"
    minWidth={200}
    maxWidth={360}
    defaultWidth={224}
    className="home-sidebar-resizable flex h-full min-h-0 flex-col"
    handleClassName="home-sidebar-resize-handle"
  >
    <nav
      class="home-sidebar flex h-full min-h-0 flex-col px-2 py-3"
      aria-label={m.home_navigation_label()}
    >
      {#snippet sidebarCounts(items: readonly Workspace[], showStatus = true)}
        {@const needsYou = countNeedsYou(items) > 0}
        {@const running = items.some((workspace) => matchesHomeFilter(workspace, 'running'))}
        {#if showStatus && (needsYou || running)}
          <Tooltip.Provider
            ><Tooltip.Root
              ><Tooltip.Trigger
                >{#snippet child({ props: homeTooltipProps })}<span
                    {...homeTooltipProps}
                    class="size-1.5 shrink-0 rounded-full"
                    style:background={needsYou
                      ? 'hsl(var(--workspace-status-unread))'
                      : 'hsl(var(--warning))'}
                    role="img"
                    aria-label={needsYou ? m.home_filter_attention() : m.home_filter_running()}
                  ></span>{/snippet}</Tooltip.Trigger
              ><Tooltip.Content
                >{needsYou ? m.home_filter_attention() : m.home_filter_running()}</Tooltip.Content
              ></Tooltip.Root
            ></Tooltip.Provider
          >
        {/if}
        <span class="shrink-0 text-xs font-normal tabular-nums text-muted-foreground"
          >{formatInteger(items.filter(isActive).length)}</span
        >
      {/snippet}
      {#snippet repoButton(repo: (typeof repositoryGroups)[number])}
        <Tooltip.Tooltip content={repo.label} class="flex w-full">
          <Button
            variant="ghost"
            active={repoKey === repo.key && destination === 'workspaces'}
            class="w-full justify-start px-2"
            aria-label={repo.key === m.workspace_grouping_unknownRepository_label()
              ? m.fileTracking_startNew_noRepository_label()
              : repo.label}
            onclick={() => chooseRepo(repo.key)}
          >
            <span class="flex-1 truncate text-left font-normal"
              >{repo.key === m.workspace_grouping_unknownRepository_label()
                ? m.fileTracking_startNew_noRepository_label()
                : repo.name || repo.label}</span
            >
            {@render sidebarCounts(repo.workspaces)}
          </Button>
        </Tooltip.Tooltip>
      {/snippet}
      <Tabs.Root
        value={destination}
        onValueChange={chooseDestination}
        size="compact"
        class="flex min-h-0 flex-1 flex-col"
      >
        {#if !$collaborator$}
          <div class="home-sidebar-header flex shrink-0 items-end">
            <Tabs.List
              aria-label={m.layout_sidebarPanel_tabs_ariaLabel()}
              class="home-sidebar-tabs grid h-9 w-full shrink-0 grid-cols-2 items-center rounded-lg bg-background p-1"
            >
              <Tabs.Trigger value="workspaces" class="min-w-0 px-1 font-medium">
                {m.home_tab_workspaces()}
              </Tabs.Trigger>
              <Tabs.Trigger value="assistant" class="min-w-0 px-1 font-medium">
                {m.home_assistant()}
              </Tabs.Trigger>
            </Tabs.List>
          </div>
        {/if}
        <div class="home-sidebar-contents">
          <Tabs.Content
            value="workspaces"
            class="home-sidebar-content mt-0 min-h-0 overflow-y-auto"
            inert={destination !== 'workspaces'}
            aria-hidden={destination !== 'workspaces'}
          >
            <Button
              variant="ghost"
              active={repoKey === null && destination === 'workspaces'}
              class="mb-1 h-9 w-full justify-start px-2 py-2"
              onclick={() => chooseRepo(null)}
              ><span class="flex-1 text-left">{m.home_all_repositories()}</span
              >{@render sidebarCounts(workspaces, false)}</Button
            >
            {#each sidebar.groups as group (group.key)}
              {@const expansionKey = `sidebar:${group.key}`}
              {@const expanded = $view$.expandedGroups[expansionKey] !== false}
              <div class="mt-4" data-home-repository-group={group.owner ?? group.key}>
                <div class="group/org relative flex items-center">
                  <Button
                    variant="ghost"
                    active={repoKey === expansionKey && destination === 'workspaces'}
                    class="h-9 w-full justify-start gap-2 pl-9 pr-2 text-muted-foreground"
                    onclick={() => chooseRepo(expansionKey)}
                  >
                    <Tooltip.Provider
                      ><Tooltip.Root
                        ><Tooltip.Trigger
                          >{#snippet child({ props: homeTooltipProps })}<span
                              {...homeTooltipProps}
                              class="min-w-0 flex-1 truncate text-left font-medium"
                              >{group.label}</span
                            >{/snippet}</Tooltip.Trigger
                        ><Tooltip.Content>{group.label}</Tooltip.Content></Tooltip.Root
                      ></Tooltip.Provider
                    >
                    {#if !expanded}{@render sidebarCounts(
                        group.items.flatMap((repo) => repo.workspaces),
                      )}{/if}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="absolute left-1 size-7"
                    aria-label={group.label}
                    aria-expanded={expanded}
                    onclick={() =>
                      updateView({
                        expandedGroups: { ...$view$.expandedGroups, [expansionKey]: !expanded },
                      })}
                  >
                    <span
                      class="flex size-5 items-center justify-center group-hover/org:opacity-0 group-focus-within/org:opacity-0"
                    >
                      {#if group.owner}<GitHubAvatar
                          identity={group.owner}
                          size={20}
                          class="shrink-0 rounded-sm"
                        />{:else}<Fa icon={faFolder} />{/if}
                    </span>
                    <span
                      class="absolute flex items-center justify-center opacity-0 group-hover/org:opacity-100 group-focus-within/org:opacity-100"
                    >
                      <Fa
                        icon={faChevronRight}
                        class={expanded ? 'size-3! rotate-90' : 'size-3!'}
                        size={12}
                      />
                    </span>
                  </Button>
                </div>
                <div use:animatedHeight={expanded} inert={!expanded} aria-hidden={!expanded}>
                  <div class="pl-7">
                    {#each group.items as repo (repo.key)}
                      {@render repoButton(repo)}
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
            {#if sidebar.unassigned.length}
              <div class="mt-4">
                {#each sidebar.unassigned as repo (repo.key)}
                  {@render repoButton(repo)}
                {/each}
              </div>
            {/if}
            {#if repositoryGroups.length === 0 && $hasLoaded$}<p
                class="px-2 py-3 type-caption text-muted-foreground"
              >
                {m.home_no_repositories()}
              </p>{/if}
          </Tabs.Content>
          {#if !$collaborator$}
            <Tabs.Content
              value="assistant"
              class="home-sidebar-content mt-0 flex min-h-0 flex-col"
              inert={destination !== 'assistant'}
              aria-hidden={destination !== 'assistant'}
            >
              <HomeAssistantThreads />
            </Tabs.Content>
          {/if}
        </div>
      </Tabs.Root>
    </nav>
  </ResizablePanel>
  <Screen class="home-surface my-3 mr-3 flex min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
    <div class="home-main-contents">
      {#if assistantActivated && !$collaborator$}
        <div
          class="home-destination-content min-h-0 flex-1 overflow-hidden"
          data-home-destination="assistant"
          hidden={destination !== 'assistant'}
          inert={destination !== 'assistant'}
          aria-hidden={destination !== 'assistant'}
        >
          <HomeAssistantPanels isActive={destination === 'assistant'}>
            <ChiefCard threadPicker={false} isActive={destination === 'assistant'} />
          </HomeAssistantPanels>
        </div>
      {/if}
      {#if destination === 'workspaces'}
        {#key tab}
          {@const renderedTab = untrack(() => tab)}
          <div
            class="home-destination-content flex min-h-0 min-w-0 flex-col overflow-hidden"
            data-home-destination="workspaces"
            data-home-view={renderedTab}
            use:registerHomePane={renderedTab}
            in:springIn|global={{ tier: 'moderate', x: mainDirection * 12, y: 0, scale: 1 }}
            out:crispOut|global={{ tier: 'moderate', x: -mainDirection * 12, y: 0, scale: 1 }}
            onoutrostart={(event) => {
              event.currentTarget.inert = true;
              event.currentTarget.setAttribute('aria-hidden', 'true');
              if (tabFocus?.value === renderedTab) tabFocus = null;
            }}
            onintrostart={(event) => {
              if (!event.currentTarget.inert) syncPaneOwnership(event.currentTarget, renderedTab);
            }}
          >
            <Tabs.Root
              bind:value={() => renderedTab, () => undefined}
              onValueChange={(value) => {
                if (
                  value !== tab &&
                  (value === 'workspaces' || value === 'prs' || value === 'linear')
                ) {
                  const order = ['workspaces', 'prs', 'linear'];
                  mainDirection = order.indexOf(value) > order.indexOf(tab) ? 1 : -1;
                  tabFocus = { value };
                  updateView({ tab: value });
                }
              }}
              variant="underline"
              class="flex min-h-0 flex-1 flex-col"
            >
              {#snippet children()}
                {#snippet homeHeader()}
                  <header
                    class="home-header flex shrink-0 items-center gap-x-6 border-b border-border px-6"
                  >
                    <Tabs.List
                      class="home-tabs min-w-0 flex-1 gap-5 px-0"
                      aria-label={m.home_views()}
                    >
                      <Tabs.Trigger value="workspaces">{m.home_tab_workspaces()}</Tabs.Trigger>
                      <Tabs.Trigger value="prs" aria-label={m.home_tab_prs()}>
                        <span class="home-tab-label">{m.home_tab_prs()}</span>
                        <span class="home-tab-logo" aria-hidden="true"
                          ><GitHubIcon size={18} /></span
                        >
                      </Tabs.Trigger>
                      <Tabs.Trigger value="linear" aria-label={m.home_tab_linear()}>
                        <span class="home-tab-label">{m.home_tab_linear()}</span>
                        <span class="home-tab-logo" aria-hidden="true"
                          ><LinearIcon size={18} /></span
                        >
                      </Tabs.Trigger>
                    </Tabs.List>
                    <div class="home-header-actions ml-auto flex items-center gap-2 py-2">
                      {#if selectedRepositoryGithubUrl}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={m.home_repository_metadata_open_github()}
                          tooltip={m.home_repository_metadata_open_github()}
                          onclick={() => {
                            if (selectedRepositoryGithubUrl)
                              store.dispatch(openHomeIntegrationUrl(selectedRepositoryGithubUrl));
                          }}><GitHubIcon size={16} /></Button
                        >
                      {/if}
                      {#if !$collaborator$}<div class="home-create">
                          <Button variant="primary" size="sm" onclick={createWorkspace}
                            >{#snippet leadingIcon()}<Fa
                                icon={faPlus}
                              />{/snippet}{m.home_new_workspace()}</Button
                          >
                        </div>{/if}
                    </div>
                  </header>
                {/snippet}
                <Tabs.Content value="workspaces" class="mt-0 min-h-0 flex-1 overflow-hidden">
                  {#if renderedTab === 'workspaces'}
                    <div
                      class="workspace-content h-full min-h-0"
                      class:has-selection={!!selectedWorkspace}
                    >
                      <section
                        class="workspace-list flex min-h-0 min-w-0 flex-col overflow-hidden home-panel bg-background"
                        aria-label={m.home_tab_workspaces()}
                      >
                        {@render homeHeader()}
                        {#snippet workspaceSettings()}
                          <HomeWorkspaceSettings view={$view$} onchange={updateView} />
                        {/snippet}
                        {#snippet workspaceControls()}
                          <HomeWorkspaceControls
                            {query}
                            {filter}
                            view={$view$.view}
                            {filters}
                            onquery={(query) => updateView({ query })}
                            onfilter={chooseFilter}
                            onview={(view) => updateView({ view })}
                            settings={workspaceSettings}
                          />
                        {/snippet}
                        <div
                          class="flex shrink-0 flex-nowrap items-center gap-3 overflow-x-auto px-6 py-4"
                        >
                          {@render workspaceControls()}
                        </div>
                        {#if $workspaceError$}<ErrorState
                            retryLabel={m.home_retry()}
                            onRetry={() => store.dispatch(loadWorkspacesRequested())}
                            >{#snippet message()}{$workspaceError$}{/snippet}</ErrorState
                          >
                        {:else if !$hasLoaded$}<HomeLoading
                            view={$view$.view}
                            grouped={$view$.groupBy !== 'none'}
                          />
                        {:else if filteredWorkspaces.length === 0 && asideWorkspaces.length === 0}
                          <EmptyState class="flex-1" emphasis="prominent">
                            {#snippet title()}<h2>
                                {workspaces.length === 0
                                  ? m.home_empty_title()
                                  : m.home_no_matches()}
                              </h2>{/snippet}
                            {#snippet description()}<p>
                                {workspaces.length === 0
                                  ? m.home_empty_description()
                                  : m.home_no_matches_description()}
                              </p>{/snippet}
                            {#snippet actions()}
                              {#if workspaces.length === 0 && !$collaborator$}<Button
                                  variant="primary"
                                  onclick={createWorkspace}>{m.home_new_workspace()}</Button
                                >
                              {:else if workspaces.length > 0}<Button
                                  variant="outline"
                                  onclick={() => {
                                    updateView({
                                      query: '',
                                      filter: 'all',
                                      repoKey: null,
                                      updatedWithin: 'all',
                                    });
                                  }}>{m.home_clear_filters()}</Button
                                >{/if}
                            {/snippet}
                          </EmptyState>
                        {:else if $view$.view === 'board'}
                          <HomeWorkspaceBoard
                            workspaces={filteredWorkspaces}
                            pinnedIds={$pinnedIds$}
                            groups={boardGroups}
                            showRepository={!selectedRepository}
                            showRepositoryOwner={!selectedOrg}
                            {selectedId}
                            onselect={(id) =>
                              updateView({ selectedId: selectedId === id ? null : id })}
                            onopen={openWorkspace}
                            {doubleClick}
                            oncontextmenu={showWorkspaceMenu}
                            archived={filter === 'archived'}
                            aside={asideWorkspaces}
                            dragScope={$persistenceScope$}
                            ontoggleaside={toggleAside}
                          />
                        {:else}
                          <HomeWorkspaceList
                            workspaces={filteredWorkspaces}
                            groups={listGroups}
                            aside={asideWorkspaces}
                            {asideExpanded}
                            pinnedIds={$pinnedIds$}
                            selectedId={selectedWorkspace?.id ?? null}
                            showRepository={!selectedRepository}
                            showRepositoryOwner={!selectedOrg}
                            menu={workspaceMenu}
                            onopen={openModifiedWorkspace}
                            onmenu={showListMenu}
                            onselect={(id) => updateView({ selectedId: id })}
                            ongroupexpanded={setGroupExpanded}
                            onasideexpanded={setAsideExpanded}
                            ontoggleaside={toggleAside}
                          />
                        {/if}
                      </section>
                      {#if selectedWorkspace}
                        <HomePreviewPane>
                          {#key selectedWorkspace.id}<HomeWorkspaceDetail
                              workspace={selectedWorkspace}
                              onclose={closePreview}
                              {preview}
                            />{/key}
                        </HomePreviewPane>
                      {/if}
                    </div>
                  {/if}
                </Tabs.Content>
                <Tabs.Content value="prs" class="mt-0 min-h-0 flex-1 overflow-hidden"
                  >{#if renderedTab === 'prs'}<div class="h-full min-h-0">
                      <HomeIntegrations
                        header={homeHeader}
                        kind="prs"
                        scopedWorkspaceIds={scopedWorkspaces.map((workspace) => workspace.id)}
                        organization={selectedOrg?.owner}
                        preview={integrationPreview?.prs}
                        {repositories}
                        workspaceId={integrationWorkspaceId}
                      />
                    </div>{/if}</Tabs.Content
                >
                <Tabs.Content value="linear" class="mt-0 min-h-0 flex-1 overflow-hidden"
                  >{#if renderedTab === 'linear'}<div class="h-full min-h-0">
                      <HomeIntegrations
                        header={homeHeader}
                        kind="linear"
                        preview={integrationPreview?.linear}
                        {repositories}
                        workspaceId={integrationWorkspaceId}
                      />
                    </div>{/if}</Tabs.Content
                >
              {/snippet}
            </Tabs.Root>
          </div>
        {/key}
      {/if}
    </div>
  </Screen>
</div>
