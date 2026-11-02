<script lang="ts">
  import AdaptiveDockShell from './AdaptiveDockShell.svelte';
  import type { DockMachineOption } from './dock-machine-types';
  import type {
    DockPlacementSnapshot,
    DockPlacementCommand,
    DockPlacementFailure,
  } from '$shared/dock-placement';
  import { onDestroy, onMount, tick, type Snippet } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';
  import { Button } from '$lib/components/ui/button';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import {
    DOCK_PREVIEW_GAP,
    DOCK_PREVIEW_SHADOW_INSET,
    DOCK_ISLAND_WIDTH,
    DOCK_RAIL_WIDTH,
    DOCK_WINDOW_WIDTH,
    getDockHorizontalLayout,
    getDockPreviewTop,
    type DockPointerRect,
  } from '$shared/dock-layout';
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import {
    createDockPointerRegionController,
    DOCK_EDGE_STRIP_WIDTH_PX,
    isPointerInDockEdgeStrip,
    type DockPointerRegionController,
  } from '$features/hud/utils/dock-pointer-routing';
  import { openDockWorkspace, openDockAssistant } from '$features/hud/dock-navigation';
  import { startDockFeedback, type DockFeedbackRequest } from '$features/hud/dock-feedback';
  import {
    DOCK_HOVER_SCALE_MS,
    DOCK_ITEM_GAP_PX,
    DOCK_ITEM_SLOT_PX,
    DOCK_ITEM_TARGET_PX,
    DOCK_NOTCH_HEIGHT_PX,
    DOCK_PRESS_SCALE_MS,
    DOCK_RAIL_PADDING_PX,
    DOCK_SHELL_CLOSE_MS,
    DOCK_SHELL_OPEN_MS,
    dockItemMotion,
    getDockProximityScale,
  } from '$features/hud/utils/dock-motion';
  import { intersectDockRect, revealDockItem } from '$features/hud/utils/dock-scroll';
  import DockWorkspacePlate from './DockWorkspacePlate.svelte';
  import DockActionMenu from './DockActionMenu.svelte';
  import DockActionFeedback from './DockActionFeedback.svelte';
  import { spring } from '$lib/motion';
  import { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';

  interface Props {
    conversation?: Snippet;
    conversationWorkspaceId?: string | null;
    onOpenConversation?: (workspaceId: string) => void;
    onCloseConversation?: () => void;
    workspaces: DockWorkspaceView[];
    machines?: DockMachineOption[];
    machineId?: string;
    machineSwitching?: string | null;
    machineError?: boolean;
    onMachine?: (id: string) => void;
    placement?: DockPlacementSnapshot;
    onPlacementCommand?: (command: DockPlacementCommand) => void;
    focusRequest?: number;
    placementError?: DockPlacementFailure | boolean | null;
    dragStartResult?: { id: number; token: string | null } | null;
    resizeStartResult?: { id: number; token: string | null } | null;
    onOpenWorkspace?: (workspaceId: string) => void | Promise<void>;
    onOpenHud?: () => void | Promise<void>;
    onOpenAssistant?: () => void | Promise<void>;
    staticData?: boolean;
    onAnnotate?: (request: DockFeedbackRequest) => void | Promise<void>;
    pointerController?: DockPointerRegionController;
    viewportHeight?: number;
  }

  let {
    workspaces,
    machines,
    machineId,
    machineSwitching,
    machineError,
    onMachine,
    placement,
    onPlacementCommand,
    focusRequest,
    placementError,
    dragStartResult,
    resizeStartResult,
    onOpenWorkspace = openDockWorkspace,
    onOpenAssistant = openDockAssistant,
    staticData = false,
    onAnnotate = startDockFeedback,
    pointerController,
    viewportHeight,
    conversation,
    conversationWorkspaceId,
    onOpenConversation,
    onCloseConversation,
  }: Props = $props();

  // The controller owns native window state for this component instance and must not change mid-mount.
  // svelte-ignore state_referenced_locally
  // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous pointer-region state controller, not a domain-data request
  const pointerRegion = pointerController ?? createDockPointerRegionController();
  let rendererWidth = $state(DOCK_WINDOW_WIDTH);
  let shellElement = $state<HTMLDivElement>();
  let collapsedHitStripElement = $state<HTMLDivElement>();
  let railElement = $state<HTMLDivElement>();
  let listElement = $state<HTMLUListElement>();
  let pointerY: number | null = null;
  let previewElement = $state<HTMLDivElement>();
  let windowHeight = $state(typeof window === 'undefined' ? 0 : window.innerHeight);
  const rendererHeight = $derived(viewportHeight ?? windowHeight);
  let reducedMotion = $state(false);
  const layout = $derived(getDockHorizontalLayout(rendererWidth));
  const visibleWorkspaces = $derived(workspaces);
  const assistantId = 'dock:assistant';
  const visibleEntries = $derived([
    { id: assistantId, title: m.dock_assistant_label(), item: null },
    ...visibleWorkspaces.map((item) => ({
      id: String(item.workspace.id),
      title: item.workspace.title?.trim() || m.workspace_links_untitled_label(),
      item,
    })),
  ]);
  const navigationCount = $derived(visibleEntries.length);
  let buttonElements = $state<Record<string, HTMLButtonElement | null>>({});
  let menuOpen = $state(false);
  let menuElement = $state<HTMLDivElement | null>(null);
  let menuTarget = $state<{ id: string; title: string; button: HTMLButtonElement } | null>(null);
  let pendingActionId = $state<string | null>(null);
  let disposed = false;
  let feedbackRegions: DockPointerRect[] = [];
  let actionFeedback = $state<{ message: string; retry?: () => void } | null>(null);
  let previewWorkspaceId = $state<string | null>(null);
  let previewTop = $state(DOCK_PREVIEW_SHADOW_INSET);
  let previewAnchor = $state<HTMLButtonElement | null>(null);
  let previewPositioned = $state(false);
  let railHovered = $state(false);
  let magnificationCenter = $state<number | null>(null);
  let windowFocused = $state(false);
  let focusedWorkspaceId = $state<string | null>(null);
  let hoveredWorkspaceId = $state<string | null>(null);
  let edgeHoveredWorkspaceId = $state<string | null>(null);
  let hoverDismissed = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let previewFrame: number | null = null;
  let pointerFrame: number | null = null;
  let lastPointerMode: 'collapsed' | 'expanded' | null = null;
  let lastPointerRegions: DockPointerRect[] = [];
  let pendingPointerMode: 'collapsed' | 'expanded' = 'collapsed';
  const DOCK_CLOSE_DELAY_MS = spring.fast.settleMs;
  const DOCK_PRESENCE_BUFFER_PX = 4;
  const railItemCount = $derived(Math.max(1, navigationCount));
  const railContentHeight = $derived(
    DOCK_RAIL_PADDING_PX * 2 +
      railItemCount * DOCK_ITEM_TARGET_PX +
      Math.max(0, railItemCount - 1) * DOCK_ITEM_GAP_PX,
  );
  const railViewportHeight = $derived(
    Math.min(railContentHeight, Math.max(0, rendererHeight - 16)),
  );
  const closedShellScaleY = $derived(
    Math.min(1, DOCK_NOTCH_HEIGHT_PX / Math.max(1, railViewportHeight)),
  );

  const railExpanded = $derived(
    menuOpen ||
      pendingActionId !== null ||
      railHovered ||
      windowFocused ||
      focusedWorkspaceId !== null ||
      hoveredWorkspaceId !== null ||
      edgeHoveredWorkspaceId !== null ||
      previewWorkspaceId !== null,
  );

  const previewWorkspace = $derived(
    visibleWorkspaces.find((item) => String(item.workspace.id) === previewWorkspaceId) ?? null,
  );

  function cancelCloseGrace(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
  }

  function cancelClose(): void {
    cancelCloseGrace();
  }

  function cancelPendingPreview(): void {
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    previewFrame = null;
  }

  function elementRegion(element: HTMLElement): DockPointerRect {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function collapsedPointerRegions(): DockPointerRect[] {
    return collapsedHitStripElement ? [elementRegion(collapsedHitStripElement)] : [];
  }

  function expandedPointerRegions(): DockPointerRect[] {
    if (!listElement) return [];
    // The bounded rail is a continuous wheel target, including gaps between icons.
    return [elementRegion(listElement)];
  }

  function pointerRegionsEqual(left: DockPointerRect[], right: DockPointerRect[]): boolean {
    return (
      left.length === right.length &&
      left.every(
        (region, index) =>
          region.x === right[index].x &&
          region.y === right[index].y &&
          region.width === right[index].width &&
          region.height === right[index].height,
      )
    );
  }

  function positionPreview(): void {
    if (!previewElement || !previewAnchor?.isConnected || !shellElement) return;
    const card = previewElement.getBoundingClientRect();
    if (card.height <= 0) return;
    const anchor = previewAnchor.getBoundingClientRect();
    const visibleAnchor = listElement
      ? intersectDockRect(anchor, elementRegion(listElement))
      : anchor;
    if (!visibleAnchor) {
      previewWorkspaceId = null;
      previewPositioned = false;
      return;
    }
    const shell = shellElement.getBoundingClientRect();
    const anchorTop = visibleAnchor.y - shell.top;
    previewTop = getDockPreviewTop({
      itemTop: anchorTop,
      itemHeight: visibleAnchor.height,
      previewHeight: card.height,
      viewportHeight: rendererHeight,
      // Shadow clearance is optional when a scrolled row sits near the viewport edge.
      shadowInset: Math.max(
        0,
        Math.min(
          DOCK_PREVIEW_SHADOW_INSET,
          anchorTop,
          rendererHeight - anchorTop - visibleAnchor.height,
        ),
      ),
    });
    previewPositioned = true;
  }

  function schedulePreviewPosition(): void {
    cancelPendingPreview();
    previewFrame = requestAnimationFrame(() => {
      previewFrame = null;
      positionPreview();
    });
  }

  function schedulePointerRegion(mode: 'collapsed' | 'expanded'): void {
    if (placement) return;
    pendingPointerMode = mode;
    if (pointerFrame !== null) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = null;
      const mode = menuOpen ? 'expanded' : pendingPointerMode;
      const regions = [
        ...(mode === 'expanded' ? expandedPointerRegions() : collapsedPointerRegions()),
        ...(menuOpen && menuElement ? [elementRegion(menuElement)] : []),
        ...feedbackRegions,
      ];
      if (mode === lastPointerMode && pointerRegionsEqual(regions, lastPointerRegions)) return;
      if (mode === 'expanded' || feedbackRegions.length > 0) pointerRegion.activate(regions);
      else pointerRegion.deactivate(regions);
      lastPointerMode = mode;
      lastPointerRegions = regions;
    });
  }

  function closeIfInactive(): void {
    cancelCloseGrace();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (
        railHovered ||
        windowFocused ||
        focusedWorkspaceId ||
        hoveredWorkspaceId ||
        edgeHoveredWorkspaceId ||
        menuOpen ||
        pendingActionId !== null
      )
        return;
      cancelPendingPreview();
      previewWorkspaceId = null;
      magnificationCenter = null;
      schedulePointerRegion('collapsed');
    }, DOCK_CLOSE_DELAY_MS);
  }

  function handlePresencePointerMove(event: PointerEvent): void {
    if (!isHoverPointer(event) || !railElement) return;
    if (!railExpanded && closeTimer === null && !hoverDismissed) return;
    const rail = railElement.getBoundingClientRect();
    const inside =
      event.clientX >= rail.x - DOCK_PRESENCE_BUFFER_PX &&
      event.clientX <= rail.x + rail.width + DOCK_PRESENCE_BUFFER_PX &&
      event.clientY >= rail.y - DOCK_PRESENCE_BUFFER_PX &&
      event.clientY <= rail.y + rail.height + DOCK_PRESENCE_BUFFER_PX;
    if (hoverDismissed) {
      if (!inside) hoverDismissed = false;
      return;
    }
    if (inside) {
      railHovered = true;
      cancelClose();
      schedulePointerRegion('expanded');
      return;
    }
    if (!railHovered && closeTimer !== null) return;
    railHovered = false;
    schedulePointerRegion('collapsed');
    closeIfInactive();
  }

  function isHoverPointer(event: PointerEvent): boolean {
    return !event.pointerType || event.pointerType === 'mouse';
  }

  function showPreview(workspaceId: string, button: HTMLButtonElement): void {
    if (hoverDismissed || menuOpen || pendingActionId !== null) return;
    cancelClose();
    previewAnchor = button;
    if (previewWorkspaceId !== workspaceId) previewPositioned = false;
    previewWorkspaceId = workspaceId;
    schedulePointerRegion('expanded');
    schedulePreviewPosition();
  }

  function clearEdgeHover(): void {
    edgeHoveredWorkspaceId = null;
  }

  function updateMagnification(event: PointerEvent): void {
    if (!isHoverPointer(event)) return;
    pointerY = event.clientY;
    updateMagnificationCenter();
  }
  function updateMagnificationCenter(): void {
    if (!listElement || pointerY === null || navigationCount === 0) return;
    const list = listElement.getBoundingClientRect();
    const center =
      (pointerY - list.y + listElement.scrollTop - DOCK_RAIL_PADDING_PX - DOCK_ITEM_TARGET_PX / 2) /
      DOCK_ITEM_SLOT_PX;
    magnificationCenter = Math.max(0, Math.min(navigationCount - 1, center));
  }
  function scrollList(): void {
    clearEdgeHover();
    if (railHovered) updateMagnificationCenter();
    schedulePreviewPosition();
    schedulePointerRegion(railExpanded ? 'expanded' : 'collapsed');
  }

  function itemScale(index: number): number {
    return reducedMotion ? 1 : getDockProximityScale(index, magnificationCenter);
  }

  function handleEdgePointer(event: PointerEvent): void {
    if (hoverDismissed || !isHoverPointer(event)) return;
    updateMagnification(event);
    if (
      // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous pointer geometry check, not a domain-data request
      !isPointerInDockEdgeStrip(
        event.clientX - (shellElement?.getBoundingClientRect().left ?? 0),
        rendererWidth,
      )
    ) {
      clearEdgeHover();
      return;
    }
    if (!listElement) return;
    const viewport = elementRegion(listElement);
    const entry = visibleEntries.find((candidate) => {
      const button = buttonElements[candidate.id];
      const visible = button ? intersectDockRect(elementRegion(button), viewport) : null;
      return visible && event.clientY >= visible.y && event.clientY < visible.y + visible.height;
    });
    if (!entry) {
      clearEdgeHover();
      return;
    }
    const button = buttonElements[entry.id];
    if (!button) return;
    const workspaceId = entry.id;
    if (edgeHoveredWorkspaceId === workspaceId) return;
    edgeHoveredWorkspaceId = workspaceId;
    showPreview(workspaceId, button);
  }

  function handleKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const entry = visibleEntries[index];
      if (entry) openMenu(event, entry.id, entry.title);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hoverDismissed = true;
      cancelCloseGrace();
      cancelPendingPreview();
      previewWorkspaceId = null;
      previewAnchor = null;
      previewPositioned = false;
      magnificationCenter = null;
      windowFocused = false;
      focusedWorkspaceId = null;
      hoveredWorkspaceId = null;
      railHovered = false;
      clearEdgeHover();
      (event.currentTarget as HTMLButtonElement).blur();
      schedulePointerRegion('collapsed');
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? navigationCount - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + navigationCount) % navigationCount;
    const button = buttonElements[visibleEntries[nextIndex]?.id];
    button?.focus({ preventScroll: true });
    if (button) revealDockItem(button);
  }

  function openMenu(event: MouseEvent | KeyboardEvent, id: string, title: string): void {
    event.preventDefault();
    if (pendingActionId !== null) return;
    menuTarget = { id, title, button: event.currentTarget as HTMLButtonElement };
    cancelPendingPreview();
    previewWorkspaceId = null;
    cancelClose();
    menuOpen = true;
  }

  async function runAction(
    id: string,
    pendingText: string,
    errorText: string,
    action: () => void | Promise<void>,
  ): Promise<void> {
    if (disposed || pendingActionId !== null) return;
    pendingActionId = id;
    menuOpen = false;
    cancelPendingPreview();
    previewWorkspaceId = null;
    magnificationCenter = null;
    actionFeedback = { message: pendingText };
    try {
      await action();
      if (!disposed) actionFeedback = null;
    } catch {
      if (disposed) return;
      actionFeedback = {
        message: errorText,
        retry: () => void runAction(id, pendingText, errorText, action),
      };
    } finally {
      if (!disposed) {
        pendingActionId = null;
        schedulePointerRegion('collapsed');
        closeIfInactive();
      }
    }
  }

  function openWorkspace(workspaceId: string): void {
    void runAction(workspaceId, m.dock_opening_status(), m.dock_openFailed_error(), () =>
      workspaceId === assistantId ? onOpenAssistant() : onOpenWorkspace(workspaceId),
    );
  }

  /** Feedback opens the workspace's conversation and starts annotating there. */
  function startWorkspaceAnnotation(workspaceId: string): void {
    const id = workspaceId === assistantId ? CHIEF_WORKSPACE_ID : workspaceId;
    onOpenConversation?.(id);
    void runAction(workspaceId, m.dock_opening_status(), m.dock_openFailed_error(), () =>
      onAnnotate({ workspaceId: id }),
    );
  }

  $effect(() => {
    const element = menuElement;
    menuOpen;
    navigationCount;
    rendererHeight;
    schedulePointerRegion(railExpanded ? 'expanded' : 'collapsed');
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => schedulePointerRegion('expanded'));
    observer.observe(element);
    return () => observer.disconnect();
  });

  $effect(() => {
    const card = previewElement;
    const anchor = previewAnchor;
    const shell = shellElement;
    const rail = railElement;
    previewWorkspaceId;
    rendererHeight;
    visibleEntries.map((entry) => entry.id).join(',');
    if (!card || !anchor || !shell) return;
    schedulePreviewPosition();
    const observer = new ResizeObserver(schedulePreviewPosition);
    for (const element of [card, anchor, shell, rail]) {
      if (element) observer.observe(element);
    }
    return () => {
      observer.disconnect();
      cancelPendingPreview();
    };
  });

  onMount(() => {
    if (placement) return;
    reducedMotion = prefersReducedMotion();
    const stopMotion = onReducedMotionChange((reduced) => (reducedMotion = reduced));
    const updateWidth = () => {
      rendererWidth = shellElement?.clientWidth || window.innerWidth;
      schedulePointerRegion(railExpanded ? 'expanded' : 'collapsed');
    };
    const handleDockFocusRequest = () => {
      hoverDismissed = false;
      windowFocused = true;
      cancelClose();
      schedulePointerRegion('expanded');
      void tick().then(() => buttonElements[assistantId]?.focus());
    };
    const handleWindowBlur = () => {
      menuOpen = false;
      windowFocused = false;
      focusedWorkspaceId = null;
      hoveredWorkspaceId = null;
      railHovered = false;
      clearEdgeHover();
      closeIfInactive();
    };
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth);
    // eslint-disable-next-line intent/no-component-async-data-fetch -- dock focus listener registration for component-local UI state, not domain data
    const focusListenerId = window.electronAPI?.on?.(
      WINDOW_CHANNELS.FOCUS_DOCK,
      handleDockFocusRequest,
    );

    updateWidth();
    schedulePointerRegion('collapsed');
    if (shellElement) resizeObserver?.observe(shellElement);
    window.addEventListener('resize', updateWidth);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('pointermove', handlePresencePointerMove);

    return () => {
      stopMotion();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateWidth);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('pointermove', handlePresencePointerMove);
      if (focusListenerId) {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- paired native dock focus listener cleanup; no domain data
        window.electronAPI?.offById?.(WINDOW_CHANNELS.FOCUS_DOCK, focusListenerId);
      }
    };
  });

  onDestroy(() => {
    disposed = true;
    cancelClose();
    cancelPendingPreview();
    if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
    pointerRegion.destroy();
  });
