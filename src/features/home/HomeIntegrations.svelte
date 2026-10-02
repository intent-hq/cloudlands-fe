<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { selectHomeWorkspaceView } from './home-workspaces-selectors';
  import { updateHomeWorkspaceView } from './home-workspaces-slice';
  import { normalizeHomeConfiguration } from './home-workspaces-persistence';
  import { groupHomeReviewComments } from './home-review-threads';
  import HomePullComment from './HomePullComment.svelte';
  import './home.css';
  import HomeFilterSelect from './HomeFilterSelect.svelte';
  import HomeLoading from './HomeLoading.svelte';
  import HomePullState from './HomePullState.svelte';
  import HomePullSummary from './HomePullSummary.svelte';
  import HomePullCode from './HomePullCode.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import HomePreviewPane from './HomePreviewPane.svelte';
  import HomeWorkspaceDetail from './HomeWorkspaceDetail.svelte';
  import { onDestroy, untrack, tick, type Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { handleLink } from '$features/navigation/link-handler';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { Button } from '$lib/components/ui/button';
  import HomeSearch from './HomeSearch.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import Fa from 'svelte-fa';
  import {
    faArrowRotateRight,
    faXmark,
    faArrowUpRightFromSquare,
    faCodePullRequest,
    faCodeBranch,
    faBook,
    faLayerGroup,
  } from '@fortawesome/free-solid-svg-icons';
  import { ListView, ListRow } from '$lib/components/patterns/collection';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { describeHomeIntegrationScope } from './home-integrations-model';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectIsCollaboratorOnlyClient,
    selectWorkspaceItems,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectHomeIntegrations,
    selectHomeIntegrationWorkspace,
    selectHomeLinkedPullUrls,
    selectHomeLinkedWorkspaces,
  } from './home-integrations-selectors';
  import {
    mountHomeIntegrations,
    unmountHomeIntegrations,
    searchHomeIntegrations,
    refreshHomeIntegrations,
    loadMoreHomeIntegrations,
    selectHomeIntegration,
    loadHomeReviewComments,
    loadHomePullFiles,
    loadHomePullReviewData,
    loadHomePullChecks,
    startHomeIntegrationWorkspace,
  } from './home-integrations-slice';
  import type {
    HomeIntegrationKind,
    IntegrationRepository,
    HomeIntegrationsState,
  } from './home-integrations-types';

  let {
    kind,
    repositories,
    organization,
    workspaceId,
    preview,
    header,
  }: {
    kind: HomeIntegrationKind;
    repositories: IntegrationRepository[];
    organization?: string;
    workspaceId?: string;
    preview?: HomeIntegrationsState;
    header?: Snippet;
  } = $props();
  const collaborator$ = selectIsCollaboratorOnlyClient();
  const workspaces$ = selectWorkspaceItems();
  let workspacePreviewId = $state<string | null>(null);
  const workspacePreview = $derived(
    $workspaces$.find((workspace) => workspace.id === workspacePreviewId),
  );
  const home$ = selectHomeWorkspaceView();
  let mountedSettingsScope: string | undefined;
  let root: HTMLDivElement;
  let returnFocusIndex = 0;
  const live$ = selectHomeIntegrations();
  const workspace$ = selectHomeIntegrationWorkspace();
  const linkedWorkspaces$ = selectHomeLinkedWorkspaces();
  const linkedUrls$ = selectHomeLinkedPullUrls();
  let linkedOnly = $state(false);
  const linkedUrls = $derived(new Set($linkedUrls$));
  let previewSelection = $state<string | null | undefined>(undefined);
  let previewQuery = $state('');
  let pullTab = $state<'summary' | 'code'>('summary');
  const view = $derived(preview ?? $live$);
  const selectedId = $derived(
    preview && previewSelection !== undefined ? previewSelection : view.selectedId,
  );
  const detail = $derived(
    preview && previewSelection !== undefined
      ? (view.items.find((item) => item.id === previewSelection) ?? null)
      : view.detail,
  );
  const comments = $derived(preview && detail?.id !== view.detail?.id ? [] : view.comments);
  const reviewActivity = $derived(
    [
      ...groupHomeReviewComments(comments).map((thread) => ({
        kind: 'thread' as const,
        id: 'thread-' + thread.id,
        date: thread.comments[0].createdAt ?? '',
        thread,
      })),
      ...(view.reviewData?.reviews ?? []).map((review) => ({
        kind: 'review' as const,
        id: 'review-' + review.id,
        date: review.submittedAt ?? '',
        review,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
  );
  const searchedItems = $derived(
    preview || view.status === 'loading'
      ? view.items.filter((item) =>
          `${item.title} ${item.identifier}`
            .toLowerCase()
            .includes((preview ? previewQuery : view.query).toLowerCase()),
        )
      : view.items,
  );
  const items = $derived(
    kind === 'prs' && linkedOnly
      ? searchedItems.filter((item) => linkedUrls.has(item.url.replace(/\/$/, '').toLowerCase()))
      : searchedItems,
  );
  const query = $derived(preview ? previewQuery : view.query);
  const linkedWorkspace = $derived(preview ? null : $workspace$);
  const isPr = $derived(kind === 'prs');
  const filters = $derived(
    isPr
      ? [
          { value: 'all', label: m.home_integrations_all() },
          { value: 'created', label: m.home_integrations_created() },
          { value: 'review-requested', label: m.home_integrations_review_requested() },
          { value: 'assigned', label: m.home_integrations_assigned() },
        ]
      : [
          { value: 'all', label: m.home_integrations_all() },
          { value: 'assigned', label: m.home_integrations_assigned() },
          { value: 'created', label: m.home_integrations_created() },
        ],
  );
  const priorities = $derived([
    m.home_integrations_priority_none(),
    m.home_integrations_priority_urgent(),
    m.home_integrations_priority_high(),
    m.home_integrations_priority_normal(),
    m.home_integrations_priority_low(),
  ]);
  const scopeMetadata = $derived(
    describeHomeIntegrationScope({ kind, repositories, organization, workspaceId }),
  );
  $effect(() => {
    const key = JSON.stringify([scopeMetadata.key, $home$.persistenceScope]);
    const settings = $home$.integrationViews[kind];
    if (preview) return;
    untrack(() => {
      // User search already updates the live slice synchronously. Remount only
      // when restoring saved settings or moving to a new repository/account.
      if (
        mountedSettingsScope === key &&
        view.query === settings.query &&
        view.filter === settings.filter &&
        view.closed === settings.closed
      )
        return;
      mountedSettingsScope = key;
      appStore.dispatch(
        mountHomeIntegrations({ kind, repositories, organization, workspaceId }, settings),
      );
    });
  });
  onDestroy(() => {
    if (!preview) appStore.dispatch(unmountHomeIntegrations());
  });
  function search(value: string, filter = view.filter, closed = view.closed) {
    if (preview) {
      previewQuery = value;
      return;
    }
    const settings = normalizeHomeConfiguration({
      integrationViews: { [kind]: { query: value, filter, closed } },
    }).integrationViews[kind];
    appStore.dispatch(
      updateHomeWorkspaceView({
        integrationViews: { ...$home$.integrationViews, [kind]: settings },
      }),
    );
    appStore.dispatch(searchHomeIntegrations(settings.query, settings.filter, settings.closed));
  }
  async function selectItem(id: string | null) {
    workspacePreviewId = null;
    pullTab = 'summary';
    if (id)
      returnFocusIndex = Math.max(
        0,
        items.findIndex((item) => item.id === id),
      );
    if (preview) previewSelection = id;
    else appStore.dispatch(selectHomeIntegration(id));
    await tick();
    root
      ?.querySelector<HTMLElement>(
        id ? '[data-integration-close]' : `[data-list-index="${returnFocusIndex}"]`,
      )
      ?.focus();
  }
  function changePullTab(value: string) {
    pullTab = value === 'code' ? 'code' : 'summary';
    if (
      pullTab === 'code' &&
      !preview &&
      !view.filesHeadSha &&
      !view.filesLoading &&
      !view.filesError
    )
      appStore.dispatch(loadHomePullFiles());
  }
  function handleEscape(event: KeyboardEvent) {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      (selectedId || workspacePreview) &&
      root?.contains(document.activeElement)
    ) {
      event.preventDefault();
      if (workspacePreview) workspacePreviewId = null;
      else void selectItem(null);
    }
  }
  function openLink(url: string, event?: MouseEvent) {
    void handleLink(url, {
      event,
      workspaceId: linkedWorkspace ? WorkspaceId(linkedWorkspace.workspaceId) : undefined,
    });
  }
  function openWorkspace() {
    if (!linkedWorkspace) return;
    workspacePreviewId = linkedWorkspace.workspaceId;
  }
</script>

<svelte:window onkeydown={handleEscape} />

<div
  bind:this={root}
  class="home-integrations flex h-full min-h-0 flex-1 overflow-hidden"
  data-home-integrations={kind}
>
  <div
    class="integration-list flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden home-panel bg-background"
    data-has-detail={!!selectedId || !!workspacePreview}
  >
    {@render header?.()}
    <div class="home-integration-toolbar flex min-w-0 items-center gap-3 px-6 py-4">
      <div class="min-w-24 max-w-60 flex-1">
        <HomeSearch
          inputClass="home-control-fill rounded-xl border-transparent"
          value={query}
          label={m.home_integrations_search()}
          placeholder={isPr
            ? m.home_integrations_search_prs()
            : m.home_integrations_search_issues()}
          onchange={search}
        />
      </div>
      <div class="ml-auto flex min-w-0 items-center justify-end gap-2">
        <div class="home-choice-group home-integration-filters-wide">
          {#each filters as filter (filter.value)}
            <Button
              variant="ghost"
              size="sm"
              active={view.filter === filter.value && !(kind === 'linear' && query.trim())}
              aria-pressed={view.filter === filter.value && !(kind === 'linear' && query.trim())}
              disabled={!!preview || (kind === 'linear' && !!query.trim())}
              onclick={() => search(query, filter.value)}>{filter.label}</Button
            >
          {/each}
          {#if isPr}
            <Button
              variant="ghost"
              size="sm"
              active={linkedOnly}
              aria-pressed={linkedOnly}
              onclick={() => {
                linkedOnly = !linkedOnly;
                selectItem(null);
              }}>{m.home_integrations_linked_workspace()}</Button
            >
          {/if}
        </div>
        <div class="home-integration-filters-compact min-w-0">
          <HomeFilterSelect
            value={linkedOnly ? 'linked' : view.filter}
            label={m.home_views()}
            options={[
              ...filters,
              ...(isPr ? [{ value: 'linked', label: m.home_integrations_linked_workspace() }] : []),
            ]}
            disabled={!!preview || (kind === 'linear' && !!query.trim())}
            onchange={(value) => {
              linkedOnly = value === 'linked';
              selectItem(null);
              if (value !== 'linked') search(query, value as typeof view.filter);
            }}
          />
        </div>
        {#if isPr}
          <div class="home-choice-group home-integration-filters-wide">
            <Button
              variant="ghost"
              size="sm"
              active={!view.closed}
              aria-pressed={!view.closed}
              disabled={!!preview}
              onclick={() => search(query, view.filter, false)}>{m.home_integrations_open()}</Button
            >
            <Button
              variant="ghost"
              size="sm"
              active={view.closed}
              aria-pressed={view.closed}
              disabled={!!preview}
              onclick={() => search(query, view.filter, true)}
              >{m.home_integrations_closed()}</Button
            >
          </div>
        {/if}
        {#if isPr}<div class="home-integration-filters-compact min-w-0">
            <HomeFilterSelect
              value={view.closed ? 'closed' : 'open'}
              label={m.layout_allCard_status_label()}
              options={[
                { value: 'open', label: m.home_integrations_open() },
                { value: 'closed', label: m.home_integrations_closed() },
              ]}
              disabled={!!preview}
              onchange={(value) => search(query, view.filter, value === 'closed')}
            />
          </div>{/if}
        <div class="shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.home_integrations_refresh()}
            tooltip={m.home_integrations_refresh()}
            loading={view.status === 'loading'}
            disabled={!!preview || view.status === 'loading' || view.loadingMore}
            onclick={() => appStore.dispatch(refreshHomeIntegrations())}
            ><Fa icon={faArrowRotateRight} /></Button
          >
        </div>
      </div>
    </div>
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {#if (view.status === 'loading' && !view.items.length) || view.status === 'idle'}
        <HomeLoading />
      {:else if view.status === 'disconnected'}
        <div class="space-y-3 p-8 text-center">
          {#if isPr}
            <h2 class="text-base font-medium">{m.home_integrations_connect_github()}</h2>
          {/if}
          <p class="text-sm text-muted-foreground">{m.home_integrations_connect_description()}</p>
          <Button
            variant="primary"
            disabled={!!preview}
            onclick={() => goto('/settings?tab=connections')}
            >{m.home_integrations_settings()}</Button
          >
          <Button
            variant="ghost"
            disabled={!!preview}
            onclick={() => appStore.dispatch(refreshHomeIntegrations())}
            >{m.home_integrations_retry()}</Button
          >
        </div>
      {:else if view.status === 'error'}
        <div class="space-y-3 p-8 text-center" role="alert">
          <p class="text-sm">{m.home_integrations_load_error()}</p>
          <p class="break-words text-sm text-muted-foreground">{view.error}</p>
          <Button disabled={!!preview} onclick={() => appStore.dispatch(refreshHomeIntegrations())}
            >{m.home_integrations_retry()}</Button
          >
        </div>
      {:else}
        <div class="sr-only" aria-live="polite">
          {m.home_integrations_loaded({ count: formatInteger(items.length) })}
        </div>
        <ListView
          rowHeight={48}
          virtualize={false}
          {items}
          getKey={(item) => item.id}
          getText={(item) => item.title}
          selectable="single"
          selectedKeys={selectedId ? [selectedId] : []}
          onSelectedKeysChange={(keys) =>
            selectItem(keys[0] === undefined ? null : String(keys[0]))}
          ariaLabel={isPr ? m.home_integrations_prs() : m.home_integrations_issues()}
          class="px-5"
        >
          {#snippet empty()}<p class="p-8 text-center text-sm text-muted-foreground">
              {isPr && !scopeMetadata.hasGitHubRepositories
                ? m.home_integrations_no_repositories()
                : m.home_integrations_empty()}
            </p>{/snippet}
          {#snippet row({ item })}
            <ListRow
              class="home-list-row home-integration-row min-h-12 items-start border-b border-border/50 px-2 py-3"
            >
              {#snippet leading()}{#if isPr}<HomePullState
                    state={item.state}
                    compact
                  />{/if}{/snippet}
              {#snippet title()}
                <div class="flex min-w-0 items-center gap-3">
                  <Tooltip.Provider
                    ><Tooltip.Root
                      ><Tooltip.Trigger
                        >{#snippet child({ props: homeTooltipProps })}<span
                            {...homeTooltipProps}
                            class="min-w-0 flex-1 truncate font-medium">{item.title}</span
                          >{/snippet}</Tooltip.Trigger
                      ><Tooltip.Content>{item.title}</Tooltip.Content></Tooltip.Root
                    ></Tooltip.Provider
                  >
                  <span
                    class="type-caption flex min-w-0 max-w-[45%] items-center gap-2 text-muted-foreground"
                  >
                    <span class="shrink-0">{item.identifier}</span>
                    {#if isPr && repositories.length !== 1}<Tooltip.Provider
                        ><Tooltip.Root
                          ><Tooltip.Trigger
                            >{#snippet child({ props: homeTooltipProps })}<span
                                {...homeTooltipProps}
                                class="truncate">{item.repo}</span
                              >{/snippet}</Tooltip.Trigger
                          ><Tooltip.Content>{item.owner + '/' + item.repo}</Tooltip.Content
                          ></Tooltip.Root
                        ></Tooltip.Provider
                      >
                    {:else if !isPr && item.team}<span class="truncate">{item.team}</span>{/if}
                    {#if item.author}
                      {#if isPr}<Tooltip.Provider
                          ><Tooltip.Root
                            ><Tooltip.Trigger
                              >{#snippet child({ props: homeTooltipProps })}<span
                                  {...homeTooltipProps}
                                  class="shrink-0"
                                >
                                  <GitHubAvatar
                                    identity={item.author ?? ''}
                                    alt={item.author}
                                    size={20}
                                    class="rounded-full"
                                  >
                                    {#snippet fallback()}<span
                                        class="flex size-5 items-center justify-center rounded-full bg-muted text-xs"
                                        role="img"
                                        aria-label={item.author}
                                        >{item.author?.slice(0, 1).toUpperCase()}</span
                                      >{/snippet}
                                  </GitHubAvatar>
                                </span>{/snippet}</Tooltip.Trigger
                            ><Tooltip.Content>{item.author}</Tooltip.Content></Tooltip.Root
                          ></Tooltip.Provider
                        >
                      {:else}<span class="truncate">{item.author}</span>{/if}
                    {/if}
                  </span>
                </div>
              {/snippet}
              {#snippet description()}
                {@const linked = $linkedWorkspaces$.find(
                  (link) => link.url === item.url.replace(/\/$/, '').toLowerCase(),
                )}
                {#if linked}
                  <div class="pt-2 pb-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      class="h-7 max-w-full gap-2 rounded-full px-3"
                      tooltip={m.home_integrations_open_workspace()}
                      onclick={(event) => {
                        event.stopPropagation();
                        workspacePreviewId = linked.workspaceId;
                      }}
                    >
                      <Fa icon={faLayerGroup} />
                      <span class="truncate">{linked.name}</span>
                    </Button>
                  </div>
                {/if}
              {/snippet}
              {#snippet trailing()}<div
                  class="type-caption flex items-center gap-3 text-muted-foreground"
                >
                  {#if !isPr}<span>{item.state}</span>{/if}
                  {#if isPr && item.additions !== undefined && item.deletions !== undefined}
                    <span class="inline-flex gap-2 tabular-nums"
                      ><span class="text-success">+{formatInteger(item.additions)}</span><span
                        class="text-danger">−{formatInteger(item.deletions)}</span
                      ></span
                    >
                  {/if}
                  {#if item.updatedAt}<RelativeTime date={item.updatedAt} compact />{/if}
                </div>{/snippet}
            </ListRow>
          {/snippet}
        </ListView>
        {#if view.status === 'loading'}<HomeLoading count={2} />{/if}
        {#if view.error}<p class="px-5 py-3 text-sm text-muted-foreground" role="alert">
            {view.error}
          </p>{/if}
        {#if view.cursors.some(Boolean)}<div class="p-4 text-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={!!preview || view.loadingMore}
              loading={view.loadingMore}
              onclick={() => appStore.dispatch(loadMoreHomeIntegrations())}
              >{view.error ? m.home_integrations_retry() : m.home_integrations_more()}</Button
            >
          </div>{/if}
      {/if}
    </div>
  </div>
  {#if workspacePreview}
    <HomePreviewPane>
      {#key workspacePreview.id}
        <HomeWorkspaceDetail
          workspace={workspacePreview}
          preview={!!preview}
          onclose={() => (workspacePreviewId = null)}
        />
      {/key}
    </HomePreviewPane>
  {:else if selectedId}
    <HomePreviewPane>
      <Tabs.Root
        value={pullTab}
        variant="underline"
        size="compact"
        onValueChange={changePullTab}
        class="flex h-full min-h-0 w-full flex-col"
      >
        <section
          class="flex h-full min-h-0 w-full min-w-0 flex-col"
          aria-label={m.home_integrations_detail()}
        >
          {#if isPr && detail && !view.detailLoading && !view.detailError}
            <header
              class="shrink-0 space-y-2.5 border-b border-border px-5 pt-4"
              data-home-pr-header
            >
              <div class="flex items-start gap-2">
                <h2
                  class="min-w-0 flex-1 break-words text-xl font-medium leading-snug tracking-tight"
                >
                  {detail.title}
                </h2>
                <span
                  class="inline-flex shrink-0 items-center gap-1.5 pt-1 type-caption text-muted-foreground"
                >
                  <HomePullState state={detail.state} compact />{detail.identifier}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={m.home_integrations_open_github()}
                  tooltip={m.home_integrations_open_github()}
                  onclick={(event) => openLink(detail.url, event)}
                  ><Fa icon={faArrowUpRightFromSquare} /></Button
                >
                <Button
                  data-integration-close
                  size="icon-sm"
                  variant="ghost"
                  aria-label={m.home_integrations_close()}
                  tooltip={m.home_integrations_close()}
                  onclick={() => selectItem(null)}><Fa icon={faXmark} /></Button
                >
              </div>
              <div
                class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 type-caption text-muted-foreground"
              >
                {#if detail.author}<span
                    class="home-pr-metadata inline-flex min-w-0 items-center gap-2"
                  >
                    <span class="flex size-5 shrink-0 items-center justify-center">
                      <GitHubAvatar identity={detail.author} size={20} class="rounded-full" />
                    </span>
                    <span class="truncate">{detail.author}</span>
                  </span>{/if}
                <Tooltip.Provider
                  ><Tooltip.Root
                    ><Tooltip.Trigger
                      >{#snippet child({ props: homeTooltipProps })}<span
                          {...homeTooltipProps}
                          class="home-pr-metadata inline-flex min-w-0 items-center gap-2"
                        >
                          <span class="flex size-5 shrink-0 items-center justify-center"
                            ><Fa icon={faBook} /></span
                          ><span class="truncate">{detail.owner}/{detail.repo}</span>
                        </span>{/snippet}</Tooltip.Trigger
                    ><Tooltip.Content>{detail.owner + '/' + detail.repo}</Tooltip.Content
                    ></Tooltip.Root
                  ></Tooltip.Provider
                >
                {#if detail.headRef}<Tooltip.Provider
                    ><Tooltip.Root
                      ><Tooltip.Trigger
                        >{#snippet child({ props: homeTooltipProps })}<span
                            {...homeTooltipProps}
                            class="home-pr-metadata inline-flex min-w-0 items-center gap-2"
                            ><span class="flex size-5 shrink-0 items-center justify-center"
                              ><Fa icon={faCodeBranch} /></span
                            ><span class="truncate">{detail.headRef} → {detail.baseRef}</span></span
                          >{/snippet}</Tooltip.Trigger
                      ><Tooltip.Content>{`${detail.headRef} → ${detail.baseRef}`}</Tooltip.Content
                      ></Tooltip.Root
                    ></Tooltip.Provider
                  >{/if}
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Tabs.List class="gap-5 px-0" aria-label={m.home_integrations_detail()}>
                  <Tabs.Trigger value="summary" class="px-0"
                    >{m.home_integrations_summary_tab()}</Tabs.Trigger
                  >
                  <Tabs.Trigger value="code" class="px-0"
                    >{m.home_integrations_code_tab()}{#if view.reviewData?.changedFiles !== undefined}<span
                        aria-hidden="true"
                        class="ml-1 text-muted-foreground"
                        >{formatInteger(view.reviewData.changedFiles)}</span
                      >{/if}</Tabs.Trigger
                  >
                </Tabs.List>
                <div class="ml-auto flex items-center gap-1">
                  {#if linkedWorkspace}<Button
                      size="sm"
                      variant="secondary"
                      class="h-7 max-w-full gap-2 rounded-full px-3"
                      onclick={openWorkspace}
                      tooltip={m.home_integrations_open_workspace()}
                      ><Fa icon={faLayerGroup} /><span class="truncate">{linkedWorkspace.name}</span
                      ></Button
                    >
                  {:else if !$collaborator$}<Button
                      size="sm"
                      variant="primary"
                      disabled={!!preview}
                      onclick={() => appStore.dispatch(startHomeIntegrationWorkspace())}
                      >{m.home_integrations_start_workspace()}</Button
                    >{/if}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={m.home_integrations_review_on_github()}
                    tooltip={m.home_integrations_review_on_github()}
                    onclick={(event) => openLink(`${detail.url}/files`, event)}
                    ><Fa icon={faCodePullRequest} /></Button
                  >
                </div>
              </div>
            </header>
          {:else if !isPr && detail && !view.detailLoading && !view.detailError}
            <header
              data-home-linear-header
              class="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3"
            >
              <span class="shrink-0 type-caption text-muted-foreground">{detail.identifier}</span>
              {#if detail.state}<Tooltip.Provider
                  ><Tooltip.Root
                    ><Tooltip.Trigger
                      >{#snippet child({ props: homeTooltipProps })}<span
                          {...homeTooltipProps}
                          class="min-w-0 truncate rounded-md bg-muted px-2 py-1 type-caption"
                          >{detail.state}</span
                        >{/snippet}</Tooltip.Trigger
                    ><Tooltip.Content>{detail.state}</Tooltip.Content></Tooltip.Root
                  ></Tooltip.Provider
                >{/if}
              <div class="ml-auto flex shrink-0 items-center gap-1">
                {#if detail.url}<Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={m.home_integrations_open_linear()}
                    tooltip={m.home_integrations_open_linear()}
                    onclick={(event) => openLink(detail.url, event)}
                    ><Fa icon={faArrowUpRightFromSquare} /></Button
                  >{/if}
                <Button
                  data-integration-close
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.home_integrations_close()}
                  tooltip={m.home_integrations_close()}
                  onclick={() => selectItem(null)}><Fa icon={faXmark} /></Button
                >
              </div>
            </header>
          {:else}
            <header class="shrink-0 space-y-3 border-b border-border p-6">
              <div class="flex items-center justify-between gap-2">
                <span class="type-caption text-muted-foreground"
                  >{detail?.identifier ?? m.home_integrations_detail()}</span
                ><Button
                  data-integration-close
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.home_integrations_close()}
                  tooltip={m.home_integrations_close()}
                  onclick={() => selectItem(null)}><Fa icon={faXmark} /></Button
                >
              </div>
              {#if detail && !view.detailLoading && !view.detailError}
                <div class="space-y-3">
                  {#if isPr}<HomePullState state={detail.state} />{:else}<p
                      class="type-caption text-muted-foreground"
                    >
                      {detail.state}
                    </p>{/if}
                  <h2 class="break-words text-xl font-medium tracking-tight">{detail.title}</h2>
                  {#if isPr}<div
                      class="flex flex-wrap items-center gap-2 type-caption text-muted-foreground"
                    >
                      {#if detail.author}<GitHubAvatar
                          identity={detail.author}
                          size={20}
                          class="rounded-full"
                        /><span>{detail.author}</span><span aria-hidden="true">·</span>{/if}
                      <span>{detail.owner}/{detail.repo}</span>
                      {#if detail.updatedAt}<RelativeTime date={detail.updatedAt} compact />{/if}
                    </div>
                    {#if detail.headRef}<p
                        class="break-all font-mono type-caption text-muted-foreground"
                      >
                        {detail.headRef} → {detail.baseRef}
                      </p>{/if}
                    {#if view.reviewData?.additions !== undefined && view.reviewData.deletions !== undefined}<div
                        class="flex gap-3 type-caption tabular-nums"
                      >
                        <span class="text-success">+{formatInteger(view.reviewData.additions)}</span
                        ><span class="text-danger">−{formatInteger(view.reviewData.deletions)}</span
                        >{#if view.reviewData.changedFiles !== undefined}<span
                            class="text-muted-foreground"
                            >{m.home_integrations_files({
                              count: formatInteger(view.reviewData.changedFiles),
                            })}</span
                          >{/if}
                      </div>{/if}
                  {/if}
                  <div class="flex flex-wrap gap-2">
                    {#if detail.url}<Button
                        size="sm"
                        onclick={(event) => openLink(detail.url, event)}
                        >{isPr
                          ? m.home_integrations_open_github()
                          : m.home_integrations_open_linear()}</Button
                      >{/if}
                    {#if linkedWorkspace}<Button size="sm" variant="primary" onclick={openWorkspace}
                        >{m.home_integrations_open_workspace()}</Button
                      >{:else if !$collaborator$}<Button
                        size="sm"
                        variant="primary"
                        disabled={!!preview}
                        onclick={() => appStore.dispatch(startHomeIntegrationWorkspace())}
                        >{m.home_integrations_start_workspace()}</Button
                      >{/if}
                  </div>
                </div>
              {/if}
              {#if isPr && detail && !view.detailLoading && !view.detailError}
                <div class="flex flex-wrap items-center gap-2">
                  <Tabs.List class="gap-5 px-0" aria-label={m.home_integrations_detail()}>
                    <Tabs.Trigger value="summary" class="px-0"
                      >{m.home_integrations_summary_tab()}</Tabs.Trigger
                    >
                    <Tabs.Trigger value="code" class="px-0"
                      >{m.home_integrations_code_tab()}</Tabs.Trigger
                    >
                  </Tabs.List>
                  <div class="ml-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      onclick={(event) => openLink(`${detail.url}/files`, event)}
                      >{m.home_integrations_review_on_github()}</Button
                    >
                  </div>
                </div>
              {/if}
            </header>
          {/if}
          <div class="integration-detail-body min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto p-6">
            {#if view.detailLoading}<HomeLoading detail />
            {:else if view.detailError}<div class="space-y-3" role="alert">
                <p class="break-words text-sm text-muted-foreground">{view.detailError}</p>
                <Button disabled={!!preview} onclick={() => selectItem(selectedId)}
                  >{m.home_integrations_retry()}</Button
                >
              </div>
            {:else if detail}
              {#if isPr}
                <Tabs.Content value="summary" class="mt-0 space-y-6">
                  {#if detail.labels?.length}<div class="flex flex-wrap gap-2">
                      {#each detail.labels as label}<span
                          class="rounded-md bg-muted px-2 py-1 type-caption text-muted-foreground"
                          >{label}</span
                        >{/each}
                    </div>{/if}
                  <HomePullSummary
                    {detail}
                    retryChecks={() => appStore.dispatch(loadHomePullChecks())}
                    retryReviews={() => appStore.dispatch(loadHomePullReviewData())}
                    retryDisabled={!!preview}
                    data={view.reviewData}
                    checksLoading={view.checksLoading}
                    checksError={view.checksError}
                    reviewsLoading={view.reviewLoading}
                    reviewsError={view.reviewError}
                    open={openLink}
                  />
                  {#if view.reviewsCursor}<Button
                      size="sm"
                      disabled={!!preview || view.reviewLoading}
                      onclick={() => appStore.dispatch(loadHomePullReviewData())}
                      >{m.home_integrations_more()}</Button
                    >{/if}
                  <section class="space-y-3">
                    <h3 class="text-sm font-medium">{m.home_integrations_comments()}</h3>
                    <div class="space-y-5 border-l-2 border-border pl-4">
                      {#each reviewActivity as activity (activity.id)}
                        {#if activity.kind === 'review'}
                          {@const review = activity.review}
                          <HomePullComment
                            author={review.author}
                            body={review.body ?? ''}
                            date={review.submittedAt}
                            caption={review.state.toLowerCase() === 'approved'
                              ? m.home_integrations_review_approved()
                              : review.state.toLowerCase() === 'changes_requested'
                                ? m.home_integrations_review_changes_requested()
                                : m.home_integrations_review_commented()}
                            url={review.url}
                            open={openLink}
                          />
                        {:else}
                          {@const thread = activity.thread}
                          {@const first = thread.comments[0]}
                          <details
                            open
                            class="min-w-0 overflow-hidden rounded-lg border border-border bg-background"
                            data-home-review-thread
                          >
                            <summary class="cursor-pointer bg-muted/30 px-4 py-3 type-caption">
                              <span class="break-all"
                                >{first.path}{first.line ? ':' + first.line : ''}</span
                              >
                            </summary>
                            {#each thread.comments as comment (comment.id)}
                              <HomePullComment
                                threaded
                                author={comment.user.login}
                                body={comment.body}
                                date={comment.createdAt}
                                url={comment.htmlUrl}
                                open={openLink}
                              />
                            {/each}
                            <div class="border-t border-border bg-muted/20 px-4 py-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onclick={(event) => openLink(first.htmlUrl, event)}
                              >
                                {m.home_attention_reply()}
                                <Fa icon={faArrowUpRightFromSquare} />
                              </Button>
                            </div>
                          </details>
                        {/if}
                      {/each}
                    </div>
                    {#if view.commentsLoading}<HomeLoading
                        count={2}
                      />{:else if view.commentsError}<p
                        role="alert"
                        class="break-words text-sm text-muted-foreground"
                      >
                        {view.commentsError}
                      </p>{:else if !reviewActivity.length}<p class="text-sm text-muted-foreground">
                        {m.home_integrations_no_comments()}
                      </p>{/if}
                    {#if view.commentsCursor || view.commentsError}<Button
                        size="sm"
                        disabled={!!preview || view.commentsLoading}
                        onclick={() => appStore.dispatch(loadHomeReviewComments())}
                        >{view.commentsError
                          ? m.home_integrations_retry()
                          : m.home_integrations_more_comments()}</Button
                      >{/if}
                  </section>
                </Tabs.Content>
                <Tabs.Content value="code" class="mt-0 space-y-4">
                  {#if view.files.length || (!view.filesLoading && !view.filesError)}<HomePullCode
                      files={view.files}
                      open={openLink}
                    />{/if}
                  {#if view.filesLoading}<HomeLoading count={2} />{/if}
                  {#if view.filesError}<p class="type-caption text-muted-foreground" role="alert">
                      {view.filesError}
                    </p>{/if}
                  {#if view.filesCursor || (view.filesError && view.filesError !== m.home_integrations_read_upgrade())}<Button
                      size="sm"
                      disabled={!!preview || view.filesLoading}
                      onclick={() => appStore.dispatch(loadHomePullFiles())}
                      >{view.filesError
                        ? m.home_integrations_retry()
                        : m.home_integrations_more()}</Button
                    >{/if}
                  {#if view.filesTruncated}<p class="type-caption text-muted-foreground">
                      {m.home_integrations_files_truncated()}
                    </p>{/if}
                  <Button
                    size="sm"
                    variant="ghost"
                    onclick={(event) => openLink(`${detail.url}/files`, event)}
                    >{m.home_integrations_review_on_github()}</Button
                  >
                </Tabs.Content>
              {:else}
                <div data-home-linear-content class="space-y-5">
                  <div class="space-y-3">
                    <h2 class="break-words text-lg font-medium leading-snug tracking-tight">
                      {detail.title}
                    </h2>
                    <div class="flex flex-wrap items-center gap-2">
                      {#if linkedWorkspace}<Button
                          size="sm"
                          variant="primary"
                          onclick={openWorkspace}>{m.home_integrations_open_workspace()}</Button
                        >
                      {:else if !$collaborator$}<Button
                          size="sm"
                          variant="primary"
                          disabled={!!preview}
                          onclick={() => appStore.dispatch(startHomeIntegrationWorkspace())}
                          >{m.home_integrations_start_workspace()}</Button
                        >{/if}
                      {#if detail.labels?.length}{#each detail.labels as label}<span
                            class="rounded-md bg-muted px-2 py-1 type-caption text-muted-foreground"
                            >{label}</span
                          >{/each}{/if}
                    </div>
                  </div>
                  <section
                    class="linear-description"
                    aria-label={m.home_integrations_description()}
                  >
                    {#if detail.description}<MarkdownViewer
                        content={detail.description}
                        allowFileMedia={false}
                        canOpenFile={() => false}
                        renderRichFencesAsCode
                      />
                    {:else}<p class="text-sm text-muted-foreground">
                        {m.home_integrations_no_description()}
                      </p>{/if}
                  </section>
                  <dl
                    class="flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-4 type-caption"
                    data-home-linear-properties
                  >
                    {#if detail.assignee}<div class="min-w-0 max-w-full">
                        <dt class="text-muted-foreground">{m.home_integrations_assignee()}</dt>
                        <dd class="mt-1 break-words">{detail.assignee}</dd>
                      </div>{/if}
                    {#if detail.priority !== undefined && detail.priority > 0}<div>
                        <dt class="text-muted-foreground">{m.home_integrations_priority()}</dt>
                        <dd class="mt-1">{priorities[detail.priority] ?? detail.priority}</dd>
                      </div>{/if}
                    {#if detail.project}<div class="min-w-0 max-w-full">
                        <dt class="text-muted-foreground">{m.home_integrations_project()}</dt>
                        <dd class="mt-1 break-words">{detail.project}</dd>
                      </div>{/if}
                    {#if detail.team}<div class="min-w-0 max-w-full">
                        <dt class="text-muted-foreground">{m.home_integrations_team()}</dt>
                        <dd class="mt-1 break-words">{detail.team}</dd>
                      </div>{/if}
                    {#if detail.author}<div class="min-w-0 max-w-full">
                        <dt class="text-muted-foreground">{m.home_integrations_author()}</dt>
                        <dd class="mt-1 break-words">{detail.author}</dd>
                      </div>{/if}
                    {#if detail.updatedAt}<div>
                        <dt class="text-muted-foreground">{m.home_integrations_updated()}</dt>
                        <dd class="mt-1"><RelativeTime date={detail.updatedAt} /></dd>
                      </div>{/if}
                  </dl>
                </div>
              {/if}
            {/if}
          </div>
        </section>
      </Tabs.Root>
    </HomePreviewPane>
  {/if}
</div>

<style>
  .integration-detail-body :global(.markdown-viewer) {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .integration-detail-body :global(.markdown-viewer pre) {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre;
    overflow-wrap: normal;
    padding: 1rem;
    border-radius: 0.5rem;
    background: var(--muted);
  }
  .integration-detail-body :global(.markdown-viewer pre code) {
    padding: 0;
    white-space: pre;
    word-break: normal;
    overflow-wrap: normal;
  }
  .integration-detail-body :global(.markdown-viewer table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }
  .integration-detail-body :global(.markdown-viewer th),
  .integration-detail-body :global(.markdown-viewer td) {
    min-width: 10rem;
    overflow-wrap: normal;
  }

  .linear-description :global(.markdown-viewer) {
    font-size: 0.875rem;
    line-height: 1.6;
  }
  .linear-description :global(h1),
  .linear-description :global(h2),
  .linear-description :global(h3) {
    font-size: 0.875rem;
    line-height: 1.5;
    margin-block: 1rem 0.5rem;
    font-weight: 500;
  }
  .linear-description :global(.markdown-viewer > :first-child) {
    margin-top: 0;
  }
  .home-integrations {
    container: home-integrations / inline-size;
  }
  .integration-list[data-has-detail='true'] {
    display: none;
  }
  @container home-integrations (min-width: 1001px) {
    .integration-list[data-has-detail='true'] {
      display: flex;
    }
  }
</style>
