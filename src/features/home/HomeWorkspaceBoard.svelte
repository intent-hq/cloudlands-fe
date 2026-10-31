<script lang="ts">
  import WorkspaceMicroKeySlot from '$features/hardware-console/components/WorkspaceMicroKeySlot.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faArrowDown, faArrowUp, faThumbtack } from '$lib/icons/phosphor-icons';
  import { HOME_SET_ASIDE_GROUP } from './home-set-aside';
  import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
  import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
  import HomeActivityTime from './HomeActivityTime.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { getHomeTriageGroup } from './home-model';
  import { openHomeWorkspaceFromEvent, type HomeDoubleClickOpener } from './home-workspace-opening';

  let {
    workspaces,
    pinnedIds = [],
    selectedId,
    onselect,
    onopen,
    doubleClick,
    oncontextmenu,
    archived = false,
    showRepository = true,
    showRepositoryOwner = true,
    groups,
    aside = [],
    dragScope = null,
    ontoggleaside,
  }: {
    workspaces: Workspace[];
    pinnedIds?: readonly string[];
    selectedId: string | null;
    onselect: (id: string) => void;
    onopen: (id: string) => void;
    /** Home's double-click opener; card clicks arm it. */
    doubleClick: HomeDoubleClickOpener;
    oncontextmenu?: (event: MouseEvent | KeyboardEvent, workspace: Workspace) => void;
    archived?: boolean;
    showRepository?: boolean;
    showRepositoryOwner?: boolean;
    groups?: { id: string; label: string; items: Workspace[] }[];
    aside?: Workspace[];
    dragScope?: string | null;
    ontoggleaside?: (workspace: Workspace, focusMoved?: boolean, expectedScope?: string) => void;
  } = $props();
  const asideIds = $derived(new Set(aside.map((workspace) => workspace.id)));
  const CARD_DRAG_TYPE = 'application/x-intent-home-workspace';
  let drag = $state<{ workspaceId: string; scope: string; token: string } | null>(null);
  let dropActive = $state(false);
  let suppressClick = false;
  function column(workspace: Workspace): string {
    // A Retired workspace (its folder was purged, PROTOCOL §5.1) is archived.
    if (
      workspace.status === WorkspaceStatusEnum.Archived ||
      workspace.status === WorkspaceStatusEnum.Retired
    )
      return 'archived';
    const group = getHomeTriageGroup(workspace);
    return group === 'blocked'
      ? 'needs-you'
      : group === 'done' || group === 'idle'
        ? 'inactive'
        : group;
  }
  function canDrag(workspace: Workspace): boolean {
    return (
      dragScope !== null &&
      !!ontoggleaside &&
      !archived &&
      column(workspace) !== 'archived' &&
      !asideIds.has(workspace.id)
    );
  }
  const draggedWorkspace = $derived(
    drag && drag.scope === dragScope
      ? workspaces.find((workspace) => workspace.id === drag?.workspaceId && canDrag(workspace))
      : undefined,
  );
  function finishDrag() {
    drag = null;
    dropActive = false;
  }
  $effect(() => {
    if (drag && !draggedWorkspace) finishDrag();
  });
  function startDrag(event: DragEvent, workspace: Workspace) {
    if (!canDrag(workspace) || dragScope === null || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    const token = globalThis.crypto.randomUUID();
    drag = { workspaceId: workspace.id, scope: dragScope, token };
    suppressClick = true;
    event.dataTransfer.clearData();
    event.dataTransfer.setData(CARD_DRAG_TYPE, token);
    event.dataTransfer.effectAllowed = 'move';
    if (event.currentTarget instanceof HTMLElement) {
      const bounds = event.currentTarget.getBoundingClientRect();
      event.dataTransfer.setDragImage(
        event.currentTarget,
        Math.max(0, event.clientX - bounds.left),
        Math.max(0, event.clientY - bounds.top),
      );
    }
  }
  function dragOver(event: DragEvent) {
    event.preventDefault();
    if (!draggedWorkspace || !event.dataTransfer?.types.includes(CARD_DRAG_TYPE)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      dropActive = false;
      return;
    }
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    dropActive = true;
  }
  function dragLeave(event: DragEvent) {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX >= bounds.right ||
      event.clientY < bounds.top ||
      event.clientY >= bounds.bottom
    )
      dropActive = false;
  }
  function dropWorkspace(event: DragEvent) {
    const workspace = draggedWorkspace;
    const scope = drag?.scope;
    const valid = workspace && drag && event.dataTransfer?.getData(CARD_DRAG_TYPE) === drag.token;
    finishDrag();
    event.preventDefault();
    if (!valid || !scope) return;
    event.stopPropagation();
    ontoggleaside?.(workspace, true, scope);
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
          { id: 'waiting', label: m.home_filter_waiting() },
          { id: 'inactive', label: m.home_board_done_idle() },
        ],
  );
  const activeColumns = $derived(
    groups ??
      columns.map((group) => ({
        ...group,
        items: workspaces.filter((workspace) => column(workspace) === group.id),
      })),
  );
  const displayColumns = $derived(
    archived
      ? activeColumns
      : [
          ...activeColumns,
          { id: HOME_SET_ASIDE_GROUP, label: m.home_setAside_action_label(), items: aside },
        ],
  );
