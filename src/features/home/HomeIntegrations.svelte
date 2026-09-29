<script lang="ts">
  import { onDestroy, untrack, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { ListView, ListRow } from '$lib/components/patterns/collection';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { describeHomeIntegrationScope } from './home-integrations-model';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    selectHomeIntegrations,
    selectHomeIntegrationWorkspace,
  } from './home-integrations-selectors';
  import {
    mountHomeIntegrations,
    unmountHomeIntegrations,
    searchHomeIntegrations,
    refreshHomeIntegrations,
    loadMoreHomeIntegrations,
    selectHomeIntegration,
    loadHomeReviewComments,
    startHomeIntegrationWorkspace,
    openHomeIntegrationUrl,
  } from './home-integrations-slice';
  import type {
    HomeIntegrationKind,
    IntegrationRepository,
    HomeIntegrationsState,
  } from './home-integrations-types';

  let {
    kind,
    repositories,
    workspaceId,
    preview,
  }: {
    kind: HomeIntegrationKind;
    repositories: IntegrationRepository[];
    workspaceId?: string;
    preview?: HomeIntegrationsState;
  } = $props();
  const collaborator$ = selectIsCollaboratorOnlyClient();
  let root: HTMLDivElement;
  let returnFocusIndex = 0;
  const live$ = selectHomeIntegrations();
  const workspace$ = selectHomeIntegrationWorkspace();
  let previewSelection = $state<string | null | undefined>(undefined);
  let previewQuery = $state('');
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
  const items = $derived(
    preview
      ? view.items.filter((item) =>
          `${item.title} ${item.identifier}`.toLowerCase().includes(previewQuery.toLowerCase()),
        )
      : view.items,
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
          { value: 'assigned', label: m.home_integrations_assigned() },
          { value: 'created', label: m.home_integrations_created() },
          { value: 'all', label: m.home_integrations_all() },
        ],
  );
  const priorities = $derived([
    m.home_integrations_priority_none(),
    m.home_integrations_priority_urgent(),
    m.home_integrations_priority_high(),
    m.home_integrations_priority_normal(),
    m.home_integrations_priority_low(),
  ]);
  const scopeMetadata = $derived(describeHomeIntegrationScope({ kind, repositories, workspaceId }));
  $effect(() => {
    scopeMetadata.key;
    if (preview) return;
    untrack(() => appStore.dispatch(mountHomeIntegrations({ kind, repositories, workspaceId })));
  });
  onDestroy(() => {
    if (!preview) appStore.dispatch(unmountHomeIntegrations());
  });
  function search(value: string, filter = view.filter, closed = view.closed) {
    if (preview) {
      previewQuery = value;
      return;
    }
    appStore.dispatch(searchHomeIntegrations(value, filter, closed));
  }
  async function selectItem(id: string | null) {
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
  function handleEscape(event: KeyboardEvent) {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      selectedId &&
      root?.contains(document.activeElement)
    ) {
      event.preventDefault();
      void selectItem(null);
    }
  }
  function openWorkspace() {
    if (!linkedWorkspace) return;
    appStore.dispatch(openWorkspaceTab(linkedWorkspace.workspaceId));
    void goto(`/workspace/${encodeURIComponent(linkedWorkspace.workspaceId)}`);
  }
</script>

<svelte:window onkeydown={handleEscape} />

<div
  bind:this={root}
  class="home-integrations flex h-full min-h-0 flex-1 flex-col"
  data-home-integrations={kind}
