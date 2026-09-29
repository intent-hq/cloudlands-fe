<script lang="ts">
  import { onMount } from 'svelte';
  import HomeWorkspaceChat from './HomeWorkspaceChat.svelte';
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import { selectWorkspaceDetailHydrated } from '$store/renderer/slices/workspace/workspace-selectors';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { ListRow } from '$lib/components/patterns/collection';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { store } from '$store/renderer/store';
  import { ensureWorkspaceDetail } from '$features/workspace/workspace-detail-hydration';
  import { openHomeIntegrationUrl } from './home-integrations-slice';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';

  let {
    workspace,
    onclose,
    preview = false,
  }: {
    workspace: Workspace;
    onclose: () => void;
    preview?: boolean;
  } = $props();
  const status = $derived(resolveWorkspaceStatusState(workspace));
  const presentation = $derived(getWorkspaceStatusPresentation(status));
  let detailFailed = $state(false);
  async function loadDetail() {
    detailFailed = false;
    try {
      await ensureWorkspaceDetail(workspace.id);
      detailFailed = !selectWorkspaceDetailHydrated.select(store.state, workspace.id);
    } catch {
      detailFailed = true;
    }
  }
  onMount(() => {
    if (!preview) void loadDetail();
  });
  function openWorkspace() {
    store.dispatch(openWorkspaceTab(workspace.id));
    void goto(`/workspace/${encodeURIComponent(workspace.id)}`);
  }
</script>

<section
  class="flex h-full min-h-0 min-w-0 flex-col"
  aria-label={m.home_workspace_details()}
  data-home-detail
>
  <header class="shrink-0 space-y-2 border-b border-border px-5 py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="break-words text-base font-medium">{workspace.title}</h2>
        <p
          class="truncate type-caption text-muted-foreground"
          title={[workspace.repositoryName, workspace.branch].filter(Boolean).join(' · ')}
        >
          {[workspace.repositoryOwner, workspace.repositoryName].filter(Boolean).join('/')}
          {#if workspace.repositoryName && workspace.branch}
            ·
          {/if}{workspace.branch ?? ''}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={m.home_close_preview()}
        title={m.home_close_preview()}
        onclick={onclose}><Fa icon={faXmark} /></Button
      >
    </div>
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2 type-caption text-muted-foreground">
        <WorkspaceStatusIcon {status} />
        <span
          >{workspace.status === WorkspaceStatusEnum.Archived
            ? m.home_filter_archived()
            : presentation.label}</span
        >
      </div>
      <Button variant="primary" size="sm" onclick={openWorkspace}>{m.home_open_workspace()}</Button>
    </div>
    {#if workspace.statusMessage}<p
        class="line-clamp-2 break-words type-caption text-muted-foreground"
        title={workspace.statusMessage}
      >
        {workspace.statusMessage}
      </p>{/if}
  </header>
  <details class="shrink-0 border-b border-border" open={preview}>
    <summary
      class="cursor-pointer px-5 py-2 type-caption text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >{m.workspace_multiSelectSidebar_overviewTab_label()}</summary
    >
    <div class="max-h-64 space-y-4 overflow-y-auto px-5 pb-4">
      {#if detailFailed}<div class="space-y-2 text-sm text-muted-foreground" role="status">
          <p>{m.home_detail_unavailable()}</p>
          <Button variant="outline" size="sm" onclick={loadDetail}>{m.home_retry()}</Button>
        </div>{/if}
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 type-caption">
        {#if workspace.repositoryName}<dt class="text-muted-foreground">{m.home_repository()}</dt>
          <dd class="break-words">
            {[workspace.repositoryOwner, workspace.repositoryName].filter(Boolean).join('/')}
          </dd>{/if}
        {#if workspace.branch}<dt class="text-muted-foreground">{m.home_branch()}</dt>
          <dd class="break-all font-mono">{workspace.branch}</dd>{/if}
        {#if workspace.baseRef}<dt class="text-muted-foreground">{m.home_base_branch()}</dt>
          <dd class="break-all font-mono">{workspace.baseRef}</dd>{/if}
        <dt class="text-muted-foreground">{m.home_updated()}</dt>
        <dd><RelativeTime date={getWorkspaceActivityDisplayTime(workspace)} /></dd>
        {#if workspace.agentSummary}<dt class="text-muted-foreground">{m.home_agents()}</dt>
          <dd>{formatInteger(workspace.agentSummary.agentIds.length)}</dd>{/if}
        {#if workspace.taskStats}<dt class="text-muted-foreground">{m.home_tasks()}</dt>
          <dd>
            {m.home_task_progress({
              done: formatInteger(workspace.taskStats.completed),
              total: formatInteger(workspace.taskStats.total),
            })}
          </dd>{/if}
        {#if workspace.path}<dt class="text-muted-foreground">{m.home_location()}</dt>
          <dd class="break-all text-muted-foreground">{workspace.path}</dd>{/if}
      </dl>
      {#if workspace.tags?.length}<div class="flex flex-wrap gap-2">
          {#each workspace.tags as tag}<span
              class="rounded-md bg-muted px-2 py-1 type-caption text-muted-foreground">{tag}</span
            >{/each}
        </div>{/if}
      {#if workspace.initialPrompt}<section class="space-y-2">
          <h3 class="text-sm font-medium">{m.home_workspace_goal()}</h3>
          <p class="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {workspace.initialPrompt}
          </p>
        </section>{/if}
      {#if workspace.taskStats?.tasks?.length}
        <section class="space-y-2">
          <h3 class="text-sm font-medium">{m.home_tasks()}</h3>
          {#each workspace.taskStats.tasks as task, index (index)}
            <ListRow class="px-0">
              {#snippet title()}{task.title}{/snippet}
              {#snippet leading()}<TaskStatusIcon status={task.status} />{/snippet}
            </ListRow>
          {/each}
        </section>
      {/if}
      {#if workspace.pullRequests?.length}
        <section class="space-y-2">
          <h3 class="text-sm font-medium">{m.home_tab_prs()}</h3>
          {#each workspace.pullRequests as pr (pr.id)}
            <Button
              variant="ghost"
              class="h-auto w-full justify-start py-2"
              onclick={() => store.dispatch(openHomeIntegrationUrl(pr.url))}
            >
              <span class="min-w-0 truncate">#{pr.number} · {pr.title}</span>
            </Button>
          {/each}
        </section>
      {/if}
    </div>
  </details>
  <div class="min-h-0 min-w-0 flex-1">
    {#key workspace.id}
      <HomeWorkspaceChat {workspace} {preview} />
    {/key}
  </div>
</section>
