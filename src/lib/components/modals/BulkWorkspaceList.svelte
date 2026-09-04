<script lang="ts">
  import { onDestroy } from 'svelte';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { workspaceHoverCardIntentSession } from '$lib/components/workspace/utils/workspace-hover-card-intent';
  import { m } from '$shared/paraglide/messages.js';
  import { type Workspace, WorkspaceStatusEnum } from '$shared/types';

  let { workspaces = [] }: { workspaces?: Workspace[] } = $props();

  let hoveredWorkspaceId: Workspace['id'] | null = null;
  let hoverCardWorkspace: Workspace | null = $state(null);
  let hoverCardAnchorElement: HTMLDivElement | null = $state(null);
  let hoverCardOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverCardOpenedFromPointer = false;

  function clearHoverCardOpenTimer() {
    if (hoverCardOpenTimer === null) return;
    clearTimeout(hoverCardOpenTimer);
    hoverCardOpenTimer = null;
  }

  function closeHoverCard() {
    hoverCardWorkspace = null;
    hoverCardAnchorElement = null;
    if (!hoverCardOpenedFromPointer) return;
    hoverCardOpenedFromPointer = false;
    workspaceHoverCardIntentSession.notifyClosed();
  }

  function handleWorkspaceMouseEnter(workspace: Workspace, event: MouseEvent) {
    hoveredWorkspaceId = workspace.id;
    clearHoverCardOpenTimer();
    if (hoverCardWorkspace?.id !== workspace.id) closeHoverCard();
    const anchorElement = event.currentTarget as HTMLDivElement;
    hoverCardOpenTimer = setTimeout(() => {
      hoverCardOpenTimer = null;
      if (hoveredWorkspaceId !== workspace.id) return;
      hoverCardWorkspace = workspace;
      hoverCardAnchorElement = anchorElement;
      if (hoverCardOpenedFromPointer) return;
      hoverCardOpenedFromPointer = true;
      workspaceHoverCardIntentSession.notifyOpened();
    }, workspaceHoverCardIntentSession.currentOpenDelay);
  }

  function handleWorkspaceMouseLeave(workspace: Workspace) {
    if (hoveredWorkspaceId !== workspace.id) return;
    hoveredWorkspaceId = null;
    clearHoverCardOpenTimer();
    closeHoverCard();
  }

  onDestroy(() => {
    clearHoverCardOpenTimer();
    closeHoverCard();
  });
</script>

{#if workspaces.length > 0}
  <div role="list" class="max-h-56 w-full min-w-0 overflow-y-auto" use:scrollFade>
    {#each workspaces as workspace (workspace.id)}
      {@const statusState = resolveWorkspaceStatusState(workspace)}
      {@const statusPresentation = getWorkspaceStatusPresentation(statusState)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="listitem"
        class="flex min-w-0 items-center gap-2.5 py-1.5 text-sm"
        onmouseenter={(event) => handleWorkspaceMouseEnter(workspace, event)}
        onmouseleave={() => handleWorkspaceMouseLeave(workspace)}
        style:anchor-name="--bulk-dialog-workspace-{workspace.id}"
      >
        <span class="shrink-0">
          <WorkspaceStatusIcon status={statusState} size={14} decorative />
          <span class="sr-only">{statusPresentation.accessibleName}</span>
        </span>
        <span class="min-w-0 flex-1 truncate">{workspace.title}</span>
        {#if workspace.status === WorkspaceStatusEnum.Archived}
          <span
            class="shrink-0 rounded bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {m.lib_commandPalette_archivedWorkspace_pill()}
          </span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if hoverCardWorkspace && hoverCardAnchorElement}
  <HoverCard
    anchor="--bulk-dialog-workspace-{hoverCardWorkspace.id}"
    position="right"
    anchorElement={hoverCardAnchorElement}
    class="z-[var(--layer-tooltip)]! w-auto overflow-visible! rounded-lg border-0! bg-background! shadow-none!"
  >
    <WorkspaceHoverCard workspace={hoverCardWorkspace} />
  </HoverCard>
{/if}
