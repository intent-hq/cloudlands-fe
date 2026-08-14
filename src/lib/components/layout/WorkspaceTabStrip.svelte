<script lang="ts">
  import { goto } from '$app/navigation';
  import { faEllipsis, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import {
    formatWorkspaceTabStatusItems,
    formatWorkspaceTabStatusSummary,
    getWorkspaceTabStatusPresentation,
  } from '$lib/components/workspace/utils/workspace-tab-status-presentation';
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
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectWorkspaceTabStatuses } from '$store/renderer/slices/hud/hud-selectors';
  import type { WorkspaceTabStatus } from '$store/renderer/slices/hud/hud-types';
  import { resolveEmptyWindowDestination } from '$features/workspace/utils/empty-window-destination';
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
  const workspaceTabStatuses$ = selectWorkspaceTabStatuses();

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

  function getRunningAgentIds(workspaceId: string) {
    void activeStreamsVersion;
    return activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
  }

  function tabAccessibleLabel(title: string, status?: WorkspaceTabStatus): string {
    if (!status) return title;
    return m.layout_workspaceTabStrip_status_ariaLabel({
      name: title,
      statuses: formatWorkspaceTabStatusSummary(status),
    });
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

  async function openWorkspace(workspaceId: string, restoreFocus = false) {
    appStore.dispatch(openWorkspaceTab(workspaceId));
    await goto(`/workspace/${workspaceId}`);
    if (restoreFocus) requestAnimationFrame(() => tabButtons.get(workspaceId)?.focus());
  }

  function closeWorkspace(workspaceId: string, event?: Event) {
    event?.stopPropagation();
    const wasCurrent = $currentWorkspaceTabId$ === workspaceId;
    appStore.dispatch(closeWorkspaceTab(workspaceId));
    if (!wasCurrent) return;

    const nextWorkspaceId = selectCurrentWorkspaceTabId.select(appStore.state);
    void goto(
      nextWorkspaceId
        ? `/workspace/${nextWorkspaceId}`
        : resolveEmptyWindowDestination(selectWorkspaceItems.select(appStore.state)),
    );
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
    void openWorkspace(targetId, true);
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
          {@const runningAgentIds = getRunningAgentIds(workspaceId)}
          {@const tabStatus = $workspaceTabStatuses$[workspaceId]}
          {@const workspaceTitle =
            workspace.title?.trim() || m.layout_workspaceTabStrip_untitled_label()}
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
            <TooltipRich
              side="bottom"
              align="start"
              delayDuration={500}
              disabled={draggedWorkspaceId !== null}
              showArrow={false}
              maxWidth="none"
              class="absolute -inset-px rounded-[inherit]"
              contentClass="border-0 bg-transparent p-0 shadow-none"
              contentContainerClass="space-y-0! p-0!"
            >
              {#snippet content()}
                <div data-workspace-tab-hover-content={workspaceId}>
                  <WorkspaceHoverCard {workspace} activeAgentIds={runningAgentIds} />
                </div>
              {/snippet}
              <button
                type="button"
                use:registerTabButton={workspaceId}
                class="flex h-full w-full min-w-0 cursor-pointer items-center gap-1 truncate rounded-[inherit] pl-3 pr-1 text-left text-xs font-medium outline-none! active:cursor-grabbing focus-visible:text-foreground forced-colors:focus-visible:text-[HighlightText]"
                onclick={(event) => void openWorkspace(workspaceId, event.detail === 0)}
                onkeydown={(event) => handleTabKeydown(event, workspaceId)}
                role="tab"
                aria-selected={isCurrent}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={tabAccessibleLabel(workspaceTitle, tabStatus)}
                tabindex={isCurrent ? 0 : -1}
                data-workspace-tab-hover-trigger
              >
                <span class="min-w-0 flex-1 truncate" data-workspace-tab-title
                  >{workspaceTitle}</span
                >
                <span
                  class="pointer-events-none ml-auto flex shrink-0 items-center gap-1"
                  data-workspace-tab-controls
                >
                  {#if tabStatus}
                    <span
                      class="pointer-events-none flex h-4 max-w-14 shrink-0 items-center justify-end gap-px overflow-hidden"
                      data-workspace-tab-status-cluster
                    >
                      {#each tabStatus.visibleCategories as item, index (item.category)}
                        {@const presentation = getWorkspaceTabStatusPresentation(item.category)}
                        <span
                          class={cn(
                            'flex size-3 shrink-0 items-center justify-center',
                            index === 0 && 'size-4',
                            presentation.className,
                          )}
                          data-workspace-tab-status={item.category}
                          data-workspace-status-icon={presentation.icon.iconName}
                          data-status-count={item.count}
                          data-status-leading={index === 0}
                          role="img"
                          aria-label={presentation.label}
                          title={presentation.label}
                        >
                          <Fa
                            icon={presentation.icon}
                            class={index === 0 ? 'size-3.5' : 'size-2.5'}
                          />
                        </span>
                      {/each}
                      {#if tabStatus.hiddenCategoryCount > 0}
                        {@const hiddenSummary = formatWorkspaceTabStatusItems(
                          tabStatus.categories.slice(tabStatus.visibleCategories.length),
                        )}
                        <span
                          class="flex size-3 shrink-0 items-center justify-center text-muted-foreground"
                          data-workspace-tab-status-overflow
                          data-status-hidden={tabStatus.hiddenCategoryCount}
                          role="img"
                          aria-label={hiddenSummary}
                          title={hiddenSummary}
                        >
                          <Fa icon={faEllipsis} class="size-2.5" />
                        </span>
                      {/if}
                    </span>
                  {/if}
                  <span class="size-5 shrink-0" data-workspace-tab-close-space aria-hidden="true"
                  ></span>
                </span>
              </button>
            </TooltipRich>
            <button
              type="button"
              class={cn(
                'absolute right-1 z-10 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-subtle outline-none! transition-opacity hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:opacity-100 forced-colors:focus-visible:text-[HighlightText]',
                isCurrent ? 'opacity-70' : 'opacity-0 group-hover/workspace-tab:opacity-100',
              )}
              onclick={(event) => closeWorkspace(workspaceId, event)}
              aria-label={m.layout_workspaceTabStrip_close_ariaLabel({
                name: workspace.title?.trim() || m.layout_workspaceTabStrip_untitled_label(),
              })}
              data-workspace-tab-close
            >
              <Fa icon={faXmark} size="xs" />
            </button>
          </div>
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
              class="absolute -inset-px flex min-w-0 cursor-pointer items-center rounded-[inherit] px-3 pr-8 text-left outline-none! forced-colors:focus-visible:text-[HighlightText]"
              onclick={(event) => void openWorkspace(workspaceId, event.detail === 0)}
              onkeydown={(event) => handleTabKeydown(event, workspaceId)}
              role="tab"
              aria-label={m.layout_workspaceTabStrip_loading_ariaLabel({ workspaceId })}
              aria-selected={isCurrent}
              aria-current={isCurrent ? 'page' : undefined}
              tabindex={isCurrent ? 0 : -1}
              data-workspace-tab-loading-target
            >
              <span
                class="h-2.5 w-24 animate-pulse rounded-full bg-sidebar-foreground/10 motion-reduce:animate-none"
                aria-hidden="true"
                data-workspace-tab-loading-indicator
              ></span>
            </button>
            <button
              type="button"
              class="absolute right-1 z-10 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-subtle opacity-70 outline-none! hover:bg-muted hover:text-foreground focus-visible:text-foreground forced-colors:focus-visible:text-[HighlightText]"
              onclick={(event) => closeWorkspace(workspaceId, event)}
              aria-label={m.layout_workspaceTabStrip_close_ariaLabel({ name: workspaceId })}
              data-workspace-tab-close
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

<style>
  button[data-workspace-tab-hover-trigger]:focus-visible [data-workspace-tab-title] {
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
  }

  button[data-workspace-tab-loading-target]:focus-visible [data-workspace-tab-loading-indicator] {
    background-color: currentColor;
    opacity: 0.45;
  }

  button[data-workspace-tab-close]:focus-visible :global(svg) {
    transform: scale(1.15);
  }
</style>
