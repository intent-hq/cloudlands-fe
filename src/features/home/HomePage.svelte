<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { homeWorkspaceMotion } from './home-workspace-motion.svelte';
  import './home.css';
  import { goto } from '$app/navigation';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import SidebarOverflowMenu from '$lib/components/ui/sidebar-context-menu/SidebarOverflowMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import { selectPinnedWorkspaceIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { togglePinWorkspace } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    requestArchiveWorkspace,
    requestUnarchiveWorkspace,
    requestDeleteWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    faThumbtack,
    faBoxArchive,
    faBoxOpen,
    faTrash,
    faArrowUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import HomeWorkspaceSettings from './HomeWorkspaceSettings.svelte';
  import HomeWorkspaceControls from './HomeWorkspaceControls.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { ListRow, ListView, SectionedList } from '$lib/components/patterns/collection';
  import { Screen, EmptyState, ErrorState } from '$lib/components/patterns/screen';
  import HomeLoading from './HomeLoading.svelte';
  import { fly, animatedHeight } from '$lib/motion';
  import ChiefCard from '$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte';
  import HomeActivityTime from './HomeActivityTime.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
  import {
    buildRepoPathLookup,
    groupWorkspacesByRepository,
  } from '$lib/components/workspace/utils/workspace-grouping';
  import {
    selectWorkspaceItems,
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
    faPlus,
    faChevronDown,
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
  import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import { openHomeIntegrationUrl } from './home-integrations-slice';
  import { selectHomeWorkspaceView, selectHomeWorkspaceError } from './home-workspaces-selectors';
  import { updateHomeWorkspaceView } from './home-workspaces-slice';
  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import { setWorkspaceInitializerLastSelectedRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import HomeIntegrations from './HomeIntegrations.svelte';
  import type { HomeIntegrationsState } from './home-integrations-types';

  let {
    preview = false,
    integrationPreview,
  }: {
    preview?: boolean;
    integrationPreview?: Partial<Record<'prs' | 'linear', HomeIntegrationsState>>;
  } = $props();
  const pinnedIds$ = selectPinnedWorkspaceIds();
  let contextMenu = $state<(SidebarContextPosition & { workspace: Workspace }) | null>(null);
  function showWorkspaceMenu(event: MouseEvent | KeyboardEvent, workspace: Workspace) {
    const position = getSidebarContextPosition(event);
    if (!position) return;
    contextMenu = {
      ...position,
      returnFocus: position.returnFocus?.closest('[role="option"]') as HTMLElement | null,
      workspace,
    };
  }
  function workspaceMenu(workspace: Workspace): SidebarMenuEntry[] {
    const pinned = $pinnedIds$.includes(workspace.id);
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: m.home_open_workspace(),
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          contextMenu = null;
          store.dispatch(openWorkspaceTab(workspace.id));
          void goto(`/workspace/${encodeURIComponent(workspace.id)}`);
        },
      },
      {
        id: 'pin',
        label: pinned ? m.workspace_card_unpin_ariaLabel() : m.workspace_card_pin_ariaLabel(),
        icon: faThumbtack,
        onClick: () => {
          contextMenu = null;
          store.dispatch(togglePinWorkspace(workspace.id));
          if (!pinned) updateView({ expandedGroups: { ...$view$.expandedGroups, pinned: true } });
          void tick().then(() =>
            homeElement
              ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(workspace.id)}"]`)
              ?.closest<HTMLElement>('[role="option"]')
              ?.focus(),
          );
        },
      },
    ];
    if (!selectHidesOwnerWorkspaceActions.select(store.state, workspace.id)) {
      const archived = workspace.status === WorkspaceStatusEnum.Archived;
      items.push(
        { type: 'separator' },
        {
          id: 'archive',
          label: archived
            ? m.ui_workspaceActions_unarchiveSpace_label()
            : m.workspace_card_archive_label(),
          icon: archived ? faBoxOpen : faBoxArchive,
          onClick: () => {
            contextMenu = null;
            store.dispatch(
              archived
                ? requestUnarchiveWorkspace(workspace.id)
                : requestArchiveWorkspace(workspace.id),
            );
          },
        },
        {
          id: 'delete',
          label: m.workspace_card_deleteSpace_label(),
          icon: faTrash,
          destructive: true,
          onClick: () => {
            contextMenu = null;
            store.dispatch(requestDeleteWorkspace(workspace.id));
          },
        },
      );
    }
    return items;
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
  const destination = $derived($panelItem$ === 'chief' ? 'assistant' : 'workspaces');
  const view$ = selectHomeWorkspaceView();
  const workspaceError$ = selectHomeWorkspaceError();
  const repoKey = $derived($view$.repoKey);
  const filter = $derived($view$.filter);
  const tab = $derived($view$.tab);
  let tabDirection = $state(1);
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
  function isActive(workspace: Workspace): boolean {
    return matchesHomeFilter(workspace, 'all');
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
      ] as const satisfies readonly { id: HomeFilter; label: string; icon: unknown }[]
    ).map((item) => ({
      ...item,
      count: dateScopedWorkspaces.filter((workspace) => matchesHomeFilter(workspace, item.id))
        .length,
    })),
  );
  const filteredWorkspaces = $derived(
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
  const selectedWorkspace = $derived(
    filteredWorkspaces.find((workspace) => workspace.id === selectedId),
  );
  const triageOrder = ['needs-you', 'running', 'inactive'] as const;
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
  const listGroups: {
    id: string;
    label: string;
    items: Workspace[];
    expanded: boolean;
    collapsible: boolean;
  }[] = $derived.by(() => {
    if ($view$.groupBy === 'none') return [];
    const groups = ($view$.groupBy === 'repository' ? repositorySections : triageGroups)
      .map((group) => ({
        ...group,
        items: group.items.filter((workspace) => !$pinnedIds$.includes(workspace.id)),
      }))
      .filter((group) => group.items.length);
    if ($view$.groupBy === 'status' && filter !== 'all') return [];
    const items = filteredWorkspaces.filter((workspace) => $pinnedIds$.includes(workspace.id));
    return items.length
      ? [
          {
            id: 'pinned',
            label: m.layout_activeCard_pinned_header(),
            items,
            expanded:
              $view$.expandedGroups.pinned !== false ||
              items.some((workspace) => workspace.id === selectedId),
            collapsible: true,
          },
          ...groups,
        ]
      : groups;
  });
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
  let pendingTabFocus: string | null = null;
  function restoreTabFocus(header: HTMLElement) {
    if (!pendingTabFocus) return;
    const value = pendingTabFocus;
    void tick().then(() => {
      if (!header.isConnected) return;
      header.querySelector<HTMLElement>(`[role="tab"][data-value="${value}"]`)?.focus();
      if (pendingTabFocus === value) pendingTabFocus = null;
    });
  }
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
    () => [listGroups, boardGroups, filteredWorkspaces, $view$.view],
    () => tab,
  );
  function createWorkspace() {
    const repoPath = selectedRepository?.repoPath;
    if (selectedRepository && repoPath) {
      store.dispatch(
        setWorkspaceInitializerLastSelectedRepo({
          path: repoPath,
          type: selectedRepository.isGithub && !repoPath.startsWith('/') ? 'github' : 'local',
          ...(selectedRepository.owner && selectedRepository.name
            ? {
                githubUrl: `https://github.com/${selectedRepository.owner}/${selectedRepository.name}`,
              }
            : {}),
        }),
      );
    }
    store.dispatch(setShowCreateModal(true));
  }
