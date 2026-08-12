<script lang="ts">
  import { goto } from '$app/navigation';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import AugieAvatarWithState from '$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import { getWorkspaceViewTransitionName } from '$lib/components/workspace/workspace-view-transition';
  import {
    closeWorkspaceTab,
    endDrag,
    moveWorkspace,
    openWorkspaceTab,
    startDrag,
  } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    getWorkspaceDragPlacement,
    isWorkspaceStackPlacement,
    type WorkspaceDragPlacement,
  } from '$lib/components/workspace/utils/workspace-drag-placement';
  import {
    selectCurrentWorkspaceTabId,
    selectWorkspaceTabOrder,
    selectWorkspaceViewMode,
  } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { selectWorkspaceTasksByWorkspaceId } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    onActiveTabBoundsChange?: (bounds: { left: number; width: number } | null) => void;
    onActiveTabTrackingChange?: (tracking: boolean) => void;
    activeWorkspaceId?: string | null;
  }

  let { onActiveTabBoundsChange, onActiveTabTrackingChange, activeWorkspaceId }: Props = $props();

  const currentWorkspaceTabId$ = selectCurrentWorkspaceTabId();
  const workspaceTabOrder$ = selectWorkspaceTabOrder();
  const workspaceViewMode$ = selectWorkspaceViewMode();
  const workspaceItems$ = selectWorkspaceItems();
  const workspaceTasksByWorkspaceId$ = selectWorkspaceTasksByWorkspaceId();

  const workspaceById = $derived(
    new Map($workspaceItems$.map((workspace) => [String(workspace.id), workspace])),
  );
  // Persisted tab IDs are available before workspace metadata hydrates. Keep
  // them in the strip so inactive tabs do not disappear during refresh.
  const visibleTabIds = $derived($workspaceTabOrder$);

  let draggedWorkspaceId = $state<string | null>(null);
  let dragOverWorkspaceId = $state<string | null>(null);
  let dragOverPlacement = $state<WorkspaceDragPlacement | null>(null);
  let reorderAnnouncement = $state('');
  let activeStreamsVersion = $state(0);
  const tabButtons = new Map<string, HTMLButtonElement>();
  const ACTIVE_TAB_EDGE_GAP = 2;
  // Active tab bounds drive the parent border mask that hides the sidebar
  // border under the active tab. Svelte's animate:flip moves tabs via CSS
  // transform, which ResizeObserver does not fire on, so during the flip the
  // mask stays put while the tab slides. Poll via rAF for the flip window
  // whenever tab order changes so the mask tracks the moving tab.
  const activeTabBoundsPollers = new Set<() => void>();
  const FLIP_ANIMATION_FRAMES = 14;

  onMount(() => {
    activeStreamsTracker.startPolling();
    return activeStreamsTracker.subscribe(() => activeStreamsVersion++);
  });

  $effect(() => {
    void visibleTabIds;
    if (activeTabBoundsPollers.size === 0) return;
    onActiveTabTrackingChange?.(true);
    let framesLeft = FLIP_ANIMATION_FRAMES;
    let frame: number | null = null;
    let cancelled = false;
    const tick = () => {
      frame = null;
      if (cancelled) return;
      activeTabBoundsPollers.forEach((poll) => poll());
      framesLeft -= 1;
      if (framesLeft > 0) {
        frame = requestAnimationFrame(tick);
      } else {
        onActiveTabTrackingChange?.(false);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      onActiveTabTrackingChange?.(false);
    };
  });

  function handlePreviewOpen(workspaceId: string, open: boolean) {
    if (open) appStore.dispatch(ensureWorkspaceTasksLoaded(workspaceId));
  }

  function getTaskProgress(workspaceId: string) {
    return (
      $workspaceTasksByWorkspaceId$[workspaceId]?.stats ?? {
        total: 0,
        completed: 0,
        inProgress: 0,
      }
    );
  }

  function getRunningAgentIds(workspaceId: string) {
    void activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
  }

  function reportActiveTabBounds(node: HTMLElement, isActive: boolean) {
    let active = isActive;
    let frameId: number | null = null;
    const strip = node.closest('[data-workspace-tab-strip]');

    const report = () => {
      frameId = null;
      if (!active) return;
      if (strip) {
        const tabRect = node.getBoundingClientRect();
        const stripRect = strip.getBoundingClientRect();
        if (tabRect.left < stripRect.left + ACTIVE_TAB_EDGE_GAP) {
          strip.scrollLeft += tabRect.left - stripRect.left - ACTIVE_TAB_EDGE_GAP;
        } else if (tabRect.right > stripRect.right - ACTIVE_TAB_EDGE_GAP) {
          strip.scrollLeft += tabRect.right - stripRect.right + ACTIVE_TAB_EDGE_GAP;
        }
      }
      const titlebar = node.closest('.window-title-bar');
      if (!titlebar) return;
      const tabRect = node.getBoundingClientRect();
      const titlebarRect = titlebar.getBoundingClientRect();
      onActiveTabBoundsChange?.({
        left: tabRect.left - titlebarRect.left,
        width: tabRect.width,
      });
    };

    const scheduleReport = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(report);
    };

    const resizeObserver = new ResizeObserver(scheduleReport);
    resizeObserver.observe(node);
    window.addEventListener('resize', scheduleReport);
    strip?.addEventListener('scroll', scheduleReport);
    activeTabBoundsPollers.add(report);
    scheduleReport();

    return {
      update(nextIsActive: boolean) {
        const wasActive = active;
        active = nextIsActive;
        if (active) scheduleReport();
        else if (wasActive) onActiveTabBoundsChange?.(null);
      },
      destroy() {
        if (frameId !== null) cancelAnimationFrame(frameId);
        activeTabBoundsPollers.delete(report);
        resizeObserver.disconnect();
        window.removeEventListener('resize', scheduleReport);
        strip?.removeEventListener('scroll', scheduleReport);
        if (active) onActiveTabBoundsChange?.(null);
      },
    };
  }

  function registerTabButton(node: HTMLButtonElement, workspaceId: string) {
    tabButtons.set(workspaceId, node);
    return {
      destroy() {
        tabButtons.delete(workspaceId);
      },
    };
  }

  function openWorkspace(workspaceId: string) {
    appStore.dispatch(openWorkspaceTab(workspaceId));
    void goto(`/workspace/${workspaceId}`);
  }

  function closeWorkspace(workspaceId: string, event?: Event) {
    event?.stopPropagation();
    const wasCurrent = $currentWorkspaceTabId$ === workspaceId;
    appStore.dispatch(closeWorkspaceTab(workspaceId));
    if (!wasCurrent) return;

    const nextWorkspaceId = selectCurrentWorkspaceTabId.select(appStore.state);
    void goto(nextWorkspaceId ? `/workspace/${nextWorkspaceId}` : '/workspace/new');
  }

  function moveWorkspaceTab(workspaceId: string, direction: -1 | 1) {
    const currentIndex = visibleTabIds.indexOf(workspaceId);
    const targetIndex = currentIndex + direction;
    const targetId = visibleTabIds[targetIndex];
    if (currentIndex < 0 || !targetId) return;

    appStore.dispatch(moveWorkspace(workspaceId, targetId, direction === -1 ? 'before' : 'after'));
    reorderAnnouncement = m.layout_workspaceTabStrip_reorderAnnouncement({
      name: workspaceById.get(workspaceId)?.title || m.layout_workspaceTabStrip_untitled_label(),
      position: targetIndex + 1,
    });
    requestAnimationFrame(() => tabButtons.get(workspaceId)?.focus());
  }

  function handleTabKeydown(event: KeyboardEvent, workspaceId: string) {
    if (
      event.altKey &&
      event.shiftKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      moveWorkspaceTab(workspaceId, event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (event.key === 'Delete' || (event.key === 'Backspace' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      closeWorkspace(workspaceId, event);
      return;
    }

    const currentIndex = visibleTabIds.indexOf(workspaceId);
    let targetId: string | undefined;
    if (event.key === 'ArrowLeft')
      targetId = visibleTabIds[currentIndex - 1] ?? visibleTabIds.at(-1);
    if (event.key === 'ArrowRight') targetId = visibleTabIds[currentIndex + 1] ?? visibleTabIds[0];
    if (event.key === 'Home') targetId = visibleTabIds[0];
    if (event.key === 'End') targetId = visibleTabIds.at(-1);
    if (!targetId) return;

    event.preventDefault();
    tabButtons.get(targetId)?.focus();
    openWorkspace(targetId);
  }

  function handleDragStart(event: DragEvent, workspaceId: string) {
    draggedWorkspaceId = workspaceId;
    event.dataTransfer?.setData('text/plain', workspaceId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    appStore.dispatch(startDrag());
  }

  function handleDragOver(event: DragEvent, workspaceId: string) {
    if (!draggedWorkspaceId || draggedWorkspaceId === workspaceId) return;
    event.preventDefault();
    const placement = getWorkspaceDragPlacement(
      event.clientX,
      event.clientY,
      (event.currentTarget as HTMLElement).getBoundingClientRect(),
    );
    dragOverWorkspaceId = workspaceId;
    dragOverPlacement = placement;
    if (!isWorkspaceStackPlacement(placement)) {
      appStore.dispatch(moveWorkspace(draggedWorkspaceId, workspaceId, placement));
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDragLeave(event: DragEvent, workspaceId: string) {
    const nextTarget = event.relatedTarget;
    const currentTarget = event.currentTarget as HTMLElement | null;
    if (nextTarget instanceof Node && currentTarget?.contains(nextTarget)) return;
    if (dragOverWorkspaceId === workspaceId) {
      dragOverWorkspaceId = null;
      dragOverPlacement = null;
    }
  }

  function handleDrop(event: DragEvent, workspaceId: string) {
    event.preventDefault();
    const sourceId = draggedWorkspaceId ?? event.dataTransfer?.getData('text/plain');
    if (sourceId && sourceId !== workspaceId && dragOverPlacement) {
      const targetIndex = visibleTabIds.indexOf(workspaceId);
      appStore.dispatch(moveWorkspace(sourceId, workspaceId, dragOverPlacement));
      reorderAnnouncement = m.layout_workspaceTabStrip_reorderAnnouncement({
        name: workspaceById.get(sourceId)?.title || m.layout_workspaceTabStrip_untitled_label(),
        position: targetIndex + 1,
      });
    }
    draggedWorkspaceId = null;
    dragOverWorkspaceId = null;
    dragOverPlacement = null;
    appStore.dispatch(endDrag());
  }

  function handleDragEnd() {
    draggedWorkspaceId = null;
    dragOverWorkspaceId = null;
    dragOverPlacement = null;
    appStore.dispatch(endDrag());
  }
</script>

{#if $workspaceTabOrder$.length > 0}
  <div
    class="flex w-fit min-w-0 max-w-[100%] items-center gap-0.5 overflow-x-auto pl-3 -ml-3 pr-3 -mr-2.5 scrollbar-none"
    aria-label={m.layout_workspaceTabStrip_openSpaces_ariaLabel()}
    role="tablist"
    data-workspace-tab-strip
  >
    {#each $workspaceTabOrder$ as workspaceId (workspaceId)}
      {@const workspace = workspaceById.get(workspaceId)}
      {@const isCurrent =
        workspaceId ===
        (activeWorkspaceId === undefined ? $currentWorkspaceTabId$ : activeWorkspaceId)}
      <div
        class="min-w-0 shrink-0"
        data-workspace-tab-motion={workspaceId}
        animate:flip={{ duration: 180, easing: cubicOut }}
      >
        {#if workspace}
          {@const taskProgress = getTaskProgress(workspaceId)}
          {@const runningAgentIds = getRunningAgentIds(workspaceId)}
          <TooltipRich
            side="bottom"
            align="start"
            delayDuration={500}
            disabled={draggedWorkspaceId !== null}
            showArrow={false}
            maxWidth="18rem"
            class="min-w-0 shrink-0"
            contentClass="border-border/80 bg-popover/98"
            onOpenChange={(open) => handlePreviewOpen(workspaceId, open)}
          >
            {#snippet content()}
              <div class="grid min-w-60 gap-2.5 text-left">
                {#if workspace.statusMessage?.trim() || workspace.initialPrompt?.trim()}
                  <p
                    class="line-clamp-3 leading-4 text-muted-foreground"
                    data-workspace-tab-description
                  >
                    {workspace.statusMessage?.trim() || workspace.initialPrompt?.trim()}
                  </p>
                {/if}
                {#if taskProgress.total > 0}
                  <div
                    class="flex items-center gap-2"
                    aria-label={m.layout_workspaceTabStrip_tasksComplete_ariaLabel({
                      completed: taskProgress.completed,
                      total: taskProgress.total,
                    })}
                    data-workspace-tab-progress
                  >
                    <div class="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        class="h-full bg-success"
                        style:width={`${(taskProgress.completed / taskProgress.total) * 100}%`}
                      ></span>
                      <span
                        class="h-full bg-info"
                        style:width={`${(taskProgress.inProgress / taskProgress.total) * 100}%`}
                      ></span>
                    </div>
                    <span class="shrink-0 tabular-nums text-subtle">
                      {taskProgress.completed}/{taskProgress.total}
                    </span>
                  </div>
                {/if}
                {#if runningAgentIds.length > 0}
                  <div
                    class="flex items-center -space-x-1.5"
                    role="list"
                    aria-label={m.layout_workspaceTabStrip_runningAgents_ariaLabel()}
                  >
                    {#each runningAgentIds.slice(0, 5) as agentId (agentId)}
                      <span
                        role="listitem"
                        aria-label={m.layout_workspaceTabStrip_runningAgent_ariaLabel()}
                      >
                        <AugieAvatarWithState {agentId} size={18} state="running" />
                      </span>
                    {/each}
                    {#if runningAgentIds.length > 5}
                      <span class="pl-2 text-subtle">+{runningAgentIds.length - 5}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            {/snippet}
            <div
              class={cn(
                'group/workspace-tab relative flex h-8 w-40 max-w-[40vw] shrink-0 items-center border transition-[background-color,border-color,box-shadow,opacity,transform] motion-reduce:transition-none',
                isCurrent
                  ? 'rounded-t-md border-border border-b-transparent bg-sidebar text-foreground'
                  : 'rounded-md border-transparent text-muted-foreground hover:bg-sidebar/50 hover:text-foreground',
                draggedWorkspaceId === workspaceId && 'scale-[0.98] opacity-45',
                dragOverWorkspaceId === workspaceId &&
                  isWorkspaceStackPlacement(dragOverPlacement) &&
                  'ring-1 ring-ring/40',
              )}
              data-workspace-tab={workspaceId}
              data-active={isCurrent}
              data-dragging={draggedWorkspaceId === workspaceId}
              data-workspace-drop-placement={dragOverWorkspaceId === workspaceId
                ? dragOverPlacement
                : undefined}
              style:view-transition-name={$workspaceViewMode$ === 'single'
                ? getWorkspaceViewTransitionName(workspaceId)
                : undefined}
              use:reportActiveTabBounds={isCurrent}
              role="presentation"
              draggable={true}
              ondragstart={(event) => handleDragStart(event, workspaceId)}
              ondragover={(event) => handleDragOver(event, workspaceId)}
              ondragleave={(event) => handleDragLeave(event, workspaceId)}
              ondrop={(event) => handleDrop(event, workspaceId)}
              ondragend={handleDragEnd}
            >
              {#if isCurrent}
                <!-- Concave outward flare: extends bg-sidebar below-outside the tab's bottom corners
                     so the active tab appears to flow into the panel below (Chrome-tab style).
                     Uses a 12x12 quarter-arc dropped 2px past the tab bottom so the concave
                     curve terminates on the panel's top border. The right flare's `-12.5px`
                     offset + 1px seam-fill rect compensates for the arc-stroke straddling the
                     right-edge pixel boundary so no gap shows between flare and tab side. -->
                <svg
                  class="pointer-events-none absolute left-[-12px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path d="M 0 12 L 12 12 L 12 0 A 12 12 0 0 1 0 12 Z" fill="currentColor" />
                  <path
                    class="stroke-border"
                    d="M 12 0 A 12 12 0 0 1 0 12"
                    fill="none"
                    stroke-width="1"
                  />
                </svg>
                <svg
                  class="pointer-events-none absolute right-[-12.5px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path d="M 12 12 L 0 12 L 0 0 A 12 12 0 0 0 12 12 Z" fill="currentColor" />
                  <rect x="-1" width="1" height="100%" fill="currentColor" />
                  <path
                    class="stroke-border"
                    d="M 0 0 A 12 12 0 0 0 12 12"
                    fill="none"
                    stroke-width="1"
                  />
                </svg>
              {/if}
              {#if dragOverWorkspaceId === workspaceId && isWorkspaceStackPlacement(dragOverPlacement)}
                <span
                  class={cn(
                    'pointer-events-none absolute inset-x-4 z-10 h-[38%] rounded-sm bg-ring/15 ring-1 ring-inset ring-ring/50 transition-[top,bottom] duration-(--motion-fast)',
                    dragOverPlacement === 'above' ? 'top-0.5' : 'bottom-0.5',
                  )}
                  aria-hidden="true"
                  data-workspace-stack-preview={dragOverPlacement}
                ></span>
              {/if}
              <button
                type="button"
                use:registerTabButton={workspaceId}
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate px-3 text-left text-xs font-medium outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                onclick={() => openWorkspace(workspaceId)}
                onkeydown={(event) => handleTabKeydown(event, workspaceId)}
                role="tab"
                aria-selected={isCurrent}
                aria-current={isCurrent ? 'page' : undefined}
                tabindex={isCurrent ? 0 : -1}
              >
                {#if workspace.activity === 'agent_running'}
                  <span
                    class="size-1.5 shrink-0 rounded-full bg-success"
                    aria-label={m.layout_workspaceTabStrip_agentWorking_ariaLabel()}
                  ></span>
                {/if}
                <span class="truncate"
                  >{workspace.title?.trim() || m.layout_workspaceTabStrip_untitled_label()}</span
                >
              </button>
              <button
                type="button"
                class={cn(
                  'mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-subtle transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  isCurrent ? 'opacity-70' : 'opacity-0 group-hover/workspace-tab:opacity-100',
                )}
                onclick={(event) => closeWorkspace(workspaceId, event)}
                aria-label={m.layout_workspaceTabStrip_close_ariaLabel({
                  name: workspace.title?.trim() || m.layout_workspaceTabStrip_untitled_label(),
                })}
              >
                <Fa icon={faXmark} size="xs" />
              </button>
            </div>
          </TooltipRich>
        {:else}
          <div
            class={cn(
              'group/workspace-tab relative flex h-8 w-40 max-w-[40vw] shrink-0 items-center border transition-[background-color,border-color,box-shadow,opacity,transform] motion-reduce:transition-none',
              isCurrent
                ? 'rounded-t-md border-border border-b-transparent bg-sidebar text-foreground'
                : 'rounded-md border-transparent text-muted-foreground',
            )}
            data-workspace-tab={workspaceId}
            data-workspace-tab-loading="true"
            data-active={isCurrent}
            style:view-transition-name={$workspaceViewMode$ === 'single'
              ? getWorkspaceViewTransitionName(workspaceId)
              : undefined}
            use:reportActiveTabBounds={isCurrent}
            role="presentation"
          >
            {#if isCurrent}
              <svg
                class="pointer-events-none absolute left-[-12px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="M 0 12 L 12 12 L 12 0 A 12 12 0 0 1 0 12 Z" fill="currentColor" />
                <path
                  class="stroke-border"
                  d="M 12 0 A 12 12 0 0 1 0 12"
                  fill="none"
                  stroke-width="1"
                />
              </svg>
              <svg
                class="pointer-events-none absolute right-[-12.5px] -bottom-0.5 size-[12px] overflow-visible text-sidebar"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="M 12 12 L 0 12 L 0 0 A 12 12 0 0 0 12 12 Z" fill="currentColor" />
                <rect x="-1" width="1" height="100%" fill="currentColor" />
                <path
                  class="stroke-border"
                  d="M 0 0 A 12 12 0 0 0 12 12"
                  fill="none"
                  stroke-width="1"
                />
              </svg>
            {/if}
            <button
              type="button"
              use:registerTabButton={workspaceId}
              class="flex min-w-0 flex-1 items-center px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
              onclick={() => openWorkspace(workspaceId)}
              onkeydown={(event) => handleTabKeydown(event, workspaceId)}
              role="tab"
              aria-label={m.layout_workspaceTabStrip_loading_ariaLabel({ workspaceId })}
              aria-selected={isCurrent}
              aria-current={isCurrent ? 'page' : undefined}
              tabindex={isCurrent ? 0 : -1}
            >
              <span
                class="h-2.5 w-24 animate-pulse rounded-full bg-sidebar-foreground/10 motion-reduce:animate-none"
                aria-hidden="true"
              ></span>
            </button>
            <button
              type="button"
              class="mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-subtle opacity-70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onclick={(event) => closeWorkspace(workspaceId, event)}
              aria-label={m.layout_workspaceTabStrip_close_ariaLabel({ name: workspaceId })}
            >
              <Fa icon={faXmark} size="xs" />
            </button>
          </div>
        {/if}
      </div>
    {/each}
    <span class="sr-only" aria-live="polite">{reorderAnnouncement}</span>
  </div>
{/if}
