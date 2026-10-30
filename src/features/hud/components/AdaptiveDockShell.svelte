<script lang="ts">
  import '$lib/styles/dock-tokens.css';
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Logo from '$lib/components/Logo.svelte';
  import { spring } from '$lib/motion';
  import { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';
  import { m } from '$shared/paraglide/messages.js';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import type { DockPointerRect } from '$shared/dock-layout';
  import type { DockPlacementSnapshot, DockPlacementCommand } from '$shared/dock-placement';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import type { DockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
  import { createDockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
  import { openDockWorkspace, openDockAssistant } from '$features/hud/dock-navigation';
  import { dockHeightStep } from '$features/hud/utils/dock-motion';
  import {
    createFrameLoop,
    createGrowGate,
    createRevealTween,
  } from '$features/hud/utils/dock-shell-frames';
  import {
    dockViewportRect,
    getDockHeaderBounds,
    getDockShellLayout,
    dockDragGripCenter,
    type DockDragGesture,
    type DockDragFinish,
  } from './dock-shell-geometry';
  import { useDockConversationPresence } from './dock-conversation-presence.svelte';
  import { useDockConversationResize } from './dock-conversation-resize.svelte';
  import { useDockShellResize } from './dock-shell-resize.svelte';
  import { useDockConversationFocus } from './dock-conversation-focus.svelte';
  import DockCompanionContent from './DockCompanionContent.svelte';
  import DockEdgeConversation from './DockEdgeConversation.svelte';
  import type { DockEdgeOpenOrigin } from '$features/hud/utils/dock-edge-shell';
  import DockUpdateStatus from './DockUpdateStatus.svelte';
  import { dockStatusGroups } from '$features/hud/utils/dock-status-groups';
  import { dockPlacementFailureMessage } from '$features/hud/utils/dock-placement-failure';
  import DockSideEntries from './DockSideEntries.svelte';
  import DockActionFeedback from './DockActionFeedback.svelte';
  import DockShellSilhouette from './DockShellSilhouette.svelte';
  import DockMachineMenu from './DockMachineMenu.svelte';
  import type { DockMachineOption } from './dock-machine-types';

  let {
    workspaces,
    machines,
    machineId = '',
    machineSwitching = null,
    machineError = false,
    onMachine,
    placement,
    onPlacementCommand,
    focusRequest = 0,
    placementError = false,
    dragStartResult,
    resizeStartResult,
    onOpenWorkspace = openDockWorkspace,
    onOpenAssistant = openDockAssistant,
    pointerController,
    staticData = false,
    conversation,
    conversationWorkspaceId = null,
    onOpenConversation,
    onCloseConversation,
  }: {
    workspaces: DockWorkspaceView[];
    machines?: DockMachineOption[];
    machineId?: string;
    machineSwitching?: string | null;
    machineError?: boolean;
    onMachine?: (id: string) => void;
    conversation?: Snippet;
    conversationWorkspaceId?: string | null;
    onOpenConversation?: (workspaceId: string) => void;
    onCloseConversation?: () => void;
    staticData?: boolean;
    placement: DockPlacementSnapshot;
    onPlacementCommand: (command: DockPlacementCommand) => void;
    focusRequest?: number;
    placementError?: Parameters<typeof dockPlacementFailureMessage>[0];
    dragStartResult?: { id: number; token: string | null } | null;
    resizeStartResult?: { id: number; token: string | null } | null;
    onOpenWorkspace?: (id: string) => void | Promise<void>;
    onOpenAssistant?: () => void | Promise<void>;
    pointerController?: DockPointerRegionController;
  } = $props();

  // svelte-ignore state_referenced_locally
  // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous pointer-region state controller, not a domain-data request
  const pointerRegion = pointerController ?? createDockPointerRegionController();
  const assistantId = 'dock:assistant';
  const pinned = $derived(!!conversationWorkspaceId);
  let rootElement = $state<HTMLDivElement>();
  const conversationPresence = useDockConversationPresence(
    () => conversationWorkspaceId,
    () => rootElement,
    () => placement.captureHidden || placement.phase === 'dragging',
    () => conversationResize.held,
    () => !edge,
  );
  const conversationVisible = $derived(pinned && conversationPresence.open);

  let conversationRegions: DockPointerRect[] = [];
  let edgeState = $state({ held: false, reveal: 0, shell: null as DockPointerRect | null });
  /**
   * The clicked side entry, kept in terms that survive the window growing around the
   * box: its hover card in screen DIP (the box grows from it and returns to it) and its
   * centre as an offset from the rail's top (main anchors the box there). Cleared once
   * the box has closed.
   */
  let edgeOrigin = $state<{
    workspaceId: string;
    card: DockPointerRect;
    radius: number;
    anchor: number;
  } | null>(null);
  /** The same origin in the current window-local space. */
  const edgeCardOrigin = $derived<DockEdgeOpenOrigin | null>(
    edgeOrigin && {
      workspaceId: edgeOrigin.workspaceId,
      radius: edgeOrigin.radius,
      card: {
        ...edgeOrigin.card,
        x: edgeOrigin.card.x - placement.windowBounds.x,
        y: edgeOrigin.card.y - placement.windowBounds.y,
      },
      entryCentre: placement.surface.y + edgeOrigin.anchor,
    },
  );
  let conversationPopupOpen = false;
  let machineMenuOpen = $state(false);
  let machineRegions: DockPointerRect[] = [];
  let popupEscapeEvent: KeyboardEvent | null = null;
  const dragging = $derived(placement.phase === 'dragging');
  const side = $derived(placement.placement.kind === 'edge' ? placement.placement.side : null);
  const notch = $derived(placement.shape === 'notch' && !dragging);
  const edge = $derived(placement.shape === 'edge' && !dragging);
  const floating = $derived(placement.shape === 'floating' && !dragging);
  const floatingUp = $derived(floating && placement.expansionDirection === 'up');
  let expandedByUser = $state(false);
  let composerAsk = $state({ open: null as string | null, request: 0 });
  let surfaceElement = $state<HTMLElement>();
  let gripElement = $state<HTMLButtonElement | null>(null);
  let pending = $state(false);
  let feedback = $state<{ message: string; retry?: () => void } | null>(null);
  let feedbackRegions: DockPointerRect[] = [];
  let placementErrorDismissed = $state(false);
  const actionFeedback = $derived(
    feedback ??
      (placementError && !placementErrorDismissed
        ? { message: dockPlacementFailureMessage(placementError), retry: resetPlacement }
        : null),
  );
  $effect(() => {
    if (!placementError) placementErrorDismissed = false;
  });
  let reducedMotion = $state(false);
  let keyboardOpen = $state(false);
  let lastUserInput = Number.NEGATIVE_INFINITY;
  let pointerInside = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let measureFrame: number | undefined;
  let dragFrame: number | undefined;
  let dragGripCenter = $state({ x: 26, y: 20 });
  const heldGripCenter = $derived(dragging ? dragGripCenter : null);
  let surfaceExpanded = $state(false);
  let contentVisible = $state(false);
  let reveal = $state(0);
  const shellTween = createRevealTween(
    () => reveal,
    (value) => (reveal = value),
  );
  let openHeight = $state<number | null>(null);
  let heldHeight = $state<number | null>(null);
  const heightLoop = createFrameLoop();
  let heightTarget = 0;
  const growGate = createGrowGate((from, to) => !disposed && morphHeight(openHeight ?? from, to));
  let disposed = false;
  let sequence = 0;
  let gesture = $state<DockDragGesture | null>(null);
  let awaitingDragStart = $state<number | null>(null);
  let activeDragToken = $state<string | null>(null);
  let finishDrag = $state<DockDragFinish | null>(null);
  let suppressClick = false;
  let captureElement: HTMLElement | null = null;
  let sidePreviewOpen = $state(false);
  let sideCloseRequest = $state(0);
  let sideRegions: DockPointerRect[] = [];
  const expanded = $derived(
    !edge &&
      !dragging &&
      (machineMenuOpen ||
        (pinned ? conversationVisible : expandedByUser || (!floating && pending))),
  );
  const statusGroups = $derived(dockStatusGroups(workspaces));
  const compactWingWidth = $derived(
    12 + statusGroups.length * 12 + 6 * Math.max(0, statusGroups.length - 1) + 4,
  );
  const rowLimit = 5;
  const conversationResize = useDockConversationResize(
    () => placement,
    () => pinned,
    () => layout.headerHeight,
    () => resizeStartResult,
    (value) => onPlacementCommand(value),
  );
  const layout = $derived(
    getDockShellLayout(placement, {
      surfaceExpanded,
      conversationOpen: pinned,
      conversationSize: conversationResize.size,
      reveal,
      expandedHeight: openHeight,
      rowLimit,
      workspaceCount: machineMenuOpen
        ? Math.max(workspaces.length, Math.min(machines?.length ?? 0, 5))
        : workspaces.length,
      compactWingWidth,
      hasFeedback: actionFeedback !== null,
    }),
  );
  const headerHeight = $derived(layout.headerHeight);
  const railHeight = $derived(layout.railHeight);
  const desiredWidth = $derived(layout.desiredWidth);
  const desiredHeight = $derived(layout.desiredHeight);
  const compactWidth = $derived(layout.compactWidth);
  const compactHeight = $derived(layout.compactHeight);
  const railOffset = $derived(layout.railOffset);
  const floatingCompact = $derived(layout.floatingCompact);
  const shown = $derived(layout.shown);
  const contentClip = $derived(layout.contentClip);
  const cameraLeft = $derived(placement.cutout ? placement.cutout.x - placement.surface.x : 0);
  const cameraWidth = $derived(placement.cutout?.width ?? 0);
  const inlineClip = $derived.by(() => {
    const visible = shown;
    const surface = placement.surface;
    return () => dockViewportRect(visible, surface, surfaceElement?.getBoundingClientRect());
  });
  const headerWingLeft = $derived(shown.x + 6);
  const headerWingRight = $derived(placement.surface.width - shown.x - shown.width + 12);

  function stopHeight(): void {
    growGate.cancel();
    heightLoop.cancel();
    heldHeight = null;
    openHeight = null;
  }

  function morphHeight(from: number, to: number): void {
    heldHeight = to < from ? Math.max(heldHeight ?? 0, placement.surface.height) : null;
    openHeight = from;
    heightLoop.start((elapsed) => {
      const step = dockHeightStep(from, to, elapsed);
      openHeight = step.value;
      if (!step.done) return false;
      heldHeight = null;
      if (placement.surface.height <= to + 0.5) openHeight = null;
      return true;
    });
  }

  function sendDragEnd(token: string, finish: DockDragFinish): void {
    command({
      action: finish.action,
      token,
      sequence: ++sequence,
      ...(finish.action === 'end-drag'
        ? { releasePoint: { x: finish.releasePoint.x, y: finish.releasePoint.y } }
        : {}),
    });
  }
  $effect(() => {
    const wantOpen = expanded;
    const moving = dragging;
    const instant = reducedMotion || keyboardOpen;
    const room = placement.surface.width > compactWidth || placement.surface.height > compactHeight;
    untrack(() => {
      if (moving) {
        shellTween.animate(0, true);
        contentVisible = false;
        surfaceExpanded = false;
        return;
      }
      if (wantOpen) {
        surfaceExpanded = true;
        if (room) {
          contentVisible = true;
          shellTween.animate(1, instant);
        }
      } else {
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          focused.closest('.overview-frame') &&
          surfaceElement?.contains(focused)
        )
          focused.blur();
        shellTween.animate(0, instant);
      }
    });
  });

  function command(value: DockPlacementCommand): void {
    if (!placement.captureHidden) onPlacementCommand(value);
  }

  function publishRegions(): void {
    if (disposed || !surfaceElement || placement.captureHidden) return;
    const rail = { ...shown, x: placement.surface.x + shown.x, y: placement.surface.y + shown.y };
    pointerRegion.activate(
      [
        rail,
        ...sideRegions,
        ...(edgeState.shell && !dragging ? [edgeState.shell] : []),
        ...(conversationVisible && !dragging ? conversationRegions : []),
        ...feedbackRegions,
        ...machineRegions,
      ],
      placement.revision,
    );
  }
  $effect(() => {
    if (placement.captureHidden || dragging) machineMenuOpen = false;
  });
  $effect(() => {
    if (machineError)
      untrack(() => {
        if (machines && !placement.captureHidden && !dragging) machineMenuOpen = true;
      });
  });
  function measure(): void {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined;
      publishRegions();
    });
  }

  function conversationRegionsChanged(regions: DockPointerRect[]): void {
    conversationRegions = regions;
    measure();
  }

  $effect(() => {
    const target = desiredHeight;
    const settled = expanded && surfaceExpanded && reveal === 1;
    const immediate =
      reducedMotion ||
      keyboardOpen ||
      dragging ||
      placement.captureHidden ||
      conversationResize.held ||
      conversationResize.busy;
    untrack(() => {
      const previous = heightTarget;
      heightTarget = target;
      if (immediate) {
        if (openHeight !== null || heldHeight !== null) stopHeight();
        return;
      }
      if (previous === target || previous === 0) return;
      if (!settled) {
        stopHeight();
        return;
      }
      const from = openHeight ?? placement.surface.height;
      if (target > from && placement.surface.height < target - 0.5) {
        heightLoop.cancel();
        openHeight = from;
        growGate.hold(from, target);
        return;
      }
      growGate.cancel();
      morphHeight(from, target);
    });
  });

  $effect(() => {
    placement.surface.height;
    untrack(() => {
      if (growGate.pending) growGate.release(placement.surface.height);
      else if (!heightLoop.active && heldHeight === null && openHeight !== null) openHeight = null;
    });
  });

  useDockShellResize(
    () => ({
      placement,
      width: desiredWidth,
      height: heldHeight === null ? desiredHeight : Math.max(desiredHeight, heldHeight),
      railHeight,
      compactWingWidth,
      conversationVisible: conversationVisible || edgeState.held,
      conversationSize: conversationResize.size,
      sidePanelAnchor: edgeOrigin?.anchor ?? null,
      expansionDirection: conversationResize.direction,
      resizeToken: conversationResize.token,
    }),
    command,
  );

  $effect(() => {
    placement.revision;
    const surface = surfaceElement;
    measure();
    if (!surface) return;
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  });

  $effect(() => {
    shown;
    placement.revision;
    untrack(publishRegions);
  });

  $effect(() => {
    const result = dragStartResult;
    const awaiting = awaitingDragStart;
    if (!result || awaiting === null || result.id <= awaiting) return;
    untrack(() => {
      awaitingDragStart = null;
      const finish = finishDrag;
      finishDrag = null;
      if (!result.token) {
        releaseGesture();
        activeDragToken = null;
        return;
      }
      if (finish || !gesture || disposed || placement.captureHidden) {
        sendDragEnd(
          result.token,
          disposed || placement.captureHidden
            ? { action: 'cancel-drag' }
            : (finish ?? { action: 'cancel-drag' }),
        );
      } else {
        activeDragToken = result.token;
      }
    });
  });

  $effect(() => {
    if (placement.phase === 'idle' && activeDragToken && awaitingDragStart === null) {
      untrack(() => {
        activeDragToken = null;
        releaseGesture();
      });
    }
  });

  $effect(() => {
    if (placement.captureHidden) {
      untrack(() => {
        pointerInside = false;
        pointerEnd(true);
        shellTween.animate(0, true);
        contentVisible = false;
        surfaceExpanded = false;
      });
      expandedByUser = false;
      pointerRegion.deactivate([], placement.revision);
    }
  });

  $effect(() => {
    if ((reveal === 0 && !edge) || dragging || placement.captureHidden) composerAsk.open = null;
  });

  const conversationFocus = useDockConversationFocus({
    get workspaceId() {
      return conversationWorkspaceId;
    },
    get request() {
      return focusRequest;
    },
    get contentVisible() {
      return contentVisible;
    },
    get keyboardOpen() {
      return keyboardOpen;
    },
    get expanded() {
      return expanded;
    },
    get hidden() {
      return placement.captureHidden;
    },
    get root() {
      return rootElement;
    },
    get surface() {
      return surfaceElement;
    },
    get grip() {
      return gripElement;
    },
    openKeyboard(returning = false) {
      conversationPresence.show(!returning);
      expandedByUser = true;
      keyboardOpen = !returning;
    },
    pointerOutside: leave,
  });

  function enter(): void {
    pointerInside = true;
    clearTimeout(closeTimer);
    if (pinned && !dragging && !gesture?.started) keyboardOpen = false;
    if (edge || expanded || dragging || gesture?.started || awaitingDragStart !== null) return;
    keyboardOpen = false;
    clearTimeout(openTimer);
    if (surfaceExpanded) expandedByUser = true;
    else
      openTimer = setTimeout(() => {
        expandedByUser = true;
      }, spring.fast.settleMs);
  }

  function leave(event?: PointerEvent | FocusEvent): void {
    if (event instanceof PointerEvent) {
      pointerInside = false;
      conversationFocus.pointerLeave(event);
    }
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (
      event instanceof FocusEvent &&
      event.relatedTarget instanceof Node &&
      surfaceElement?.contains(event.relatedTarget)
    )
      return;
    const close = () => {
      if (!conversationFocus.keepsOverviewOpen(pointerInside, keyboardOpen)) {
        expandedByUser = false;
      }
    };
    if (event instanceof FocusEvent && keyboardOpen) closeTimer = setTimeout(close, 0);
    else closeTimer = setTimeout(close, spring.moderate.settleMs);
  }

  function resetPlacement(): void {
    stopHeight();
    expandedByUser = false;
    contentVisible = false;
    surfaceExpanded = false;
    reveal = 0;
    command({ action: 'move', target: 'reset' });
    void tick().then(() => gripElement?.focus({ preventScroll: true }));
  }

  function dismiss(): void {
    if (placement.captureHidden) return;
    pointerInside = false;
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    dragFrame = measureFrame = undefined;
    shellTween.cancel();
    stopHeight();
    pointerEnd(true);
    expandedByUser = false;
    keyboardOpen = false;
    contentVisible = false;
    feedback = null;
    (document.activeElement as HTMLElement | null)?.blur();
    clearTimeout(closeTimer);
    pointerRegion.deactivate([], placement.revision);
    command({ action: 'dismiss' });
  }

  async function runAction(
    action: () => void | Promise<void>,
    starting: string,
    failure: string,
  ): Promise<void> {
    if (pending || disposed) return;
    pending = true;
    feedback = { message: starting };
    try {
      await action();
      if (!disposed) feedback = null;
    } catch {
      if (!disposed)
        feedback = { message: failure, retry: () => void runAction(action, starting, failure) };
    } finally {
      if (!disposed) pending = false;
    }
  }
  function openWorkspace(id: string): void {
    if (onOpenConversation) {
      command({ action: 'focus' });
      const workspaceId = id === assistantId ? CHIEF_WORKSPACE_ID : id;
      if (notch || edge) composerAsk.open = workspaceId;
      if (edge) composerAsk.request += 1;
      conversationPresence.show();
      onOpenConversation(workspaceId);
      return;
    }
    void runAction(
      () => (id === assistantId ? onOpenAssistant() : onOpenWorkspace(id)),
      m.dock_opening_status(),
      m.dock_openFailed_error(),
    );
  }

  function pointerDown(event: PointerEvent): void {
    if (
      machineSwitching !== null ||
      event.button !== 0 ||
      !event.isPrimary ||
      gesture ||
      awaitingDragStart !== null ||
      conversationResize.busy ||
      dragging ||
      placement.captureHidden
    )
      return;
    const gripBounds = gripElement?.getBoundingClientRect();
    const surfaceBounds = surfaceElement?.getBoundingClientRect();
    const visibleHeader = getDockHeaderBounds(placement, shown, floatingCompact, headerHeight);
    dragGripCenter = dockDragGripCenter(
      gripBounds,
      surfaceBounds,
      placement.surface,
      visibleHeader,
      dragGripCenter,
    );
    gesture = {
      pointerId: event.pointerId,
      x: event.screenX,
      y: event.screenY,
      revision: placement.revision,
      headerBounds: getDockHeaderBounds(placement, shown, floatingCompact, headerHeight),
      origin: {
        x: event.screenX - placement.windowBounds.x - placement.surface.x,
        y: event.screenY - placement.windowBounds.y - placement.surface.y,
      },
      started: false,
    };
    finishDrag = null;
    activeDragToken = null;
    suppressClick = false;
    captureElement = event.currentTarget as HTMLElement;
    captureElement.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.started) {
      if (Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) < 6) return;
      gesture.started = true;
      awaitingDragStart = dragStartResult?.id ?? 0;
      suppressClick = true;
      expandedByUser = false;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      command({
        action: 'begin-drag',
        revision: gesture.revision,
        origin: { x: gesture.origin.x, y: gesture.origin.y },
        headerBounds: { ...gesture.headerBounds },
      });
    }
    if (!activeDragToken || dragFrame !== undefined) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined;
      if (activeDragToken && gesture?.started)
        command({ action: 'drag', token: activeDragToken, sequence: ++sequence });
    });
  }
  function releaseGesture(): void {
    const pointerId = gesture?.pointerId;
    gesture = null;
    if (pointerId !== undefined && captureElement?.hasPointerCapture(pointerId))
      captureElement.releasePointerCapture(pointerId);
    captureElement = null;
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  }
  function pointerEnd(cancelled = false, event?: PointerEvent): void {
    if (event && event.pointerId !== gesture?.pointerId) return;
    const finish: DockDragFinish =
      cancelled || !event
        ? { action: 'cancel-drag' }
        : { action: 'end-drag', releasePoint: { x: event.screenX, y: event.screenY } };
    if (awaitingDragStart !== null) {
      // Preserve a normal release and its endpoint while the bridge acknowledges startup.
      finishDrag = finish;
    } else if (activeDragToken) {
      sendDragEnd(activeDragToken, finish);
      activeDragToken = null;
    }
    releaseGesture();
  }
  function keydown(event: KeyboardEvent): void {
    if (
      event.key !== 'Escape' ||
      event.isComposing ||
      placement.captureHidden ||
      event.defaultPrevented
    )
      return;
    if (gesture || awaitingDragStart !== null || dragging) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (gesture || awaitingDragStart !== null || activeDragToken) pointerEnd(true);
      else if (placement.dragToken) {
        command({ action: 'cancel-drag', token: placement.dragToken, sequence: ++sequence });
      }
      return;
    }
    if (event === popupEscapeEvent) return;
    if (machineMenuOpen) {
      machineMenuOpen = false;
      event.preventDefault();
      gripElement?.focus({ preventScroll: true });
      return;
    }
    event.preventDefault();
    if (pinned) {
      onCloseConversation?.();
      return;
    }
    if (edge && sidePreviewOpen) {
      sideCloseRequest += 1;
      return;
    }
    dismiss();
  }

  onMount(() => {
    reducedMotion = prefersReducedMotion();
    const stopMotion = onReducedMotionChange((value) => {
      reducedMotion = value;
    });
    return stopMotion;
  });
  onDestroy(() => {
    disposed = true;
    growGate.cancel();
    pointerEnd(true);
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
    shellTween.cancel();
    heightLoop.cancel();
    if (placement.dragToken)
      onPlacementCommand({
        action: 'cancel-drag',
        token: placement.dragToken,
        sequence: ++sequence,
      });
    pointerRegion.destroy();
  });