</script>

<svelte:window bind:innerHeight={windowHeight} />

{#if placement && onPlacementCommand}
  <AdaptiveDockShell
    {machines}
    {machineId}
    {machineSwitching}
    {machineError}
    {onMachine}
    {conversation}
    {conversationWorkspaceId}
    {onOpenConversation}
    {onCloseConversation}
    {workspaces}
    {staticData}
    {placement}
    {onPlacementCommand}
    {focusRequest}
    {placementError}
    {dragStartResult}
    {resizeStartResult}
    {onOpenWorkspace}
    {onOpenAssistant}
    {pointerController}
  />
{:else}
  <div
    class="dock-shell"
    bind:this={shellElement}
    style:--dock-hover-scale-ms={`${DOCK_HOVER_SCALE_MS}ms`}
    style:--dock-press-scale-ms={`${DOCK_PRESS_SCALE_MS}ms`}
    style:--dock-preview-gap={`${DOCK_PREVIEW_GAP}px`}
    style:--dock-edge-strip-width={`${DOCK_EDGE_STRIP_WIDTH_PX}px`}
    style:--dock-item-target={`${DOCK_ITEM_TARGET_PX}px`}
    style:--dock-item-gap={`${DOCK_ITEM_GAP_PX}px`}
    style:--dock-rail-padding={`${DOCK_RAIL_PADDING_PX}px`}
    style:--dock-shell-open-ms={`${DOCK_SHELL_OPEN_MS}ms`}
    style:--dock-shell-close-ms={`${DOCK_SHELL_CLOSE_MS}ms`}
    data-testid="dock-shell"
  >
    <div class="dock-hit-column" style:width={`${DOCK_RAIL_WIDTH}px`} data-testid="dock-hit-column">
      <div
        class="dock-rail-target"
        role="navigation"
        aria-label={m.dock_workspaces_ariaLabel()}
        aria-busy={pendingActionId !== null}
        style:top={`${rendererHeight / 2}px`}
        style:max-height={`${Math.max(0, rendererHeight - 16)}px`}
        data-expanded={railExpanded}
        data-edge-actionable={edgeHoveredWorkspaceId !== null || undefined}
        onpointerenter={(event) => {
          if (hoverDismissed || !isHoverPointer(event)) return;
          railHovered = true;
          cancelClose();
          schedulePointerRegion('expanded');
          handleEdgePointer(event);
        }}
        onpointermove={handleEdgePointer}
        onpointerleave={(event) => {
          handlePresencePointerMove(event);
          pointerY = null;
          if (!railHovered && focusedWorkspaceId === null) magnificationCenter = null;
          clearEdgeHover();
        }}
        data-testid="dock-rail-target"
      >
        <div
          bind:this={collapsedHitStripElement}
          class="dock-collapsed-hit-strip"
          data-testid="dock-collapsed-hit-strip"
        ></div>
        <div
          bind:this={railElement}
          class="dock-rail"
          style:width={`${DOCK_ISLAND_WIDTH}px`}
          style:height={`${railViewportHeight}px`}
          style:--dock-island-shoulder={`${DOCK_ISLAND_WIDTH / 2}px`}
          style:--dock-closed-scale-y={closedShellScaleY}
          data-testid="dock-rail"
        >
          <div
            class="dock-rail-shell"
            aria-hidden="true"
            data-expanded={railExpanded}
            data-testid="dock-edge-bar"
          >
            <div class="dock-rail-elevation" data-testid="dock-rail-elevation"></div>
          </div>
          <ul
            bind:this={listElement}
            class="dock-list"
            data-dock-scroll
            onscroll={scrollList}
            aria-label={m.dock_workspaces_ariaLabel()}
          >
            {#each visibleEntries as entry, index (entry.id)}
              {@const workspaceId = entry.id}
              {@const title = entry.title}
              {@const scale = itemScale(index)}
              <li
                class="dock-entry"
                in:dockItemMotion={{ phase: 'enter', reducedMotion }}
                out:dockItemMotion={{ phase: 'exit', reducedMotion }}
                data-dock-entry={workspaceId}
                data-dock-scroll-item
                style:z-index={Math.round(scale * 100)}
              >
                <Button
                  bind:ref={
                    () => buttonElements[entry.id] ?? null,
                    (button) => (buttonElements[entry.id] = button)
                  }
                  type="button"
                  variant="plain"
                  class="dock-workspace-button"
                  aria-label={title}
                  aria-haspopup="menu"
                  aria-busy={pendingActionId === workspaceId}
                  aria-disabled={pendingActionId !== null}
                  aria-describedby={entry.item ? `dock-workspace-status-${workspaceId}` : undefined}
                  aria-expanded={menuOpen && menuTarget?.id === workspaceId}
                  data-edge-hovered={edgeHoveredWorkspaceId === workspaceId || undefined}
                  data-dock-scale={`${scale}`}
                  style={`--dock-item-scale: ${scale}`}
                  onpointerenter={(event) => {
                    if (hoverDismissed || !isHoverPointer(event)) return;
                    updateMagnification(event);
                    hoveredWorkspaceId = workspaceId;
                    showPreview(workspaceId, event.currentTarget as HTMLButtonElement);
                  }}
                  onpointerleave={() => {
                    hoveredWorkspaceId = null;
                    closeIfInactive();
                  }}
                  onfocus={(event) => {
                    hoverDismissed = false;
                    revealDockItem(event.currentTarget);
                    focusedWorkspaceId = workspaceId;
                    magnificationCenter = index;
                    showPreview(workspaceId, event.currentTarget as HTMLButtonElement);
                  }}
                  onblur={() => {
                    focusedWorkspaceId = null;
                    if (!railHovered) magnificationCenter = null;
                    closeIfInactive();
                  }}
                  onkeydown={(event) => handleKeydown(event, index)}
                  onclick={() => openWorkspace(workspaceId)}
                  oncontextmenu={(event) => openMenu(event, workspaceId, title)}
                  data-workspace-id={entry.item ? workspaceId : undefined}
                  data-dock-assistant={!entry.item || undefined}
                >
                  <span class="dock-item-visual">
                    <span class="dock-item-reveal" style:--dock-item-index={index}>
                      {#if entry.item}<DockWorkspacePlate item={entry.item} />{:else}<Logo
                          width={16}
                        />{/if}
                    </span>
                  </span>
                </Button>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    </div>

    {#if menuTarget}
      <DockActionMenu
        bind:open={menuOpen}
        bind:ref={menuElement}
        anchor={menuTarget.button}
        title={menuTarget.title}
        isAssistant={menuTarget.id === assistantId}
        onOpenWorkspace={() => menuTarget && openWorkspace(menuTarget.id)}
        onAnnotate={() => menuTarget && startWorkspaceAnnotation(menuTarget.id)}
      />
    {/if}
    <DockActionFeedback
      feedback={actionFeedback}
      onDismiss={() => (actionFeedback = null)}
      onRegionsChange={(regions) => {
        if (disposed) return;
        feedbackRegions = regions;
        schedulePointerRegion(railExpanded ? 'expanded' : 'collapsed');
      }}
    />

    {#if previewWorkspace || previewWorkspaceId === assistantId}
      <div
        bind:this={previewElement}
        id="dock-workspace-preview"
        class="dock-preview"
        role="presentation"
        inert
        style:left={`${layout.preview.x}px`}
        style:width={`${layout.preview.width}px`}
        style:top={`${previewTop}px`}
        style:visibility={previewPositioned ? 'visible' : 'hidden'}
        data-preview-workspace-id={previewWorkspace?.workspace.id ?? assistantId}
        data-testid="dock-preview"
      >
        {#if previewWorkspace}
          <WorkspaceHoverCard
            workspace={previewWorkspace.workspace}
            {staticData}
            loadAgentSessions={false}
          />
        {:else}
          <section
            class="rounded-md bg-background p-4 text-foreground shadow-(--elevation-overlay) ring-1 ring-border"
          >
            <h2 class="type-body font-medium">{m.dock_assistant_label()}</h2>
            <p class="type-caption mt-1 text-muted-foreground">{m.dock_assistant_description()}</p>
          </section>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .dock-shell {
    --dock-island-bg: hsl(var(--background));
    --dock-plate-bg: hsl(var(--background));
    --dock-plate-fg: hsl(var(--foreground));
    position: relative;
    width: 100%;
    height: 100%;
    overflow: clip;
    pointer-events: none;
    color: hsl(var(--foreground));
  }
  .dock-hit-column {
    position: absolute;
    inset: 0 0 0 auto;
    pointer-events: none;
  }
  .dock-rail-target {
    position: absolute;
    right: 0;
    width: 100%;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .dock-rail-shell {
    position: absolute;
    z-index: 0;
    inset: 0 -1px 0 0;
    border-radius: 16px 0 0 16px;
    background: var(--dock-island-bg);
    box-shadow: inset 1px 0 0 hsl(var(--border));
    transform: translateX(calc(100% - var(--dock-edge-strip-width) - 1px))
      scaleY(var(--dock-closed-scale-y));
    transform-origin: right center;
    transition: transform var(--dock-shell-close-ms) var(--spring-moderate-ease);
    pointer-events: none;
  }
  .dock-rail-elevation {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: var(--elevation-overlay);
    opacity: 0;
    transition: opacity var(--dock-shell-close-ms) linear;
    pointer-events: none;
  }
  .dock-rail-shell::before,
  .dock-rail-shell::after {
    position: absolute;
    right: 0;
    width: var(--dock-island-shoulder);
    height: var(--dock-island-shoulder);
    content: '';
    opacity: 1;
  }
  .dock-rail-shell::before {
    top: calc(-1 * var(--dock-island-shoulder));
    background: radial-gradient(
      circle var(--dock-island-shoulder) at 0 0,
      transparent calc(var(--dock-island-shoulder) - 0.75px),
      var(--dock-island-bg) calc(var(--dock-island-shoulder) - 0.25px)
    );
  }
  .dock-rail-shell::after {
    bottom: calc(-1 * var(--dock-island-shoulder));
    background: radial-gradient(
      circle var(--dock-island-shoulder) at 0 100%,
      transparent calc(var(--dock-island-shoulder) - 0.75px),
      var(--dock-island-bg) calc(var(--dock-island-shoulder) - 0.25px)
    );
  }
  .dock-collapsed-hit-strip {
    position: absolute;
    inset: 0 0 0 auto;
    width: 8px;
    cursor: pointer;
    pointer-events: auto;
  }
  .dock-rail {
    position: relative;
    margin-left: auto;
    box-sizing: border-box;
    display: block;
    max-height: inherit;
    padding: 0;
    overflow: visible;
    border-radius: 16px 0 0 16px;
    background: transparent;
    pointer-events: none;
  }
  .dock-rail-target[data-edge-actionable='true'] .dock-rail {
    cursor: pointer;
  }
  .dock-rail-shell[data-expanded='true'] {
    transform: translateX(0) scaleY(1);
    transition-duration: var(--dock-shell-open-ms);
  }
  .dock-rail-shell[data-expanded='true'] .dock-rail-elevation {
    opacity: 1;
    transition-duration: var(--dock-shell-open-ms);
  }
  .dock-rail-target[data-expanded='true'] .dock-collapsed-hit-strip {
    pointer-events: none;
  }
  .dock-rail-target[data-expanded='true'] .dock-rail {
    pointer-events: none;
  }
  .dock-list {
    box-sizing: border-box;
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--dock-item-gap);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
    margin: 0;
    padding: var(--dock-rail-padding) var(--dock-edge-strip-width) var(--dock-rail-padding)
      var(--dock-rail-padding);
    list-style: none;
    pointer-events: none;
  }
  .dock-rail-target[data-expanded='true'] .dock-list {
    pointer-events: auto;
  }
  .dock-entry {
    position: relative;
    flex: none;
    width: var(--dock-item-target);
    display: grid;
    block-size: var(--dock-item-target);
    place-items: center;
  }
  .dock-rail :global(.dock-workspace-button) {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: var(--dock-item-target);
    height: var(--dock-item-target);
    padding: 0;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    cursor: pointer;
    outline: none;
    pointer-events: none;
    transition: none;
  }
  .dock-rail :global(.dock-workspace-button::after) {
    position: absolute;
    top: 0;
    left: 100%;
    width: var(--dock-edge-strip-width);
    height: 100%;
    content: '';
  }
  .dock-item-visual {
    position: relative;
    display: grid;
    width: var(--dock-item-target);
    height: var(--dock-item-target);
    place-items: center;
    transform: scale(var(--dock-item-scale, 1));
    transform-origin: center;
    transition: transform var(--dock-hover-scale-ms) var(--spring-moderate-ease);
    pointer-events: none;
  }
  .dock-item-reveal {
    position: relative;
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    opacity: 0;
    transform: translateX(2px) scale(0.96);
    transform-origin: right center;
    transition:
      transform var(--spring-fast-exit) var(--spring-exit-ease),
      opacity var(--spring-fast-exit) linear;
  }
  .dock-rail-target[data-expanded='true'] .dock-item-reveal {
    opacity: 1;
    transform: translateX(0) scale(1);
    transition-duration: var(--spring-moderate), var(--spring-fast);
  }
  .dock-rail-target[data-expanded='true'] :global(.dock-workspace-button) {
    pointer-events: auto;
  }
  .dock-rail :global(.dock-workspace-button:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: -2px;
  }
  .dock-rail :global(.dock-workspace-button:active .dock-item-visual) {
    transform: scale(calc(var(--dock-item-scale, 1) * 0.96));
    transition-duration: var(--dock-press-scale-ms);
  }
  .dock-preview {
    position: absolute;
    pointer-events: none;
  }
  .dock-preview :global(*) {
    pointer-events: none !important;
  }
  @container style(--motion-reduced: 1) {
    .dock-rail-shell {
      transition: none;
    }
    .dock-rail-elevation,
    .dock-rail-shell::before,
    .dock-rail-shell::after,
    .dock-item-visual,
    .dock-item-reveal,
    .dock-rail-target[data-expanded='true'] .dock-item-reveal {
      transition: none;
    }
    .dock-rail :global(.dock-workspace-button:active .dock-item-visual) {
      transform: scale(var(--dock-item-scale, 1));
    }
    .dock-rail :global(.dock-workspace-button) {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .dock-rail-shell::before,
    .dock-rail-shell::after {
      display: none;
    }
    .dock-rail :global(.dock-workspace-button:focus-visible) {
      outline: 2px solid Highlight;
      outline-offset: -2px;
      box-shadow: none;
    }
  }
</style>