>
  <div class="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
    <div class="min-w-40 flex-1">
      <Input
        type="search"
        value={query}
        aria-label={m.home_integrations_search()}
        placeholder={isPr ? m.home_integrations_search_prs() : m.home_integrations_search_issues()}
        oninput={(event) => search(event.currentTarget.value)}
      />
    </div>
    <Button
      variant="ghost"
      size="sm"
      disabled={!!preview || view.status === 'loading' || view.loadingMore}
      onclick={() => appStore.dispatch(refreshHomeIntegrations())}
      >{m.home_integrations_refresh()}</Button
    >
  </div>
  <div class="flex flex-wrap items-center gap-1 border-b border-border px-5 py-2">
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
      <div class="ml-auto flex gap-1">
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
          onclick={() => search(query, view.filter, true)}>{m.home_integrations_closed()}</Button
        >
      </div>
    {/if}
  </div>
  {#if !isPr}<p class="border-b border-border px-5 py-2 type-caption text-muted-foreground">
      {query.trim()
        ? m.home_integrations_linear_search_scope()
        : m.home_integrations_linear_scope()}
    </p>{/if}
  {#if isPr && scopeMetadata.hasLocalRepositories}<p
      class="px-5 py-2 type-caption text-muted-foreground"
    >
      {m.home_integrations_local_repos()}
    </p>{/if}
  <div class="flex min-h-0 flex-1 overflow-hidden">
    <div
      class="integration-list min-h-0 min-w-0 flex-1 overflow-y-auto"
      data-has-detail={!!selectedId}
    >
      {#if view.status === 'loading' || view.status === 'idle'}
        <div class="p-8 text-center text-sm text-muted-foreground" role="status">
          {m.home_integrations_loading()}
        </div>
      {:else if view.status === 'disconnected'}
        <div class="space-y-3 p-8 text-center">
          <h2 class="text-base font-medium">
            {isPr ? m.home_integrations_connect_github() : m.home_integrations_connect_linear()}
          </h2>
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
        <div class="px-5 py-3 type-caption text-muted-foreground" aria-live="polite">
          {m.home_integrations_loaded({ count: formatInteger(items.length) })}
        </div>
        <ListView
          {items}
          getKey={(item) => item.id}
          getText={(item) => item.title}
          selectable="single"
          selectedKeys={selectedId ? [selectedId] : []}
          onSelectedKeysChange={(keys) =>
            selectItem(keys[0] === undefined ? null : String(keys[0]))}
          onActivate={(item) => selectItem(item.id)}
          ariaLabel={isPr ? m.home_integrations_prs() : m.home_integrations_issues()}
        >
          {#snippet empty()}<p class="p-8 text-center text-sm text-muted-foreground">
              {isPr && !scopeMetadata.hasGitHubRepositories
                ? m.home_integrations_no_repositories()
                : m.home_integrations_empty()}
            </p>{/snippet}
          {#snippet row({ item })}
            <ListRow class="px-5 py-3">
              {#snippet title()}<span class="font-medium">{item.title}</span>{/snippet}
              {#snippet description()}<span
                  >{item.identifier} · {isPr ? `${item.owner}/${item.repo}` : item.team}{item.author
                    ? ` · ${item.author}`
                    : ''}</span
                >{/snippet}
              {#snippet meta()}<span
                  class="rounded-md bg-muted px-2 py-0.5 type-caption capitalize text-muted-foreground"
                  >{item.state}</span
                >{/snippet}
              {#snippet trailing()}{#if item.updatedAt}<RelativeTime
                    date={item.updatedAt}
                  />{/if}{/snippet}
            </ListRow>
          {/snippet}
        </ListView>
        {#if view.error}<p class="px-5 py-3 text-sm text-muted-foreground" role="alert">
            {view.error}
          </p>{/if}
        {#if view.cursors.some(Boolean)}<div class="p-4 text-center">
            <Button
              disabled={!!preview || view.loadingMore}
              loading={view.loadingMore}
              onclick={() => appStore.dispatch(loadMoreHomeIntegrations())}
              >{view.error ? m.home_integrations_retry() : m.home_integrations_more()}</Button
            >
          </div>{/if}
      {/if}
    </div>
    {#if selectedId}
      <section
        class="integration-detail flex min-h-0 w-full min-w-0 flex-col border-l border-border"
        aria-label={m.home_integrations_detail()}
      >
        <header class="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <span class="type-caption text-muted-foreground">{m.home_integrations_detail()}</span
          ><Button data-integration-close variant="ghost" size="sm" onclick={() => selectItem(null)}
            >{m.home_integrations_close()}</Button
          >
        </header>
        <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {#if view.detailLoading}<p role="status" class="text-sm text-muted-foreground">
              {m.home_integrations_loading()}
            </p>
          {:else if view.detailError}<div class="space-y-3" role="alert">
              <p class="break-words text-sm text-muted-foreground">{view.detailError}</p>
              <Button disabled={!!preview} onclick={() => selectItem(selectedId)}
                >{m.home_integrations_retry()}</Button
              >
            </div>
          {:else if detail}
            <div class="space-y-3">
              <p class="type-caption text-muted-foreground">{detail.identifier} · {detail.state}</p>
              <h2 class="break-words text-xl font-medium tracking-tight">{detail.title}</h2>
              <div class="flex flex-wrap gap-2">
                {#if detail.url}<Button
                    size="sm"
                    onclick={() => appStore.dispatch(openHomeIntegrationUrl(detail.url))}
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
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 type-caption">
              {#if detail.author}<dt class="text-muted-foreground">
                  {m.home_integrations_author()}
                </dt>
                <dd class="break-words">{detail.author}</dd>{/if}
              {#if detail.headRef}<dt class="text-muted-foreground">
                  {m.home_integrations_branches()}
                </dt>
                <dd class="break-all font-mono">{detail.headRef} → {detail.baseRef}</dd>{/if}
              {#if detail.additions !== undefined}<dt class="text-muted-foreground">
                  {m.home_integrations_changes()}
                </dt>
                <dd>
                  +{formatInteger(detail.additions)} / −{formatInteger(
                    detail.deletions ?? 0,
                  )}{#if detail.changedFiles !== undefined}
                    · {m.home_integrations_files({
                      count: formatInteger(detail.changedFiles),
                    })}{/if}
                </dd>{/if}
              {#if detail.team}<dt class="text-muted-foreground">{m.home_integrations_team()}</dt>
                <dd class="break-words">{detail.team}</dd>{/if}
              {#if detail.priority !== undefined}<dt class="text-muted-foreground">
                  {m.home_integrations_priority()}
                </dt>
                <dd>{priorities[detail.priority] ?? detail.priority}</dd>{/if}
              {#if detail.assignee}<dt class="text-muted-foreground">
                  {m.home_integrations_assignee()}
                </dt>
                <dd class="break-words">{detail.assignee}</dd>{/if}
              {#if detail.project}<dt class="text-muted-foreground">
                  {m.home_integrations_project()}
                </dt>
                <dd class="break-words">{detail.project}</dd>{/if}
              {#if detail.updatedAt}<dt class="text-muted-foreground">
                  {m.home_integrations_updated()}
                </dt>
                <dd><RelativeTime date={detail.updatedAt} /></dd>{/if}
            </dl>
            {#if detail.labels?.length}<div class="flex flex-wrap gap-2">
                {#each detail.labels as label}<span
                    class="rounded-md bg-muted px-2 py-1 type-caption text-muted-foreground"
                    >{label}</span
                  >{/each}
              </div>{/if}
            <section class="space-y-2">
              <h3 class="text-sm font-medium">{m.home_integrations_description()}</h3>
              {#if detail.description}<MarkdownViewer
                  content={detail.description}
                  allowFileMedia={false}
                  canOpenFile={() => false}
                  forceExternalLinks
                  renderRichFencesAsCode
                />{:else}<p class="text-sm text-muted-foreground">
                  {m.home_integrations_no_description()}
                </p>{/if}
            </section>
            {#if isPr}
              <section class="space-y-2">
                <h3 class="text-sm font-medium">{m.home_integrations_checks_reviews()}</h3>
                {#if linkedWorkspace?.pull.ciStatus || linkedWorkspace?.pull.reviewDecision}
                  <p class="type-caption text-muted-foreground">
                    {m.home_integrations_workspace_summary()}
                  </p>
                  {#if linkedWorkspace.pull.ciStatus}<p class="text-sm">
                      {m.home_integrations_checks_summary({
                        passed: formatInteger(linkedWorkspace.pull.ciStatus.passed),
                        failed: formatInteger(linkedWorkspace.pull.ciStatus.failed),
                        pending: formatInteger(linkedWorkspace.pull.ciStatus.pending),
                      })}
                    </p>{/if}
                  {#if linkedWorkspace.pull.reviewDecision}<p class="text-sm">
                      {linkedWorkspace.pull.reviewDecision.replaceAll('_', ' ')}
                    </p>{/if}
                  {#if linkedWorkspace.pull.approvedBy?.length}<p
                      class="text-sm text-muted-foreground"
                    >
                      {linkedWorkspace.pull.approvedBy.join(', ')}
                    </p>{/if}
                {:else}<p class="text-sm text-muted-foreground">
                    {m.home_integrations_checks_unavailable()}
                  </p>{/if}
              </section>
              <section class="space-y-3">
                <h3 class="text-sm font-medium">{m.home_integrations_comments()}</h3>
                {#each comments as comment (comment.id)}<article
                    class="space-y-2 border-t border-border pt-3"
                  >
                    <p class="type-caption text-muted-foreground">
                      {comment.user.login} · {comment.path}{comment.line ? `:${comment.line}` : ''}
                    </p>
                    <MarkdownViewer
                      content={comment.body}
                      allowFileMedia={false}
                      canOpenFile={() => false}
                      forceExternalLinks
                      renderRichFencesAsCode
                    />{#if comment.htmlUrl}<Button
                        variant="ghost"
                        size="sm"
                        onclick={() => appStore.dispatch(openHomeIntegrationUrl(comment.htmlUrl))}
                        >{m.home_integrations_view_comment()}</Button
                      >{/if}
                  </article>{/each}
                {#if view.commentsLoading}<p role="status" class="text-sm text-muted-foreground">
                    {m.home_integrations_loading()}
                  </p>{:else if view.commentsError}<p
                    role="alert"
                    class="break-words text-sm text-muted-foreground"
                  >
                    {view.commentsError}
                  </p>{:else if !comments.length}<p class="text-sm text-muted-foreground">
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
            {/if}
          {/if}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .home-integrations {
    container-type: inline-size;
  }
  .integration-list[data-has-detail='true'] {
    display: none;
  }
  @container (min-width: 52rem) {
    .integration-list[data-has-detail='true'] {
      display: block;
    }
    .integration-detail {
      width: 48%;
    }
  }
</style>