</script>

{#if machineMenuOpen && machines && onMachine && gripElement && (edge || contentVisible)}
  <DockMachineMenu
    bind:open={machineMenuOpen}
    anchor={gripElement}
    {machines}
    currentId={machineId}
    pending={machineSwitching}
    error={machineError}
    onSwitch={onMachine}
    side={edge ? (side === 'left' ? 'right' : 'left') : floatingUp ? 'top' : 'bottom'}
    onRegionsChange={(regions) => {
      machineRegions = regions;
      measure();
    }}
  />
{/if}

<svelte:window
  onpointerdowncapture={() => {
    lastUserInput = performance.now();
  }}
  onkeydowncapture={(event) => {
    lastUserInput = performance.now();
    if (gesture || awaitingDragStart !== null || dragging) keydown(event);
    else if (
      machineMenuOpen &&
      event.key === 'Escape' &&
      !event.isComposing &&
      !placement.captureHidden &&
      !event.defaultPrevented
    ) {
      machineMenuOpen = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      gripElement?.focus({ preventScroll: true });
    } else if (event.key === 'Escape' && conversationPopupOpen) popupEscapeEvent = event;
  }}
  onkeydown={keydown}
  onblur={() => {
    pointerInside = false;
    pointerEnd(true);
    expandedByUser = false;
  }}
/>

<div
  bind:this={rootElement}
  class="adaptive-dock"
  data-testid="dock-shell"
  data-placement={placement.shape}
  data-side={side}
  data-expanded={expanded}
  data-dragging={dragging}
  data-revision={placement.revision}
  data-reveal={reveal}
>
  {#if !placement.captureHidden}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section
      bind:this={surfaceElement}
      class="companion"
      class:notch
      class:top-pill={placement.shape === 'top-pill' && !dragging}
      class:edge
      class:floating
      class:floating-up={floatingUp}
      class:dragging
      class:gesture-held={gesture !== null || dragging}
      class:grip-pressed={gesture !== null && !dragging}
      data-expansion-direction={floating ? (placement.expansionDirection ?? 'down') : undefined}
      data-dock-surface={notch || dragging ? 'notch' : 'detached'}
      data-expanded={expanded || reveal > 0}
      class:expanded
      class:keyboard-open={keyboardOpen}
      class:reduced-motion={reducedMotion}
      style:left={`${placement.surface.x}px`}
      style:top={`${placement.surface.y}px`}
      style:width={`${placement.surface.width}px`}
      style:height={`${placement.surface.height}px`}
      style:--rail-offset={`${railOffset}px`}
      style:--header-height={`${headerHeight}px`}
      style:--floating-header-x={`${shown.x}px`}
      style:--floating-header-y={`${floatingCompact.y}px`}
      style:--floating-header-width={`${shown.width}px`}
      style:--header-wing-left={`${headerWingLeft}px`}
      style:--header-wing-right={`${headerWingRight}px`}
      style:--camera-left={`${cameraLeft}px`}
      style:--camera-width={`${cameraWidth}px`}
      style:--grip-press-duration={`${gesture ? spring.fast.settleMs : spring.fast.exit.duration}ms`}
      onpointerdowncapture={() => {
        keyboardOpen = false;
      }}
      onpointerenter={enter}
      onpointerleave={leave}
      onfocusin={(event) => {
        if (gesture !== null || awaitingDragStart !== null || dragging) return;
        if (performance.now() - lastUserInput > 1000) return;
        expandedByUser = true;
        const target = event.target as HTMLElement;
        // Text entry always matches :focus-visible, including after a click; typing in
        // a workspace conversation is not a keyboard disclosure and keeps motion.
        if (
          !conversationFocus.returning &&
          !target.isContentEditable &&
          !target.matches('input, textarea, select') &&
          target.matches(':focus-visible')
        )
          keyboardOpen = true;
      }}
      onfocusout={leave}
      aria-label={m.dock_workspaces_ariaLabel()}
      data-testid="dock-surface"
    >
      <DockShellSilhouette {placement} {shown} />
      <div
        class="companion-content"
        style:clip-path={contentClip}
        inert={machineSwitching !== null}
      >
        <!-- Pointer drag surface; its click shortcut to the field has keyboard parity via Tab. -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <header
          class="companion-header"
          class:side-header={edge}
          style:padding-left={heldGripCenter ? `${heldGripCenter.x - 14}px` : undefined}
          style:padding-top={heldGripCenter ? `${heldGripCenter.y - 14}px` : undefined}
          style:padding-bottom={heldGripCenter ? `${26 - heldGripCenter.y}px` : undefined}
          onpointerdown={(event) => {
            if (!(event.target as HTMLElement).closest('button')) pointerDown(event);
          }}
          onclick={(event) => {
            // Clicking the notch itself (not a drag, menu or status control) is the
            // user's request to type into the pinned conversation.
            const control = (event.target as HTMLElement).closest('button');
            const grip = !!control && control === gripElement;
            if (event.defaultPrevented || suppressClick || (control && !grip)) {
              if (!control) suppressClick = false;
              return;
            }
            if (notch && pinned && !(grip && machines && onMachine)) composerAsk.request += 1;
          }}
          onpointermove={pointerMove}
          onpointerup={(event) => pointerEnd(false, event)}
          onpointercancel={() => pointerEnd(true)}
          onlostpointercapture={() => {
            if (gesture) pointerEnd(true);
          }}
        >
          <Button
            bind:ref={gripElement}
            variant="ghost"
            size="icon-sm"
            class="dock-grip"
            aria-label={machines ? m.dock_machineSwitch_label() : m.dock_drag_label()}
            aria-haspopup={machines ? 'menu' : undefined}
            aria-expanded={machines ? machineMenuOpen : undefined}
            title={machines ? m.dock_machineMenu_hint() : m.dock_drag_label()}
            data-testid="dock-drag-handle"
            wrapContent={false}
            onpointerdown={pointerDown}
            onpointermove={pointerMove}
            onpointerup={(event) => pointerEnd(false, event)}
            onpointercancel={() => pointerEnd(true)}
            onlostpointercapture={() => {
              if (gesture) pointerEnd(true);
            }}
            onclick={(event) => {
              if (suppressClick) {
                event.preventDefault();
                suppressClick = false;
                return;
              }
              if (machines && onMachine) {
                machineMenuOpen = !machineMenuOpen;
                return;
              }
              if (!edge) expandedByUser = floating ? true : !expandedByUser;
            }}
          >
            <span class="grip-mark"><Logo width={16} /></span>
          </Button>
          {#if !edge}
            <div class="header-state" style:opacity={dragging ? 0 : 1}>
              <DockUpdateStatus groups={statusGroups} />
            </div>
          {/if}
        </header>
        {#if notch && placement.cutout}
          <div
            class="camera-exclusion"
            data-testid="dock-camera-exclusion"
            aria-hidden="true"
            style:left={`${cameraLeft}px`}
            style:width={`${cameraWidth}px`}
            style:height={`${placement.cutout.height}px`}
          ></div>
        {/if}
        {#if contentVisible && !edge}
          <DockCompanionContent
            {workspaces}
            {pending}
            {expanded}
            {reveal}
            {floating}
            {floatingUp}
            settling={openHeight !== null}
            clip={inlineClip}
            {conversation}
            {conversationWorkspaceId}
            focusRequest={focusRequest + composerAsk.request}
            focusComposerOnMount={notch && composerAsk.open === conversationWorkspaceId}
            onOpen={openWorkspace}
            onRegionsChange={conversationRegionsChanged}
            onPopupStateChange={(open) => (conversationPopupOpen = open)}
          />
        {/if}
      </div>
    </section>
  {/if}
  {#if edge && side && !dragging && !placement.captureHidden}
    <DockSideEntries
      {workspaces}
      railHeight={shown.height}
      {side}
      railX={placement.surface.x + shown.x}
      railY={placement.surface.y + shown.y}
      windowWidth={placement.windowBounds.width}
      windowHeight={placement.windowBounds.height}
      {reducedMotion}
      {staticData}
      focusRequest={pinned ? 0 : focusRequest}
      pinnedWorkspaceId={conversationWorkspaceId === CHIEF_WORKSPACE_ID
        ? assistantId
        : conversationWorkspaceId}
      conversationOpen={!!edgeState.shell}
      closeRequest={sideCloseRequest}
      disabled={pending || gesture !== null || awaitingDragStart !== null}
      onOpen={(id, origin) => {
        edgeOrigin = origin
          ? {
              workspaceId: origin.workspaceId,
              radius: origin.radius,
              card: {
                ...origin.card,
                x: origin.card.x + placement.windowBounds.x,
                y: origin.card.y + placement.windowBounds.y,
              },
              anchor: origin.entryCentre - placement.surface.y,
            }
          : null;
        openWorkspace(id);
      }}
      onPreviewChange={(open) => {
        sidePreviewOpen = open;
      }}
      onRegionsChange={(regions) => {
        sideRegions = regions;
        publishRegions();
      }}
    />
  {/if}
  {#if edge && side && !dragging && !placement.captureHidden && conversation}
    <DockEdgeConversation
      open={conversationVisible}
      workspaceId={conversationWorkspaceId}
      {placement}
      {shown}
      origin={edgeCardOrigin}
      focusRequest={focusRequest + composerAsk.request}
      focusComposerOnMount={conversationPresence.keyboardOpen ||
        composerAsk.open === conversationWorkspaceId}
      onRegionsChange={conversationRegionsChanged}
      onPopupStateChange={(open) => (conversationPopupOpen = open)}
      onStateChange={(next) => {
        // Closed for good: the next open (a click or the keyboard) sets its own anchor.
        if (edgeState.shell && !next.shell && !conversationVisible) edgeOrigin = null;
        edgeState = next;
        measure();
      }}>{@render conversation()}</DockEdgeConversation
    >
  {/if}
  <DockActionFeedback
    feedback={placement.captureHidden || dragging ? null : actionFeedback}
    anchor={{
      rect: {
        x: placement.surface.x + shown.x,
        y: placement.surface.y + shown.y,
        width: shown.width,
        height: shown.height,
      },
      side: side ?? undefined,
      viewport: { width: placement.windowBounds.width, height: placement.windowBounds.height },
      topInset: placement.cutout ? placement.cutout.y + placement.cutout.height + 8 : 8,
    }}
    onDismiss={() => {
      placementErrorDismissed = !!placementError;
      feedback = null;
    }}
    onRegionsChange={(regions) => {
      feedbackRegions = regions;
      measure();
    }}
  />
</div>

<style>
  .adaptive-dock {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .companion {
    position: absolute;
    /* Native bounds and their input regions are immediate, even under the motion blanket. */
    transition-property: none;
    overflow: visible;
    pointer-events: none;
    color: hsl(var(--foreground));
    border-radius: 16px;
  }
  .companion.notch {
    border-radius: 0 0 20px 20px;
  }
  .companion.edge {
    border-radius: 14px;
  }
  [data-side='right'] .companion.edge {
    border-radius: 14px 0 0 14px;
  }
  [data-side='left'] .companion.edge {
    border-radius: 0 14px 14px 0;
  }
  .companion.dragging {
    cursor: grabbing;
    border-radius: 14px;
  }
  .companion-content {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    overflow: hidden;
  }
  .companion-header {
    position: relative;
    height: var(--header-height);
    display: flex;
    align-items: center;
    padding: 4px 12px;
    gap: 8px;
    cursor: var(--dock-grab-cursor, grab);
    touch-action: none;
  }
  .floating .companion-header {
    position: absolute;
    left: var(--floating-header-x);
    top: var(--floating-header-y);
    width: var(--floating-header-width);
    padding-inline: 12px;
  }
  .top-pill .companion-header {
    padding-left: var(--header-wing-left);
    padding-right: calc(var(--header-wing-right) - 6px);
  }
  :global(.dock-grip) {
    cursor: var(--dock-grab-cursor, grab);
    touch-action: none;
    flex: none;
    color: inherit;
  }
  .gesture-held {
    --dock-grab-cursor: grabbing;
  }
  .companion-header :global(*),
  .companion-header :global(.dock-grip),
  .companion-header :global(.dock-grip *) {
    cursor: var(--dock-grab-cursor, grab);
  }
  .companion-header :global(button:not(.dock-grip)),
  .companion-header :global(button:not(.dock-grip) *) {
    cursor: pointer;
  }
  .grip-mark {
    display: flex;
    color: hsl(var(--foreground));
    transition: opacity var(--grip-press-duration) var(--spring-fast-ease);
  }
  .grip-pressed .grip-mark {
    opacity: 0.72;
  }
  .header-state {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: opacity var(--grip-press-duration) var(--spring-fast-ease);
  }
  .companion:not(.notch):not(.expanded) .header-state,
  .top-pill .header-state,
  .floating .header-state {
    padding-right: 6px;
  }
  .notch .companion-header {
    padding-left: var(--header-wing-left);
  }
  .notch .header-state {
    position: absolute;
    right: var(--header-wing-right);
    margin: 0;
  }
  .notch .companion-header {
    padding-top: 0;
    padding-bottom: 0;
  }
  .camera-exclusion {
    position: absolute;
    top: 0;
    background: hsl(var(--dock-surface));
    pointer-events: none;
  }
  .side-header {
    position: absolute;
    top: var(--rail-offset);
    width: 40px;
    padding: 4px;
    justify-content: center;
  }
  [data-side='right'] .side-header {
    right: 0;
  }
  [data-side='left'] .side-header {
    left: 0;
  }
  .keyboard-open :global(*),
  .reduced-motion :global(*) {
    animation-duration: 0ms !important;
    transition-duration: 0ms !important;
  }
</style>
