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
  import { startAnnotation } from '$features/annotation/annotation-client';
  import { getDockHeaderBounds, getDockShellLayout } from './dock-shell-geometry';
  import { useDockConversationPresence } from './dock-conversation-presence.svelte';
  import { useDockConversationResize } from './dock-conversation-resize.svelte';
  import { useDockShellResize } from './dock-shell-resize.svelte';
  import { useDockConversationFocus } from './dock-conversation-focus.svelte';
  import DockCompanionContent from './DockCompanionContent.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';
  import DockUpdateStatus from './DockUpdateStatus.svelte';
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
    onAnnotate = startAnnotation,
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
    placementError?: boolean;
    dragStartResult?: { id: number; token: string | null } | null;
    resizeStartResult?: { id: number; token: string | null } | null;
    onOpenWorkspace?: (id: string) => void | Promise<void>;
    onOpenAssistant?: () => void | Promise<void>;
    onAnnotate?: typeof startAnnotation;
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
  );
  const conversationVisible = $derived(pinned && conversationPresence.open);

  let conversationRegions: DockPointerRect[] = [];
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
  let surfaceElement = $state<HTMLElement>();
  let gripElement = $state<HTMLButtonElement | null>(null);
  let pending = $state(false);
  let feedback = $state<{ message: string; retry?: () => void } | null>(null);
  let feedbackRegions: DockPointerRect[] = [];
  let placementErrorDismissed = $state(false);
  const actionFeedback = $derived(
    feedback ??
      (placementError && !placementErrorDismissed
        ? { message: m.dock_openFailed_error(), retry: resetPlacement }
        : null),
  );
  $effect(() => {
    if (!placementError) placementErrorDismissed = false;
  });
  let reducedMotion = $state(false);
  let keyboardOpen = $state(false);
  let pointerInside = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let measureFrame: number | undefined;
  let dragFrame: number | undefined;
  let shellFrame: number | undefined;
  let dragGripCenter = $state({ x: 26, y: 20 });
  const heldGripCenter = $derived(dragging ? dragGripCenter : null);
  let surfaceExpanded = $state(false);
  let contentVisible = $state(false);
  let reveal = $state(0);
  let animationTarget = 0;
  let disposed = false;
  let sequence = 0;
  let gesture = $state<{
    pointerId: number;
    x: number;
    y: number;
    revision: number;
    origin: { x: number; y: number };
    headerBounds: DockPointerRect;
    started: boolean;
  } | null>(null);
  let awaitingDragStart = $state<number | null>(null);
  let activeDragToken = $state<string | null>(null);
  type DragFinish =
    { action: 'end-drag'; releasePoint: { x: number; y: number } } | { action: 'cancel-drag' };
  let finishDrag = $state<DragFinish | null>(null);
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
  // This is a count of admitted workspaces with updates, not unread messages or agents.
  const updateCount = $derived(
    workspaces.filter((item) => item.isUnread || item.priorityGroup === 'action').length,
  );
  const hasAttention = $derived(workspaces.some((item) => item.priorityGroup === 'action'));
  const hasRunning = $derived(workspaces.some((item) => item.isRunning));
  // Outer ink inset, widest status glyph, gap, count advance and camera clearance.
  const compactWingWidth = $derived(12 + 12 + 4 + String(updateCount).length * 8 + 4);
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
  // Follow the visible shell while keeping the logo and status outside the camera.
  // The 28px grip's 16px mark has 6px inset: both attached header ink edges land at 12px.
  const headerWingLeft = $derived(shown.x + 6);
  const headerWingRight = $derived(placement.surface.width - shown.x - shown.width + 12);

  function animateShell(target: number, instant: boolean): void {
    if (animationTarget === target && shellFrame !== undefined && !instant) return;
    if (shellFrame !== undefined) cancelAnimationFrame(shellFrame);
    shellFrame = undefined;
    animationTarget = target;
    const from = reveal;
    if (instant || from === target) {
      reveal = target;
      return;
    }
    const start = performance.now();
    const duration =
      (target ? spring.moderate.settleMs : spring.moderate.exit.duration) * Math.abs(target - from);
    const easing = target ? spring.moderate.easing : spring.moderate.exit.easing;
    const frame = (now: number) => {
      const progress = duration > 0 ? Math.max(0, Math.min(1, (now - start) / duration)) : 1;
      reveal = from + (target - from) * easing(progress);
      if (progress < 1) shellFrame = requestAnimationFrame(frame);
      else shellFrame = undefined;
    };
    shellFrame = requestAnimationFrame(frame);
  }

  function sendDragEnd(token: string, finish: DragFinish): void {
    command({
      action: finish.action,
      token,
      sequence: ++sequence,
      ...(finish.action === 'end-drag'
        ? { releasePoint: { x: finish.releasePoint.x, y: finish.releasePoint.y } }
        : {}),
    });
  }
  // Allocate room before opening, then keep that transparent native envelope.
  // Only the visible shell is interactive. Closing/re-entry never races a native
  // shrink acknowledgement, and one progress value owns shell and content alike.
  $effect(() => {
    const wantOpen = expanded;
    const moving = dragging;
    const instant = reducedMotion || keyboardOpen;
    const room = placement.surface.width > compactWidth || placement.surface.height > compactHeight;
    untrack(() => {
      if (moving) {
        animateShell(0, true);
        contentVisible = false;
        surfaceExpanded = false;
        return;
      }
      if (wantOpen) {
        surfaceExpanded = true;
        if (room) {
          contentVisible = true;
          animateShell(1, instant);
        }
      } else {
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          focused.closest('.overview-frame') &&
          surfaceElement?.contains(focused)
        )
          focused.blur();
        animateShell(0, instant);
      }
    });
  });

  function command(value: DockPlacementCommand): void {
    if (!placement.captureHidden) onPlacementCommand(value);
  }

  function publishRegions(): void {
    if (disposed || !surfaceElement || placement.captureHidden) return;
    const regions: DockPointerRect[] = [
      {
        x: placement.surface.x + shown.x,
        y: placement.surface.y + shown.y,
        width: shown.width,
        height: shown.height,
      },
    ];
    pointerRegion.activate(
      [
        ...regions,
        ...sideRegions,
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

  useDockShellResize(
    () => ({
      placement,
      width: desiredWidth,
      height: desiredHeight,
      railHeight,
      compactWingWidth,
      conversationVisible,
      conversationSize: conversationResize.size,
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

  // Only a command response settles startup; unrelated idle geometry updates do not.
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
        animateShell(0, true);
        contentVisible = false;
        surfaceExpanded = false;
      });
      expandedByUser = false;
      pointerRegion.deactivate([], placement.revision);
    }
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
      conversationFocus.pointerLeave();
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
    // A microtask can run between blur and the browser's next focus event.
    // Keep content focusable until that native focus transfer completes.
    if (event instanceof FocusEvent && keyboardOpen) closeTimer = setTimeout(close, 0);
    else closeTimer = setTimeout(close, spring.moderate.settleMs);
  }

  function resetPlacement(): void {
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
    if (shellFrame !== undefined) cancelAnimationFrame(shellFrame);
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    dragFrame = shellFrame = measureFrame = undefined;
    pointerEnd(true);
    expandedByUser = false;
    keyboardOpen = false;
    contentVisible = false;
    feedback = null;
    (document.activeElement as HTMLElement | null)?.blur();
    // Blur/focusout can schedule the grace timer; discard it before hiding.
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
      conversationPresence.show();
      onOpenConversation(id === assistantId ? CHIEF_WORKSPACE_ID : id);
      return;
    }
    void runAction(
      () => (id === assistantId ? onOpenAssistant() : onOpenWorkspace(id)),
      m.dock_opening_status(),
      m.dock_openFailed_error(),
    );
  }
  function annotate(id: string, title: string): void {
    void runAction(
      () =>
        onAnnotate({
          workspaceId: id === assistantId ? CHIEF_WORKSPACE_ID : id,
          workspaceTitle: title,
        }),
      m.annotation_bootstrapLoading_title(),
      m.annotation_startFailed_title(),
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
    if (gripBounds && surfaceBounds?.width && surfaceBounds.height) {
      dragGripCenter = {
        x: Math.max(
          14,
          Math.min(
            210,
            ((gripBounds.x + gripBounds.width / 2 - surfaceBounds.x) * placement.surface.width) /
              surfaceBounds.width -
              (visibleHeader.x - placement.surface.x),
          ),
        ),
        y: Math.max(
          14,
          Math.min(
            26,
            ((gripBounds.y + gripBounds.height / 2 - surfaceBounds.y) * placement.surface.height) /
              surfaceBounds.height -
              (visibleHeader.y - placement.surface.y),
          ),
        ),
      };
    }
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
    const finish: DragFinish =
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
    pointerEnd(true);
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
    if (shellFrame !== undefined) cancelAnimationFrame(shellFrame);
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
  onkeydowncapture={(event) => {
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
      data-dock-surface={notch ? 'notch' : 'detached'}
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
        expandedByUser = true;
        if (!conversationFocus.returning && (event.target as HTMLElement).matches(':focus-visible'))
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
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <header
          class="companion-header"
          class:side-header={edge}
          style:padding-left={heldGripCenter ? `${heldGripCenter.x - 14}px` : undefined}
          style:padding-top={heldGripCenter ? `${heldGripCenter.y - 14}px` : undefined}
          style:padding-bottom={heldGripCenter ? `${26 - heldGripCenter.y}px` : undefined}
          onpointerdown={(event) => {
            if (!(event.target as HTMLElement).closest('button')) pointerDown(event);
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
              <DockUpdateStatus
                {workspaces}
                count={updateCount}
                attention={hasAttention}
                running={hasRunning}
              />
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
            {conversation}
            {conversationWorkspaceId}
            {focusRequest}
            onOpen={openWorkspace}
            onFeedback={annotate}
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
      closeRequest={sideCloseRequest}
      disabled={pending || gesture !== null || awaitingDragStart !== null}
      onOpen={openWorkspace}
      onFeedback={annotate}
      onPreviewChange={(open) => {
        sidePreviewOpen = open;
      }}
      onRegionsChange={(regions) => {
        sideRegions = regions;
        publishRegions();
      }}
    />
  {/if}
  {#if edge && conversationVisible && !dragging && !placement.captureHidden && conversationWorkspaceId && conversation && placement.sidePanel}
    <DockConversationSurface
      workspaceId={conversationWorkspaceId}
      {focusRequest}
      focusComposerOnMount={conversationPresence.keyboardOpen}
      rect={placement.sidePanel}
      onRegionsChange={conversationRegionsChanged}
      onPopupStateChange={(open) => (conversationPopupOpen = open)}
    >
      {@render conversation()}
    </DockConversationSurface>
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
      placementErrorDismissed = placementError;
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
