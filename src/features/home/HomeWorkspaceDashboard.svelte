<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { SectionedList } from '$lib/components/patterns/collection';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import TaskStatusProgress from '$lib/components/workspace/TaskStatusProgress.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import Fa from 'svelte-fa';
  import { faChevronDown, faChevronRight, faCodeBranch } from '@fortawesome/free-solid-svg-icons';
  import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
  import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
  import HomeActivityTime from './HomeActivityTime.svelte';
  import { openHomeWorkspaceFromEvent } from './home-workspace-opening';

  let {
    workspaces,
    groups,
    selectedId,
    showRepository = true,
    onselect,
    onopen,
    oncontextmenu,
    onexpand,
  }: {
    workspaces: Workspace[];
    groups: { id: string; label: string; items: Workspace[]; expanded: boolean }[];
    selectedId: string | null;
    showRepository?: boolean;
    onselect: (id: string) => void;
    onopen: (id: string) => void;
    oncontextmenu: (event: MouseEvent | KeyboardEvent, workspace: Workspace) => void;
    onexpand: (id: string, expanded: boolean, items: Workspace[]) => void;
  } = $props();
  let dashboard = $state<HTMLDivElement>();
  $effect.pre(() => {
    void groups;
    void workspaces;
    const focused = dashboard?.ownerDocument.activeElement;
    if (!(focused instanceof HTMLElement) || !dashboard?.contains(focused)) return;
    const id = focused.dataset.homeWorkspace;
    if (!id) return;
    void tick().then(() => {
      if (focused.isConnected || document.activeElement !== document.body) return;
      dashboard
        ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true });
    });
  });
</script>

{#snippet cards(items: Workspace[], repositoryVisible = showRepository)}
  <div class="home-dashboard-grid grid min-w-0 gap-4 pb-5">
    {#each items as workspace (workspace.id)}
      <Button
        data-home-workspace={workspace.id}
        variant="outline"
        active={selectedId === workspace.id}
        aria-pressed={selectedId === workspace.id}
        aria-label={workspace.title}
        wrapContent={false}
        class="h-full min-w-0 w-full flex-col items-stretch justify-start gap-4 whitespace-normal rounded-xl border-border bg-card p-5 text-left font-normal shadow-xs"
        onclick={(event) => {
          if (!openHomeWorkspaceFromEvent(event, workspace.id, onopen)) onselect(workspace.id);
        }}
        onkeydown={(event) => {
          if (!openHomeWorkspaceFromEvent(event, workspace.id, onopen))
            oncontextmenu(event, workspace);
        }}
        oncontextmenu={(event) => oncontextmenu(event, workspace)}
      >
        <span class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <HomeWorkspaceStatus {workspace} showLabel />
          <span class="ml-auto shrink-0 type-caption text-muted-foreground">
            <HomeActivityTime {workspace} />
          </span>
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-2">
          <span class="line-clamp-2 type-body font-medium [overflow-wrap:anywhere]">
            {workspace.title}
          </span>
          {#if workspace.statusMessage}
            <span
              class="home-workspace-summary line-clamp-3 type-caption text-muted-foreground [overflow-wrap:anywhere]"
            >
              {workspace.statusMessage}
            </span>
          {/if}
        </span>
        {#if workspace.taskStats && workspace.taskStats.total > 0}
          <span class="flex min-w-0 flex-col gap-2">
            <span class="type-caption text-muted-foreground">
              {m.workspace_flameGraph_tasksComplete_label({
                completed: formatInteger(workspace.taskStats.completed),
                total: formatInteger(workspace.taskStats.total),
              })}
            </span>
            <TaskStatusProgress
              fallback={workspace.taskStats}
              progress={workspace.taskStats.completed / workspace.taskStats.total}
              ariaLabel={m.workspace_hoverCard_taskProgress_ariaLabel()}
              size="compact"
              motion={false}
            />
          </span>
        {/if}
        <span class="flex min-w-0 flex-col gap-2 type-caption text-muted-foreground">
          {#if repositoryVisible && workspace.repositoryName}
            <span class="flex min-w-0 items-center gap-1.5">
              {#if workspace.repositoryOwner}
                <GitHubAvatar identity={workspace.repositoryOwner} class="shrink-0 rounded-sm" />
              {/if}
              <span class="truncate"
                >{[workspace.repositoryOwner, workspace.repositoryName]
                  .filter(Boolean)
                  .join('/')}</span
              >
            </span>
          {/if}
          {#if workspace.branch}
            <span class="flex min-w-0 items-center gap-1.5">
              <Fa icon={faCodeBranch} class="shrink-0" />
              <span class="truncate">{workspace.branch}</span>
            </span>
          {/if}
          {#if workspace.pullRequests?.length || workspace.activePullRequest}
            <span class="min-w-0"><HomeWorkspacePullBadge {workspace} /></span>
          {/if}
        </span>
      </Button>
    {/each}
  </div>
{/snippet}

<div
  bind:this={dashboard}
  class="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-1"
  data-home-dashboard
  aria-label={m.home_dashboard_view_label()}
>
  {#if groups.length}
    <SectionedList sections={groups} getKey={(group) => group.id} inset={false}>
      {#snippet header(group)}
        <h3 data-home-group={group.id} class="flex min-h-8 items-center">
          <Button
            variant="plain"
            size="sm"
            class="w-full justify-start gap-1.5 px-2"
            labelClass="flex-initial"
            aria-expanded={group.expanded}
            aria-label={group.label}
            onclick={() => onexpand(group.id, !group.expanded, group.items)}
          >
            <span class="text-left font-medium text-foreground">{group.label}</span>
            {#snippet trailingIcon()}<Fa
                icon={group.expanded ? faChevronDown : faChevronRight}
                class="size-3 text-muted-foreground"
              />{/snippet}
          </Button>
        </h3>
      {/snippet}
      {#snippet children(group)}
        {#if group.expanded}{@render cards(
            group.items,
            showRepository || group.id === 'pinned',
          )}{/if}
      {/snippet}
    </SectionedList>
  {:else}
    {@render cards(workspaces)}
  {/if}
</div>

<style>
  .home-dashboard-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  }
</style>
