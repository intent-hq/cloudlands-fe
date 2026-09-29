<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Tabs from '$lib/components/ui/tabs';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { Screen, EmptyState, LoadingState, ErrorState } from '$lib/components/patterns/screen';
  import ChiefCard from '$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    resolveWorkspaceStatusState,
    getWorkspaceStatusPresentation,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
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
  import { WorkspaceStatusEnum } from '$shared/types';
  import {
    compareWorkspaceActivityDisplayTimeDesc,
    getWorkspaceActivityDisplayTime,
  } from '$shared/utils/workspace-activity-time';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import Fa from 'svelte-fa';
  import {
    faLayerGroup,
    faFolder,
    faWandMagicSparkles,
    faList,
    faTableColumns,
    faCircleExclamation,
    faPlay,
    faEnvelope,
    faBoxArchive,
    faPlus,
  } from '@fortawesome/free-solid-svg-icons';
  import {
    matchesHomeFilter,
    needsAttention,
    type HomeFilter,
    type HomeRepository,
  } from './home-model';
  import HomeWorkspaceDetail from './HomeWorkspaceDetail.svelte';
  import HomeRepositoryMetadata from './HomeRepositoryMetadata.svelte';
  import HomeWorkspaceBoard from './HomeWorkspaceBoard.svelte';
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
    }).sort((a, b) => a.label.localeCompare(b.label)),
  );
  const selectedRepository = $derived(repositoryGroups.find((repo) => repo.key === repoKey));
  const scopedWorkspaces = $derived(selectedRepository?.workspaces ?? workspaces);
  const repositories: HomeRepository[] = $derived(
    (selectedRepository ? [selectedRepository] : repositoryGroups).map((repo) => ({
      key: repo.key,
      name: repo.name ?? repo.label,
      owner: repo.owner,
      path: repo.repoPath,
    })),
  );
  const filters = $derived([
    { id: 'all' as const, label: m.home_filter_all(), icon: faLayerGroup },
    { id: 'attention' as const, label: m.home_filter_attention(), icon: faCircleExclamation },
    { id: 'running' as const, label: m.home_filter_running(), icon: faPlay },
    { id: 'unread' as const, label: m.home_filter_unread(), icon: faEnvelope },
    { id: 'archived' as const, label: m.home_filter_archived(), icon: faBoxArchive },
  ]);
  const filteredWorkspaces = $derived(
    scopedWorkspaces
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
          Number(needsAttention(b)) - Number(needsAttention(a)) ||
          compareWorkspaceActivityDisplayTimeDesc(a, b),
      ),
  );
  const selectedWorkspace = $derived(
    filteredWorkspaces.find((workspace) => workspace.id === selectedId),
  );
  const heading = $derived(
    selectedRepository?.label ??
      (tab === 'workspaces' ? m.home_filter_all() : m.home_all_repositories()),
  );
  const integrationWorkspaceId = $derived($collaborator$ ? scopedWorkspaces[0]?.id : undefined);

  let homeElement = $state<HTMLDivElement | null>(null);
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
    updateView({ repoKey: key, selectedId: null });
  }
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

<div
  bind:this={homeElement}
  class="home-layout h-full min-h-0 min-w-0 text-foreground"
  data-home-page