</script>

<svelte:window
  ondragend={finishDrag}
  ondrop={finishDrag}
  onblur={finishDrag}
  onkeydown={(event) => {
    if (event.key === 'Escape') finishDrag();
  }}
/>

{#snippet card(workspace: Workspace)}
  {@const pinned = pinnedIds.includes(workspace.id)}
  {@const displayTitle = workspace.title.trim()
    ? workspace.title
    : m.workspace_links_untitled_label()}
  {@const repositoryLabel =
    [showRepositoryOwner ? workspace.repositoryOwner : undefined, workspace.repositoryName]
      .filter(Boolean)
      .join('/') || workspace.repositoryPath}
  <div class="home-board-item" class:home-board-card-dragging={drag?.workspaceId === workspace.id}>
    <Button
      data-home-workspace={workspace.id}
      variant="outline"
      active={selectedId === workspace.id}
      aria-pressed={selectedId === workspace.id}
      wrapContent={false}
      class="h-auto min-w-0 w-full shrink-0 flex-col items-stretch whitespace-normal rounded-xl border-border bg-background gap-0 p-3 text-left shadow-xs"
      draggable={canDrag(workspace)}
      ondragstart={(event) => startDrag(event, workspace)}
      ondragend={finishDrag}
      onpointerdown={() => {
        suppressClick = false;
      }}
      onclick={(event) => {
        if (suppressClick) {
          event.preventDefault();
          return;
        }
        doubleClick.arm(event, workspace.id);
        if (!openHomeWorkspaceFromEvent(event, workspace.id, onopen)) onselect(workspace.id);
      }}
      oncontextmenu={(event) => oncontextmenu?.(event, workspace)}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') suppressClick = false;
        oncontextmenu?.(event, workspace);
        if (!event.defaultPrevented) openHomeWorkspaceFromEvent(event, workspace.id, onopen);
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
                    <span class="truncate" data-home-workspace-repository>{repositoryLabel}</span>
                  </span>{/snippet}</Tooltip.Trigger
              ><Tooltip.Content>{repositoryLabel}</Tooltip.Content></Tooltip.Root
            ></Tooltip.Provider
          >
        {/if}
        {#if workspace.pullRequests?.length || workspace.activePullRequest}
          <HomeWorkspacePullBadge {workspace} />
        {/if}
        <span class="ml-auto shrink-0" data-home-card-time>
          <HomeActivityTime {workspace} />
        </span>
      </span>
    </Button>
    {#if ontoggleaside && !archived && column(workspace) !== 'archived'}
      {@const label = asideIds.has(workspace.id)
        ? m.home_setAside_bringBack_label()
        : m.home_setAside_action_label()}
      <span class="home-aside-control"
        ><Button
          variant="plain"
          size="icon-compact"
          iconOnly
          type="button"
          class="home-aside-action"
          aria-label={label}
          tooltip={label}
          data-home-set-aside-action={workspace.id}
          onclick={() => ontoggleaside(workspace)}
          ><Fa
            icon={asideIds.has(workspace.id) ? faArrowUp : faArrowDown}
            class="size-3.5"
          /></Button
        ></span
      >
    {/if}
  </div>
{/snippet}

<div
  class="min-h-0 min-w-0 flex-1 overflow-auto px-6 pb-5"
  data-home-board
  data-home-dragging={drag?.workspaceId}
  aria-label={m.home_board_view()}
>
  <div
    class="grid w-full content-start grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3"
  >
    {#each displayColumns as group (group.id)}
      {@const items = group.items}
      {@const isAside = group.id === HOME_SET_ASIDE_GROUP}
      <section
        class="flex min-w-0 flex-col self-stretch"
        class:rounded-xl={isAside}
        class:home-board-aside-column={isAside}
        class:home-board-drop-ready={isAside && !!draggedWorkspace}
        class:home-board-drop-active={isAside && dropActive && !!draggedWorkspace}
        aria-label={group.label}
        data-home-set-aside={isAside ? true : undefined}
        data-home-drop-active={isAside && dropActive && draggedWorkspace ? true : undefined}
        ondragenter={isAside ? dragOver : undefined}
        ondragover={isAside ? dragOver : undefined}
        ondragleave={isAside ? dragLeave : undefined}
        ondrop={isAside ? dropWorkspace : undefined}
      >
        <h3
          class="sticky top-0 z-20 flex min-w-0 items-center gap-2 [overflow-wrap:anywhere] bg-background px-2 py-3 type-caption font-medium"
          class:rounded-t-xl={isAside}
          class:text-muted-foreground={isAside}
        >
          {group.label}
        </h3>
        <div class="flex flex-col gap-2 pb-2" data-home-workspace-list>
          {#each items as workspace (workspace.id)}
            {@render card(workspace)}
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
