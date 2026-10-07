<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
  import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
  import HomeActivityTime from './HomeActivityTime.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { getHomeTriageGroup } from './home-model';
  import { scrollFade } from '$lib/actions/scroll-fade';

  let {
    workspaces,
    selectedId,
    onselect,
    archived = false,
    showRepository = true,
    groups,
  }: {
    workspaces: Workspace[];
    selectedId: string | null;
    onselect: (id: string) => void;
    archived?: boolean;
    showRepository?: boolean;
    groups?: { id: string; label: string; items: Workspace[] }[];
  } = $props();
  function column(workspace: Workspace): string {
    if (workspace.status === WorkspaceStatusEnum.Archived) return 'archived';
    const group = getHomeTriageGroup(workspace);
    return group === 'blocked'
      ? 'needs-you'
      : group === 'done' || group === 'idle'
        ? 'inactive'
        : group;
  }
  const columns = $derived(
    archived
      ? [{ id: 'archived', label: m.home_filter_archived() }]
      : [
          { id: 'needs-you', label: m.home_filter_attention() },
          ...(workspaces.some((workspace) => column(workspace) === 'pr-ready')
            ? [{ id: 'pr-ready', label: m.home_filter_pr_ready() }]
            : []),
          { id: 'running', label: m.home_filter_running() },
          { id: 'inactive', label: m.home_board_done_idle() },
        ],
  );
  const displayColumns = $derived(
    groups ??
      columns.map((group) => ({
        ...group,
        items: workspaces.filter((workspace) => column(workspace) === group.id),
      })),
  );
</script>

<div
  class="min-h-0 flex-1 overflow-auto px-6 pb-5"
  data-home-board
  use:scrollFade={{ axis: 'x' }}
  aria-label={m.home_board_view()}
>
  <div
    class="grid min-h-full w-full gap-4"
    style:grid-template-columns={`repeat(${displayColumns.length}, minmax(15rem, 1fr))`}
  >
    {#each displayColumns as group (group.id)}
      {@const items = group.items}
      <section class="flex min-w-0 flex-col self-stretch" aria-label={group.label}>
        <h3
          class="sticky top-0 z-20 flex items-center gap-2 bg-background px-2 py-3 type-caption font-medium"
        >
          {group.label}
        </h3>
        <div class="flex flex-col gap-2 pb-2">
          {#each items as workspace (workspace.id)}
            <Button
              data-home-workspace={workspace.id}
              variant="outline"
              active={selectedId === workspace.id}
              aria-pressed={selectedId === workspace.id}
              wrapContent={false}
              class="h-auto w-full shrink-0 flex-col items-stretch whitespace-normal rounded-xl border-border bg-background gap-0 p-4 text-left shadow-xs"
              onclick={() => onselect(workspace.id)}
              aria-label={workspace.title}
            >
              <span class="flex items-start justify-between gap-3">
                <Tooltip.Provider
                  ><Tooltip.Root
                    ><Tooltip.Trigger
                      >{#snippet child({ props: homeTooltipProps })}<span
                          {...homeTooltipProps}
                          class="min-w-0 line-clamp-2 break-words font-medium"
                        >
                          {workspace.title}
                        </span>{/snippet}</Tooltip.Trigger
                    ><Tooltip.Content>{workspace.title}</Tooltip.Content></Tooltip.Root
                  ></Tooltip.Provider
                >
                <HomeWorkspaceStatus {workspace} class="mt-0.5" />
              </span>
              {#if workspace.statusMessage}
                <span
                  class="home-workspace-summary mt-2 line-clamp-2 break-words type-caption text-muted-foreground"
                >
                  {workspace.statusMessage}
                </span>
              {/if}
              <span
                class="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 type-caption text-muted-foreground"
              >
                {#if showRepository && workspace.repositoryName}
                  <Tooltip.Provider
                    ><Tooltip.Root
                      ><Tooltip.Trigger
                        >{#snippet child({ props: homeTooltipProps })}<span
                            {...homeTooltipProps}
                            class="flex min-w-0 max-w-full items-center gap-1.5"
                          >
                            {#if workspace.repositoryOwner}
                              <GitHubAvatar
                                identity={workspace.repositoryOwner}
                                class="shrink-0 rounded-sm"
                              />
                            {/if}
                            <span class="truncate">{workspace.repositoryName}</span>
                          </span>{/snippet}</Tooltip.Trigger
                      ><Tooltip.Content
                        >{[workspace.repositoryOwner, workspace.repositoryName]
                          .filter(Boolean)
                          .join('/')}</Tooltip.Content
                      ></Tooltip.Root
                    ></Tooltip.Provider
                  >
                {/if}
                {#if workspace.pullRequests?.length || workspace.activePullRequest}
                  <HomeWorkspacePullBadge {workspace} />
                {/if}
                <span class="ml-auto shrink-0">
                  <HomeActivityTime {workspace} />
                </span>
              </span>
            </Button>
          {:else}
            <p class="sr-only">
              {m.home_board_empty_column()}
            </p>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>