</script>

<svelte:window
  onkeydown={(event) => {
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
  class="home-layout h-full min-h-0 min-w-0 bg-sidebar text-foreground"
  data-home-page
>
  <ResizablePanel
    storageKey="home-repository-sidebar-width"
    side="left"
    minWidth={160}
    maxWidth={360}
    defaultWidth={224}
    className="home-sidebar-resizable h-full"
    handleClassName="home-sidebar-resize-handle"
  >
    <nav
      class="home-sidebar h-full min-h-0 overflow-y-auto px-2 py-3"
      aria-label={m.home_navigation_label()}
    >
      {#if !$collaborator$}
        <Button
          variant="ghost"
          active={destination === 'assistant'}
          aria-current={destination === 'assistant' ? 'page' : undefined}
          class="mb-1 h-9 w-full justify-start px-2 py-2"
          onclick={() => {
            store.dispatch(openPanel('chief'));
          }}
        >
          <span class="flex-1 text-left">{m.home_assistant()}</span>
        </Button>
      {/if}
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
      <Button
        variant="ghost"
        active={repoKey === null && destination === 'workspaces'}
        class="mb-1 h-9 w-full justify-start px-2 py-2"
        onclick={() => chooseRepo(null)}
        ><span class="flex-1 text-left">{m.home_all_repositories()}</span>{@render sidebarCounts(
          workspaces,
          false,
        )}</Button
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
                        class="min-w-0 flex-1 truncate text-left font-medium">{group.label}</span
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
    </nav>
  </ResizablePanel>
  <Screen class="home-surface my-3 mr-3 flex min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
    {#if destination === 'assistant' && !$collaborator$}
      <div class="min-h-0 flex-1 overflow-hidden home-panel bg-background">
        <ChiefCard expanded embedded pageLayout isActive />
      </div>
    {:else}
      {#key tab}
        <Tabs.Root
          value={tab}
          onValueChange={(value) => {
            if (value === 'workspaces' || value === 'prs' || value === 'linear') {
              const order = ['workspaces', 'prs', 'linear'];
              tabDirection = order.indexOf(value) > order.indexOf(tab) ? 1 : -1;
              pendingTabFocus = value;
              updateView({ tab: value });
            }
          }}
          variant="underline"
          class="flex min-h-0 flex-1 flex-col"
        >
          {#snippet children()}
            {#snippet homeHeader()}
              <header
                use:restoreTabFocus
                class="home-header flex shrink-0 flex-wrap items-center gap-x-6 border-b border-border px-5"
              >
                <Tabs.List class="home-tabs shrink-0 gap-5 px-0" aria-label={m.home_views()}>
                  <Tabs.Trigger value="workspaces">{m.home_tab_workspaces()}</Tabs.Trigger>
                  <Tooltip.Provider
                    ><Tooltip.Root
                      ><Tooltip.Trigger
                        >{#snippet child({ props: homeTooltipProps })}<Tabs.Trigger
                            {...homeTooltipProps}
                            value="prs"
                            aria-label={m.home_tab_prs()}
                          >
                            <span class="home-tab-label">{m.home_tab_prs()}</span>
                            <span class="home-tab-logo" aria-hidden="true"
                              ><GitHubIcon size={18} /></span
                            >
                          </Tabs.Trigger>{/snippet}</Tooltip.Trigger
                      ><Tooltip.Content>{m.home_tab_prs()}</Tooltip.Content></Tooltip.Root
                    ></Tooltip.Provider
                  >
                  <Tooltip.Provider
                    ><Tooltip.Root
                      ><Tooltip.Trigger
                        >{#snippet child({ props: homeTooltipProps })}<Tabs.Trigger
                            {...homeTooltipProps}
                            value="linear"
                            aria-label={m.home_tab_linear()}
                          >
                            <span class="home-tab-label">{m.home_tab_linear()}</span>
                            <span class="home-tab-logo" aria-hidden="true"
                              ><LinearIcon size={18} /></span
                            >
                          </Tabs.Trigger>{/snippet}</Tooltip.Trigger
                      ><Tooltip.Content>{m.home_tab_linear()}</Tooltip.Content></Tooltip.Root
                    ></Tooltip.Provider
                  >
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
              {#if tab === 'workspaces'}
                <div
                  in:fly={{ axis: 'x', distance: tabDirection * 12, tier: 'fast' }}
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
                    {:else if filteredWorkspaces.length === 0}
                      <EmptyState class="flex-1" emphasis="prominent">
                        {#snippet title()}<h2>
                            {workspaces.length === 0 ? m.home_empty_title() : m.home_no_matches()}
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
                        groups={boardGroups}
                        showRepository={!selectedRepository}
                        {selectedId}
                        onselect={(id) => updateView({ selectedId: selectedId === id ? null : id })}
                        archived={filter === 'archived'}
                      />
                    {:else}
                      {#snippet workspaceRow({ item }: { item: Workspace })}
                        <ListRow
                          class="home-list-row h-12 items-center border-b border-border px-3 py-1"
                          data-home-workspace={item.id}
                          oncontextmenu={(event) => showWorkspaceMenu(event, item)}
                        >
                          {#snippet leading()}
                            {#if !selectedRepository && item.repositoryOwner}
                              <Tooltip.Provider
                                ><Tooltip.Root
                                  ><Tooltip.Trigger
                                    >{#snippet child({ props: homeTooltipProps })}<span
                                        {...homeTooltipProps}
                                      >
                                        <GitHubAvatar
                                          identity={item.repositoryOwner ?? ''}
                                          size={20}
                                          class="shrink-0 rounded-sm"
                                        />
                                      </span>{/snippet}</Tooltip.Trigger
                                  ><Tooltip.Content
                                    >{[item.repositoryOwner, item.repositoryName]
                                      .filter(Boolean)
                                      .join('/')}</Tooltip.Content
                                  ></Tooltip.Root
                                ></Tooltip.Provider
                              >
                            {:else if !selectedRepository && (item.repositoryPath || item.repositoryName)}
                              <Tooltip.Provider
                                ><Tooltip.Root
                                  ><Tooltip.Trigger
                                    >{#snippet child({ props: homeTooltipProps })}<span
                                        {...homeTooltipProps}
                                        class="flex size-5 items-center justify-center text-muted-foreground"
                                        ><Fa icon={faFolder} /></span
                                      >{/snippet}</Tooltip.Trigger
                                  ><Tooltip.Content
                                    >{item.repositoryName || item.repositoryPath}</Tooltip.Content
                                  ></Tooltip.Root
                                ></Tooltip.Provider
                              >
                            {/if}
                          {/snippet}
                          {#snippet title()}
                            <span class="home-row-line">
                              <Tooltip.Provider
                                ><Tooltip.Root
                                  ><Tooltip.Trigger
                                    >{#snippet child({ props: homeTooltipProps })}<span
                                        {...homeTooltipProps}
                                        class="home-row-title truncate font-medium"
                                        >{item.title}</span
                                      >{/snippet}</Tooltip.Trigger
                                  ><Tooltip.Content>{item.title}</Tooltip.Content></Tooltip.Root
                                ></Tooltip.Provider
                              >
                              <span class="home-row-description flex min-w-0 items-center gap-2">
                                <HomeWorkspacePullBadge workspace={item} />
                                {#if item.pullRequests && item.pullRequests.length > 1}
                                  <span
                                    class="shrink-0 rounded-full border border-border px-2 py-0.5 type-caption tabular-nums"
                                    >+{formatInteger(item.pullRequests.length - 1)}</span
                                  >
                                {/if}
                                <Tooltip.Provider
                                  ><Tooltip.Root
                                    ><Tooltip.Trigger
                                      >{#snippet child({ props: homeTooltipProps })}<span
                                          {...homeTooltipProps}
                                          class="home-workspace-summary min-w-0 truncate type-caption"
                                          >{item.statusMessage || ''}</span
                                        >{/snippet}</Tooltip.Trigger
                                    ><Tooltip.Content>{item.statusMessage || ''}</Tooltip.Content
                                    ></Tooltip.Root
                                  ></Tooltip.Provider
                                >
                              </span>
                            </span>
                          {/snippet}
                          {#snippet trailing()}<span
                              class="workspace-row-meta flex items-center gap-2 text-muted-foreground"
                            >
                              {#if $pinnedIds$.includes(item.id)}<Tooltip.Provider
                                  ><Tooltip.Root
                                    ><Tooltip.Trigger
                                      >{#snippet child({ props: homeTooltipProps })}<span
                                          {...homeTooltipProps}
                                          aria-label={m.layout_activeCard_pinned_header()}
                                          ><Fa icon={faThumbtack} /></span
                                        >{/snippet}</Tooltip.Trigger
                                    ><Tooltip.Content
                                      >{m.layout_activeCard_pinned_header()}</Tooltip.Content
                                    ></Tooltip.Root
                                  ></Tooltip.Provider
                                >{/if}
                              <HomeWorkspaceStatus workspace={item} />
                              <span
                                class="inline-flex w-6 shrink-0 justify-end whitespace-nowrap type-caption tabular-nums"
                                data-home-row-time
                              >
                                <HomeActivityTime workspace={item} />
                              </span>
                              <SidebarOverflowMenu
                                items={workspaceMenu(item)}
                                ariaLabel={m.workspace_sidebarHeader_actions_ariaLabel()}
                              />
                            </span>{/snippet}
                        </ListRow>
                      {/snippet}
                      {#snippet workspaceList(items: Workspace[], label: string, scroll: boolean)}
                        <ListView
                          onkeydown={(event) => {
                            const option =
                              event.target instanceof HTMLElement
                                ? event.target.closest<HTMLElement>('[role="option"]')
                                : null;
                            const id =
                              option?.querySelector<HTMLElement>('[data-home-workspace]')?.dataset
                                .homeWorkspace;
                            const workspace = items.find((item) => item.id === id);
                            if (workspace) {
                              showWorkspaceMenu(event, workspace);
                              if (
                                contextMenu &&
                                option &&
                                (event.key === 'ContextMenu' ||
                                  (event.shiftKey && event.key === 'F10'))
                              ) {
                                const bounds = option.getBoundingClientRect();
                                contextMenu = {
                                  ...contextMenu,
                                  x: bounds.left,
                                  y: bounds.bottom,
                                  returnFocus: option,
                                };
                              }
                            }
                          }}
                          {items}
                          rowHeight={48}
                          virtualize={scroll ? 'auto' : false}
                          getKey={(workspace) => workspace.id}
                          getText={(workspace) => workspace.title}
                          selectable="single"
                          selectedKeys={selectedWorkspace ? [selectedWorkspace.id] : []}
                          onSelectedKeysChange={(keys) =>
                            updateView({ selectedId: keys[0] ? String(keys[0]) : null })}
                          ariaLabel={label}
                          class={scroll
                            ? 'min-h-0 flex-1 overflow-y-auto px-5 pb-4'
                            : 'overflow-visible'}
                          row={workspaceRow}
                        />
                      {/snippet}
                      {#if listGroups.length > 0}
                        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                          <SectionedList
                            sections={listGroups}
                            getKey={(group) => group.id}
                            inset={false}
                          >
                            {#snippet header(group)}
                              <h3
                                class="home-group-header flex min-h-8 items-center gap-2 px-2"
                                data-home-group={group.id}
                              >
                                <Button
                                  variant="plain"
                                  size="sm"
                                  class="w-full justify-start px-2"
                                  aria-expanded={group.expanded}
                                  aria-label={group.label}
                                  onclick={() =>
                                    setGroupExpanded(group.id, !group.expanded, group.items)}
                                >
                                  <span class="flex-1 text-left font-medium text-foreground"
                                    >{group.label}</span
                                  >
                                  {#snippet trailingIcon()}<Fa
                                      icon={group.expanded ? faChevronDown : faChevronRight}
                                    />{/snippet}
                                </Button>
                              </h3>
                            {/snippet}
                            {#snippet children(group)}
                              {#if group.expanded}
                                {@render workspaceList(group.items, group.label, false)}
                              {/if}
                            {/snippet}
                          </SectionedList>
                        </div>
                      {:else}
                        {@render workspaceList(filteredWorkspaces, m.home_tab_workspaces(), true)}
                      {/if}
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
              >{#if tab === 'prs'}<div
                  class="h-full min-h-0"
                  in:fly={{ axis: 'x', distance: tabDirection * 12, tier: 'fast' }}
                >
                  <HomeIntegrations
                    header={homeHeader}
                    kind="prs"
                    organization={selectedOrg?.owner}
                    preview={integrationPreview?.prs}
                    {repositories}
                    workspaceId={integrationWorkspaceId}
                  />
                </div>{/if}</Tabs.Content
            >
            <Tabs.Content value="linear" class="mt-0 min-h-0 flex-1 overflow-hidden"
              >{#if tab === 'linear'}<div
                  class="h-full min-h-0"
                  in:fly={{ axis: 'x', distance: tabDirection * 12, tier: 'fast' }}
                >
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
      {/key}
    {/if}
  </Screen>
</div>

<style>
  .home-layout {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    container: home-layout / inline-size;
  }
  .home-tab-logo {
    display: none;
  }
  @container home-panel (max-width: 700px) {
    .home-tab-label {
      display: none;
    }
    .home-tab-logo {
      display: flex;
    }
  }
  .home-sidebar {
    font-weight: 500;
  }
  .home-sidebar :global([data-slot='button']) {
    border-radius: 0.75rem;
    font-weight: 500;
  }
  .home-sidebar p,
  .home-header :global([role='tab']) {
    font-weight: 500;
  }
  .home-sidebar :global([data-state='active'] > [data-slot='button-surface']) {
    background: hsl(var(--card));
    box-shadow: none;
  }
  .workspace-content {
    display: flex;
  }
  .workspace-list {
    flex: 1;
  }
  @container (max-width: 1000px) {
    .home-header {
      column-gap: 1rem;
    }
    .workspace-content.has-selection .workspace-list {
      display: none;
    }
  }
  @media (max-width: 700px) {
    .home-sidebar {
      padding-inline: 0.25rem;
    }
  }
  @media (max-width: 480px) {
    .home-layout {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .home-layout :global(.home-sidebar-resizable) {
      width: 100% !important;
      max-width: 100% !important;
      height: auto;
    }
    .home-layout :global(.home-sidebar-resize-handle) {
      display: none;
    }
    .home-sidebar {
      max-height: 10rem;
      flex: none;
    }
    .home-layout :global(.home-surface) {
      margin-left: 0.75rem;
      flex: 1;
      min-height: 24rem;
    }
  }
</style>