>
  <nav
    class="home-sidebar min-h-0 overflow-y-auto px-3 py-4"
    aria-label={m.home_navigation_label()}
  >
    {#if !$collaborator$}
      <Button
        variant="ghost"
        active={destination === 'assistant'}
        aria-current={destination === 'assistant' ? 'page' : undefined}
        class="mb-4 w-full justify-start"
        onclick={() => {
          store.dispatch(openPanel('chief'));
        }}
      >
        {#snippet leadingIcon()}<Fa icon={faWandMagicSparkles} />{/snippet}<span
          class="flex-1 text-left">{m.home_assistant()}</span
        >
      </Button>
    {/if}
    <div class="space-y-1">
      {#each filters as item (item.id)}
        <Button
          variant="ghost"
          active={destination === 'workspaces' && filter === item.id && tab === 'workspaces'}
          class="w-full justify-start"
          onclick={() => chooseFilter(item.id)}
          aria-current={destination === 'workspaces' && filter === item.id && tab === 'workspaces'
            ? 'page'
            : undefined}
        >
          {#snippet leadingIcon()}<Fa icon={item.icon} />{/snippet}
          <span class="flex min-w-0 flex-1 items-center justify-between gap-2"
            ><span class="truncate">{item.label}</span><span
              class="text-muted-foreground tabular-nums"
              >{formatInteger(
                scopedWorkspaces.filter((workspace) => matchesHomeFilter(workspace, item.id))
                  .length,
              )}</span
            ></span
          >
        </Button>
      {/each}
    </div>
    <div class="mb-2 mt-7 px-2 type-caption text-muted-foreground">{m.home_repositories()}</div>
    <Button
      variant="ghost"
      active={repoKey === null && destination === 'workspaces'}
      class="mb-1 w-full justify-start"
      onclick={() => chooseRepo(null)}
      ><span class="flex-1 text-left">{m.home_all_repositories()}</span></Button
    >
    {#each repositoryGroups as repo (repo.key)}
      <Button
        variant="ghost"
        active={repoKey === repo.key && destination === 'workspaces'}
        class="w-full justify-start"
        title={repo.label}
        onclick={() => chooseRepo(repo.key)}
      >
        {#snippet leadingIcon()}<Fa icon={faFolder} />{/snippet}
        <span class="flex-1 truncate text-left">{repo.label}</span>
      </Button>
    {/each}
    {#if repositoryGroups.length === 0 && $hasLoaded$}<p
        class="px-2 py-3 type-caption text-muted-foreground"
      >
        {m.home_no_repositories()}
      </p>{/if}
  </nav>
  <Screen
    class="home-surface my-3 mr-3 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background"
  >
    {#if destination === 'assistant' && !$collaborator$}
      <header class="border-b border-border px-6 py-5">
        <h1 class="text-xl font-medium tracking-tight">{m.home_assistant()}</h1>
      </header>
      <div class="min-h-0 flex-1 overflow-hidden"><ChiefCard expanded embedded isActive /></div>
    {:else}
      <header class="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-5">
        <div class="min-w-0">
          <h1
            class="break-words text-lg font-medium tracking-tight"
            title={selectedRepository?.repoPath}
          >
            {heading}
          </h1>
          {#if selectedRepository}<HomeRepositoryMetadata
              workspaces={scopedWorkspaces}
              repository={selectedRepository}
            />{/if}
        </div>
        {#if !$collaborator$}<Button variant="primary" size="sm" onclick={createWorkspace}
            >{#snippet leadingIcon()}<Fa icon={faPlus} />{/snippet}{m.home_new_workspace()}</Button
          >{/if}
      </header>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          if (value === 'workspaces' || value === 'prs' || value === 'linear')
            updateView({ tab: value });
        }}
        variant="subtle"
        class="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List class="shrink-0 px-5" aria-label={m.home_views()}>
          <Tabs.Trigger value="workspaces">{m.home_tab_workspaces()}</Tabs.Trigger>
          <Tabs.Trigger value="prs">{m.home_tab_prs()}</Tabs.Trigger>
          <Tabs.Trigger value="linear">{m.home_tab_linear()}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="workspaces" class="min-h-0 flex-1 overflow-hidden">
          <div class="workspace-content h-full min-h-0" class:has-selection={!!selectedWorkspace}>
            <section
              class="workspace-list flex min-h-0 min-w-0 flex-col"
              aria-label={m.home_tab_workspaces()}
            >
              <div class="flex items-center gap-2 border-b border-border px-5 py-3">
                <Input
                  value={query}
                  oninput={(event) => updateView({ query: event.currentTarget.value })}
                  type="search"
                  placeholder={m.home_search_workspaces()}
                  aria-label={m.home_search_workspaces()}
                  class="min-w-0 flex-1 max-w-sm"
                />
                <div
                  class="ml-auto flex shrink-0 gap-1"
                  role="group"
                  aria-label={m.home_workspace_view()}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    active={$view$.view === 'list'}
                    aria-pressed={$view$.view === 'list'}
                    aria-label={m.home_list_view()}
                    tooltip={m.home_list_view()}
                    onclick={() => updateView({ view: 'list' })}><Fa icon={faList} /></Button
                  >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    active={$view$.view === 'board'}
                    aria-pressed={$view$.view === 'board'}
                    aria-label={m.home_board_view()}
                    tooltip={m.home_board_view()}
                    onclick={() => updateView({ view: 'board' })}
                    ><Fa icon={faTableColumns} /></Button
                  >
                </div>
              </div>
              {#if $workspaceError$}<ErrorState
                  retryLabel={m.home_retry()}
                  onRetry={() => store.dispatch(loadWorkspacesRequested())}
                  >{#snippet message()}{$workspaceError$}{/snippet}</ErrorState
                >
              {:else if !$hasLoaded$}<LoadingState
                  recipe="list"
                  label={m.home_integrations_loading()}
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
                          updateView({ query: '', filter: 'all', repoKey: null });
                        }}>{m.home_clear_filters()}</Button
                      >{/if}
                  {/snippet}
                </EmptyState>
              {:else if $view$.view === 'board'}
                <HomeWorkspaceBoard
                  workspaces={filteredWorkspaces}
                  {selectedId}
                  onselect={(id) => updateView({ selectedId: id })}
                  archived={filter === 'archived'}
                />
              {:else}
                <ListView
                  items={filteredWorkspaces}
                  rowHeight={64}
                  getKey={(workspace) => workspace.id}
                  getText={(workspace) => workspace.title}
                  selectable="single"
                  selectedKeys={selectedWorkspace ? [selectedWorkspace.id] : []}
                  onSelectedKeysChange={(keys) => {
                    updateView({ selectedId: keys[0] ? String(keys[0]) : null });
                  }}
                  onActivate={(workspace) => {
                    updateView({ selectedId: workspace.id });
                  }}
                  ariaLabel={m.home_tab_workspaces()}
                  class="min-h-0 flex-1 overflow-y-auto px-2 py-2"
                >
                  {#snippet row({ item })}
                    <ListRow class="h-16 py-3" data-home-workspace={item.id}>
                      {#snippet leading()}<WorkspaceStatusIcon
                          status={resolveWorkspaceStatusState(item)}
                        />{/snippet}
                      {#snippet title()}<span title={item.title} class="font-medium"
                          >{item.title}</span
                        ><span class="ml-2 type-caption font-normal text-muted-foreground"
                          >{needsAttention(item)
                            ? m.home_filter_attention()
                            : getWorkspaceStatusPresentation(resolveWorkspaceStatusState(item))
                                .label}</span
                        >{/snippet}
                      {#snippet description()}<p
                          class="truncate"
                          title={item.statusMessage || item.branch}
                        >
                          {item.statusMessage || item.branch || item.repositoryName}
                        </p>
                      {/snippet}
                      {#snippet trailing()}<span
                          class="workspace-row-meta flex items-center gap-4 text-muted-foreground"
                        >
                          {#if !selectedRepository}<span
                              class="workspace-row-repo max-w-32 truncate"
                              title={[item.repositoryOwner, item.repositoryName, item.branch]
                                .filter(Boolean)
                                .join(' / ')}>{item.repositoryName}</span
                            >{/if}
                          {#if item.pullRequests?.length}<span class="workspace-row-repo"
                              >#{item.pullRequests[0].number}</span
                            >{/if}
                          <RelativeTime
                            date={getWorkspaceActivityDisplayTime(item)}
                            compact
                          /></span
                        >{/snippet}
                    </ListRow>
                  {/snippet}
                </ListView>
              {/if}
            </section>
            {#if selectedWorkspace}
              <aside class="workspace-detail min-h-0 min-w-0 border-l border-border">
                {#key selectedWorkspace.id}<HomeWorkspaceDetail
                    workspace={selectedWorkspace}
                    onclose={closePreview}
                    {preview}
                  />{/key}
              </aside>
            {/if}
          </div>
        </Tabs.Content>
        <Tabs.Content value="prs" class="min-h-0 flex-1 overflow-hidden"
          >{#if tab === 'prs'}<HomeIntegrations
              kind="prs"
              preview={integrationPreview?.prs}
              {repositories}
              workspaceId={integrationWorkspaceId}
            />{/if}</Tabs.Content
        >
        <Tabs.Content value="linear" class="min-h-0 flex-1 overflow-hidden"
          >{#if tab === 'linear'}<HomeIntegrations
              kind="linear"
              preview={integrationPreview?.linear}
              {repositories}
              workspaceId={integrationWorkspaceId}
            />{/if}</Tabs.Content
        >
      </Tabs.Root>
    {/if}
  </Screen>
</div>

<style>
  .home-layout {
    display: grid;
    grid-template-columns: 13rem minmax(0, 1fr);
    container-type: inline-size;
  }
  .workspace-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .workspace-content.has-selection {
    grid-template-columns: minmax(15rem, 1fr) minmax(20rem, 1fr);
  }
  @container (max-width: 1000px) {
    .workspace-row-repo {
      display: none;
    }
    .workspace-content.has-selection {
      grid-template-columns: minmax(0, 1fr);
    }
    .workspace-content.has-selection .workspace-list {
      display: none;
    }
    .workspace-detail {
      border-left: 0;
    }
  }
  @media (max-width: 700px) {
    .home-layout {
      grid-template-columns: 10rem minmax(0, 1fr);
    }
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
