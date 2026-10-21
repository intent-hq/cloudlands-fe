<script lang="ts">
  import WorkspaceMicroKeySlot from '$features/hardware-console/components/WorkspaceMicroKeySlot.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faThumbtack } from '$lib/icons/phosphor-icons';
  import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
  import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
  import HomeActivityTime from './HomeActivityTime.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { getHomeTriageGroup } from './home-model';
  import {
    ignoreRepeatHomeWorkspaceClick,
    openHomeWorkspaceFromDoubleClick,
    openHomeWorkspaceFromEvent,
  } from './home-workspace-opening';

  let {
    workspaces,
    pinnedIds = [],
    selectedId,
    onselect,
    onopen,
    onopenselected = onopen,
    oncontextmenu,
    archived = false,
    showRepository = true,
    showRepositoryOwner = true,
    groups,
  }: {
    workspaces: Workspace[];
    pinnedIds?: readonly string[];
    selectedId: string | null;
    onselect: (id: string) => void;
    onopen: (id: string) => void;
    /** Opens the workspace and keeps it selected in Home (double-click). */
    onopenselected?: (id: string) => void;
    oncontextmenu?: (event: MouseEvent | KeyboardEvent, workspace: Workspace) => void;
    archived?: boolean;
    showRepository?: boolean;
    showRepositoryOwner?: boolean;
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
  class="min-h-0 min-w-0 flex-1 overflow-auto px-6 pb-5"
  data-home-board
  aria-label={m.home_board_view()}
>
  <div
    class="grid w-full content-start grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3"
  >
    {#each displayColumns as group (group.id)}
      {@const items = group.items}
      <section class="flex min-w-0 flex-col self-stretch" aria-label={group.label}>
        <h3
          class="sticky top-0 z-20 flex min-w-0 items-center gap-2 [overflow-wrap:anywhere] bg-background px-2 py-3 type-caption font-medium"
        >
          {group.label}
        </h3>
        <div class="flex flex-col gap-2 pb-2">
          {#each items as workspace (workspace.id)}
            {@const pinned = pinnedIds.includes(workspace.id)}
            {@const displayTitle = workspace.title.trim()
              ? workspace.title
              : m.workspace_links_untitled_label()}
            {@const repositoryLabel =
              [
                showRepositoryOwner ? workspace.repositoryOwner : undefined,
                workspace.repositoryName,
              ]
                .filter(Boolean)
                .join('/') || workspace.repositoryPath}
            <Button
              data-home-workspace={workspace.id}
              variant="outline"
              active={selectedId === workspace.id}
              aria-pressed={selectedId === workspace.id}
              wrapContent={false}
              class="h-auto min-w-0 w-full shrink-0 flex-col items-stretch whitespace-normal rounded-xl border-border bg-background gap-0 p-3 text-left shadow-xs"
              onclick={(event) => {
                if (ignoreRepeatHomeWorkspaceClick(event)) return;
                if (!openHomeWorkspaceFromEvent(event, workspace.id, onopen))
                  onselect(workspace.id);
              }}
              ondblclick={(event) =>
                openHomeWorkspaceFromDoubleClick(event, workspace.id, onopenselected)}
              oncontextmenu={(event) => oncontextmenu?.(event, workspace)}
              onkeydown={(event) => {
                oncontextmenu?.(event, workspace);
                if (!event.defaultPrevented)
                  openHomeWorkspaceFromEvent(event, workspace.id, onopen);
              }}
              aria-label={displayTitle}
              aria-describedby={pinned ? `home-board-pinned-${workspace.id}` : undefined}
            >
              <span class="flex items-start justify-between gap-3">
                <WorkspaceMicroKeySlot workspaceId={workspace.id} />
                <Tooltip.Provider
                  ><Tooltip.Root
                    ><Tooltip.Trigger
                      >{#snippet child({ props: homeTooltipProps })}<span
                          {...homeTooltipProps}
                          class="min-w-0 flex-1 line-clamp-2 [overflow-wrap:anywhere] font-medium"
                        >
                          {displayTitle}
                        </span>{/snippet}</Tooltip.Trigger
                    ><Tooltip.Content>{displayTitle}</Tooltip.Content></Tooltip.Root
                  ></Tooltip.Provider
                >
                <span class="mt-0.5 flex shrink-0 items-center gap-2">
                  {#if pinned}
                    <span
                      class="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                      data-home-workspace-pin
                      aria-hidden="true"
                    >
                      <Fa icon={faThumbtack} class="size-3" />
                    </span>
                    <span id="home-board-pinned-{workspace.id}" class="sr-only">
                      {m.layout_activeCard_pinned_header()}
                    </span>
                  {/if}
                  <HomeWorkspaceStatus {workspace} />
                </span>
              </span>
              {#if workspace.statusMessage}
                <span
                  class="home-workspace-summary mt-2 line-clamp-2 [overflow-wrap:anywhere] type-caption text-muted-foreground"
                >
                  {workspace.statusMessage}
                </span>
              {/if}
              <span
                class="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 type-caption text-muted-foreground"
              >
                {#if showRepository && repositoryLabel}
                  <Tooltip.Provider
                    ><Tooltip.Root
                      ><Tooltip.Trigger
                        >{#snippet child({ props: homeTooltipProps })}<span
                            {...homeTooltipProps}
                            class="flex min-w-0 max-w-[min(70%,16rem)] items-center gap-1.5"
                          >
                            {#if workspace.repositoryOwner}
                              <GitHubAvatar
                                identity={workspace.repositoryOwner}
                                class="shrink-0 rounded-sm"
                              />
                            {/if}
                            <span class="truncate" data-home-workspace-repository
                              >{repositoryLabel}</span
                            >
                          </span>{/snippet}</Tooltip.Trigger
                      ><Tooltip.Content>{repositoryLabel}</Tooltip.Content></Tooltip.Root
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
