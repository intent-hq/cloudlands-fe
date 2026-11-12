<script lang="ts">
  import { useDockEditorCompact } from './dock-editor-compact.svelte';
  import type { DockShellProps } from './dock-shell-props';
  import '$lib/styles/dock-tokens.css';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Logo from '$lib/components/Logo.svelte';
  import { activateIntentFromDock } from '$features/hud/dock-context-menu';
  import { DOCK_NOTCH_HOVER_DELAY_MS } from '$features/hud/utils/dock-hover-intent';
  import { spring } from '$lib/motion';
  import { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';
  import { m } from '$shared/paraglide/messages.js';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import type { DockPointerRect } from '$shared/dock-layout';
  import type { DockPlacementCommand } from '$shared/dock-placement';
  import { createDockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
  import { openDockWorkspace, openDockAssistant } from '$features/hud/dock-navigation';
  import {
    dockViewportRect,
    getDockShellLayout,
    dockCompactWingWidth,
  } from './dock-shell-geometry';
  import { useDockConversationPresence } from './dock-conversation-presence.svelte';
  import { dockIntro, releaseDockIntroHold } from '$features/hud/intro/dock-intro.svelte';
  import { useDockConversationResize } from './dock-conversation-resize.svelte';
  import { useDockHoverComposerFocus } from './dock-hover-composer-focus.svelte';
  import { useDockShellDrag } from './dock-shell-drag.svelte';
  import { useDockShellMotion } from './dock-shell-motion.svelte';
  import { useDockShellResize } from './dock-shell-resize.svelte';
  import { useDockConversationFocus } from './dock-conversation-focus.svelte';
  import DockCompanionContent from './DockCompanionContent.svelte';
  import DockEdgeConversation from './DockEdgeConversation.svelte';
  import type { DockEdgeOpenOrigin } from '$features/hud/utils/dock-edge-shell';
  import DockRecordingIndicator from './DockRecordingIndicator.svelte';
  import DockUpdateStatus from './DockUpdateStatus.svelte';
  import { dockStatusGroups } from '$features/hud/utils/dock-status-groups';
  import { dockPlacementFailureMessage } from '$features/hud/utils/dock-placement-failure';
  import DockSideEntries from './DockSideEntries.svelte';
  import DockActionFeedback from './DockActionFeedback.svelte';
  import DockShellSilhouette from './DockShellSilhouette.svelte';
  import DockMachineMenu from './DockMachineMenu.svelte';
  let {
    workspaces,
    olderWorkspaces = [],
    recording = null,
    inputLive = false,
    recordingStopping = false,
    onStopRecording,
    machines,
    machineId = '',
    machineSwitching = null,
    machineError = false,
    onMachine,
    placement,
    onPlacementCommand,
    focusRequest = 0,
    closeRequest = 0,
    editorCompactRequest = null,
    sideDefaultWorkspaceId = null,
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
    onHomeDismiss,
  }: DockShellProps = $props();
  // svelte-ignore state_referenced_locally
  // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous pointer-region state controller, not a domain-data request
  const pointerRegion = pointerController ?? createDockPointerRegionController();
  const assistantId = 'dock:assistant';
  const pinned = $derived(!!conversationWorkspaceId);
  let rootElement = $state<HTMLDivElement>();
  let compactRecording = $state<string | null>(null);
  const mediaHold = $derived(inputLive && compactRecording !== recording?.clipId);
  const conversationPresence = useDockConversationPresence(
    () => conversationWorkspaceId,
    () => rootElement,
    () => placement.captureHidden || placement.phase === 'dragging',
    () => conversationResize.held || nativeMenuOpen || mediaHold,
    () => !edge,
    () => (notch ? DOCK_NOTCH_HOVER_DELAY_MS : 0),
  );
  const conversationVisible = $derived(pinned && conversationPresence.open);
  let conversationRegions: DockPointerRect[] = [];
  let edgeState = $state({ held: false, reveal: 0, shell: null as DockPointerRect | null });
  let edgeOrigin = $state<{
    workspaceId: string;
    card: DockPointerRect;
    radius: number;
    anchor: number;
  } | null>(null);
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
  let measureFrame: number | undefined;
  let disposed = false;
  const shellMotion = useDockShellMotion({
    placement: () => placement,
    expanded: () => expanded,
    dragging: () => dragging,
    reducedMotion: () => reducedMotion,
    edge: () => edge,
    compactWidth: () => compactWidth,
    compactHeight: () => compactHeight,
    inputLive: () => inputLive,
    desiredHeight: () => desiredHeight,
    disposed: () => disposed,
    surface: () => surfaceElement,
    resizeHeld: () => conversationResize.held,
    resizeBusy: () => conversationResize.busy,
    closed() {
      showOlder = false;
      overviewQuery = '';
    },
  });

  const shellDrag = useDockShellDrag({
    placement: () => placement,
    startResult: () => dragStartResult,
    disposed: () => disposed,
    machineSwitching: () => machineSwitching,
    resizeBusy: () => conversationResize.busy,
    dragging: () => dragging,
    grip: () => gripElement,
    surface: () => surfaceElement,
    shown: () => shown,
    floatingCompact: () => floatingCompact,
    headerHeight: () => headerHeight,
    command,
    nativeCommand(value) {
      onPlacementCommand(value);
    },
    started() {
      expandedByUser = false;
    },
    pinned: () => pinned,
    edge: () => edge,
    expanded: () => expanded,
    surfaceExpanded: () => shellMotion.surfaceExpanded,
    notch: () => notch,
    keyboardOpen: () => keyboardOpen,
    setKeyboardOpen(value) {
      keyboardOpen = value;
    },
    setExpanded(value) {
      expandedByUser = value;
    },
    pointerEntered() {
      pointerRegion.recordEnter?.();
      hoverComposerFocus.enter();
    },
    leavePresence() {
      conversationPresence.leave();
      hoverComposerFocus.leave();
    },
    showPresence() {
      conversationPresence.show();
    },
    outsideFocus(event) {
      conversationFocus.pointerLeave(event);
    },
    keepsOpen: (inside, keyboard) => conversationFocus.keepsOverviewOpen(inside, keyboard),
    popupEscapeEvent: () => popupEscapeEvent,
    machineMenuOpen: () => machineMenuOpen,
    machineId: () => machineId,
    machines: () => machines,
    machineError: () => machineError,
    switchMachine(id) {
      onMachine?.(id);
    },
    closeMenu() {
      machineMenuOpen = false;
    },
    closeLikeEscape,
    root: () => rootElement,
    outsideBlocked: () =>
      nativeMenuOpen ||
      machineMenuOpen ||
      conversationPopupOpen ||
      conversationResize.held ||
      (!expanded && !edgeState.held),
    userInput() {
      lastUserInput = performance.now();
    },
    dismiss,
    homeDismiss() {
      onHomeDismiss?.();
    },
  });
  const nativeMenuOpen = $derived(shellDrag.nativeMenuOpen);
  const heldGripCenter = $derived(dragging ? shellDrag.gripCenter : null);
  let sidePreviewOpen = $state(false);
  let sideCloseRequest = $state(0);
  /** Local open requests from the open shortcut on a collapsed dock (see closeRequest). */
  let shortcutOpenRequest = $state(0);
  /**
   * Open requests the side entries take. On a side the open shortcut opens a chat (the
   * dock routes it to the last or first workspace), so the entries take it only when
   * there is no workspace to open.
   */
  let sideFocusRequest = $state(0);
  let sideFocusRequestSeen = untrack(() => focusRequest);
  $effect(() => {
    const request = focusRequest;
    if (request === sideFocusRequestSeen) return;
    sideFocusRequestSeen = request;
    if (untrack(() => workspaces.length === 0)) sideFocusRequest += 1;
  });
  let sideRegions: DockPointerRect[] = [];
  const expanded = $derived(
    !edge &&
      !dragging &&
      (nativeMenuOpen ||
        machineMenuOpen ||
        (pinned
          ? conversationVisible
          : expandedByUser || dockIntro.hold || (!floating && pending))),
  );
  const statusGroups = $derived(dockStatusGroups(workspaces));
  const compactWingWidth = $derived(
    Math.max(dockCompactWingWidth(statusGroups.length), recording ? 120 : 0),
  );
  const rowLimit = 5;
  const conversationResize = useDockConversationResize(
    () => placement,
    () => pinned,
    () => layout.headerHeight,
    () => resizeStartResult,
    (value) => onPlacementCommand(value),
  );
  let showOlder = $state(false);
  // The index search survives opening a conversation and Back; a full close clears it.
  let overviewQuery = $state('');
  const overviewWorkspaceCount = $derived(workspaces.length);
  const layout = $derived(
    getDockShellLayout(placement, {
      surfaceExpanded: shellMotion.surfaceExpanded,
      recording: !!recording,
      conversationOpen: pinned,
      conversationSize: conversationResize.size,
      reveal: shellMotion.reveal,
      expandedHeight: shellMotion.openHeight,
      rowLimit,
      workspaceCount: machineMenuOpen
        ? Math.max(overviewWorkspaceCount, Math.min(machines?.length ?? 0, 5))
        : overviewWorkspaceCount,
      hasOlderWorkspaces: olderWorkspaces.length > 0,
      compactWingWidth,
      hasFeedback: actionFeedback !== null,
      intro: dockIntro.open,
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
  let recordingSeen: string | null = null;
  $effect(() => {
    const clipId = recording?.clipId ?? null;
    if (clipId === recordingSeen) return;
    recordingSeen = clipId;
    untrack(() => {
      compactRecording = clipId;
      if (!clipId) return;
      shellDrag.cancelOpen();
      shellDrag.cancelClose();
      hoverComposerFocus.leave();
      conversationPresence.hide(true);
      releaseDockIntroHold();
      shellDrag.dismissedUntilLeave = shellDrag.pointerInside;
      shellDrag.pointerInside = false;
      expandedByUser = false;
      keyboardOpen = false;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && rootElement?.contains(focused)) focused.blur();
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
  useDockShellResize(
    () => ({
      placement,
      gestureHeld: shellDrag.gesture !== null || shellDrag.awaiting !== null,
      width: desiredWidth,
      height:
        shellMotion.heldHeight === null
          ? desiredHeight
          : Math.max(desiredHeight, shellMotion.heldHeight),
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
    if (placement.captureHidden) {
      untrack(() => {
        shellDrag.cancelOpen();
        shellDrag.pointerInside = false;
        shellDrag.pointerEnd(true);
        shellMotion.animate(0, true);
        shellMotion.contentVisible = false;
        shellMotion.surfaceExpanded = false;
      });
      expandedByUser = false;
      pointerRegion.deactivate([], placement.revision);
    }
  });
  $effect(() => {
    if ((shellMotion.reveal === 0 && !edge) || dragging || placement.captureHidden)
      composerAsk.open = null;
  });
  const conversationFocus = useDockConversationFocus({
    get workspaceId() {
      return conversationWorkspaceId;
    },
    get request() {
      return focusRequest + shortcutOpenRequest;
    },
    get contentVisible() {
      return shellMotion.contentVisible;
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
      shellDrag.cancelOpen();
      conversationPresence.show(!returning);
      expandedByUser = true;
      keyboardOpen = !returning;
    },
    pointerOutside: shellDrag.leave,
  });
  const hoverComposerFocus = useDockHoverComposerFocus(
    () => ({
      notch,
      workspaceId: conversationWorkspaceId,
      inputLive,
      expanded,
      settled: shellMotion.reveal === 1 && shellMotion.settled,
      blocked:
        inputLive ||
        dragging ||
        !!shellDrag.gesture ||
        shellDrag.awaiting !== null ||
        placement.captureHidden ||
        placement.phase !== 'idle' ||
        conversationResize.held,
      popup: nativeMenuOpen || machineMenuOpen || conversationPopupOpen,
      root: rootElement,
    }),
    () => command({ action: 'focus' }),
  );
  function resetPlacement(): void {
    shellDrag.cancelOpen();
    shellMotion.stopHeight();
    expandedByUser = false;
    shellMotion.contentVisible = false;
    shellMotion.surfaceExpanded = false;
    shellMotion.reveal = 0;
    command({ action: 'move', target: 'reset' });
    void tick().then(() => gripElement?.focus({ preventScroll: true }));
  }
  function dismiss(): void {
    if (placement.captureHidden || inputLive || recording || nativeMenuOpen) return;
    hoverComposerFocus.leave();
    conversationPresence.hide(shellDrag.pointerInside);
    releaseDockIntroHold();
    shellDrag.dismissedUntilLeave = shellDrag.pointerInside;
    if (!pinned) onHomeDismiss?.();
    shellDrag.pointerInside = false;
    shellDrag.cancelOpen();
    shellDrag.cancelClose();
    shellDrag.cancelFrame();
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    measureFrame = undefined;
    shellMotion.stopHeight(true);
    shellDrag.pointerEnd(true);
    expandedByUser = false;
    keyboardOpen = false;
    shellMotion.contentVisible = false;
    feedback = null;
    (document.activeElement as HTMLElement | null)?.blur();
    shellDrag.cancelClose();
    pointerRegion.deactivate([], placement.revision);
    // Collapse only: `dismiss` is the dock's own Hide (it closes and turns the dock off).
    command({ action: 'release' });
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
  function reopenRecording(): void {
    if (!recording || recording.workspaceId !== conversationWorkspaceId) return;
    command({ action: 'focus' });
    conversationPresence.show();
    expandedByUser = true;
    keyboardOpen = true;
    composerAsk.open = recording.workspaceId;
    composerAsk.request += 1;
  }
  function openWorkspace(id: string, fromKeyboard = false): void {
    if (onOpenConversation) {
      command({ action: 'focus' });
      const workspaceId = id === assistantId ? CHIEF_WORKSPACE_ID : id;
      if (notch || edge) composerAsk.open = workspaceId;
      if (edge) composerAsk.request += 1;
      conversationPresence.show(fromKeyboard);
      onOpenConversation(workspaceId);
      return;
    }
    void runAction(
      () => (id === assistantId ? onOpenAssistant() : onOpenWorkspace(id)),
      m.dock_opening_status(),
      m.dock_openFailed_error(),
    );
  }
  /** What Escape does once nothing else claims it: close the conversation, or collapse. */
  function closeLikeEscape(): void {
    if (placement.captureHidden || nativeMenuOpen || inputLive || recording) return;
    if (pinned) {
      dismiss();
      return;
    }
    if (edge && sidePreviewOpen) {
      sideCloseRequest += 1;
      return;
    }
    dismiss();
  }
  // The open shortcut again while the dock has the keyboard: close what is open as Escape
  // would; a collapsed dock opens and focuses its prompt instead, as the shortcut does.
  let closeRequestSeen = untrack(() => closeRequest);
  $effect(() => {
    const request = closeRequest;
    if (request === closeRequestSeen) return;
    closeRequestSeen = request;
    untrack(() => {
      // Live input, a recording, a native menu or capture hiding: the press changes nothing.
      if (placement.captureHidden || nativeMenuOpen || inputLive || recording) return;
      // On a side the press opens a chat, like the shortcut does: a side entry's preview
      // (focus returned to it after Back, or a hover card) is not an open chat to close.
      const sideOpens = edge && !!sideDefaultWorkspaceId && !(pinned && conversationVisible);
      if (!sideOpens && (expanded || (edge && sidePreviewOpen) || (pinned && conversationVisible)))
        closeLikeEscape();
      else if (sideOpens && sideDefaultWorkspaceId)
        openWorkspace(
          sideDefaultWorkspaceId === CHIEF_WORKSPACE_ID ? assistantId : sideDefaultWorkspaceId,
          true,
        );
      else shortcutOpenRequest += 1;
    });
  });
  useDockEditorCompact(
    () => ({
      request: editorCompactRequest,
      revision: placement.revision,
      blocked:
        disposed ||
        placement.captureHidden ||
        dragging ||
        nativeMenuOpen ||
        inputLive ||
        !!recording,
      compact:
        !expanded &&
        !conversationVisible &&
        !sidePreviewOpen &&
        !edgeState.held &&
        !edgeState.shell &&
        !shellMotion.surfaceExpanded &&
        !shellMotion.contentVisible &&
        shellMotion.reveal === 0 &&
        shellMotion.settled,
    }),
    () => {
      dismiss();
      if (sidePreviewOpen) sideCloseRequest += 1;
    },
    () => {
      publishRegions();
      return pointerRegion.flush?.() ?? Promise.resolve(null);
    },
    command,
  );
  onMount(() => {
    reducedMotion = prefersReducedMotion();
    const stopMotion = onReducedMotionChange((value) => {
      reducedMotion = value;
    });
    return stopMotion;
  });
  onDestroy(() => {
    disposed = true;
    shellMotion.cancelGrow();
    shellDrag.pointerEnd(true);
    shellDrag.cancelOpen();
    shellDrag.cancelClose();
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    shellDrag.cancelFrame();
    shellMotion.cancelReveal();
    shellMotion.cancelHeight();
    shellDrag.disposeNative();
    pointerRegion.destroy();
  });
  const reveal = $derived(shellMotion.reveal);
</script>

{#if machineMenuOpen && machines && onMachine && gripElement && (edge || shellMotion.contentVisible)}
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
  oncontextmenu={shellDrag.contextMenu}
  onpointerdowncapture={shellDrag.outsidePointer}
  onkeydowncapture={(event) => {
    lastUserInput = performance.now();
    if (shellDrag.gesture || shellDrag.awaiting !== null || dragging) shellDrag.keydown(event);
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
  onkeydown={shellDrag.keydown}
  onblur={() => {
    hoverComposerFocus.leave();
    if (!nativeMenuOpen) releaseDockIntroHold();
    shellDrag.pointerInside = false;
    shellDrag.pointerEnd(true);
    expandedByUser = false;
  }}
/>
<div
  bind:this={rootElement}
  class="adaptive-dock"
  data-dock-hover-scope
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
      class:gesture-held={shellDrag.gesture !== null || dragging}
      class:grip-pressed={shellDrag.gesture !== null && !dragging}
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
      style:--grip-press-duration={`${shellDrag.gesture ? spring.fast.settleMs : spring.fast.exit.duration}ms`}
      onpointerdowncapture={() => {
        shellDrag.pointerInside = true;
        shellDrag.dismissedUntilLeave = false;
        keyboardOpen = false;
      }}
      onpointerenter={shellDrag.enter}
      onpointerleave={shellDrag.leave}
      onfocusin={(event) => {
        if (shellDrag.gesture !== null || shellDrag.awaiting !== null || dragging) return;
        if (performance.now() - lastUserInput > 1000) return;
        shellDrag.cancelOpen();
        expandedByUser = true;
        const target = event.target as HTMLElement;
        // Text entry keeps motion even when it matches :focus-visible after a click.
        if (
          !conversationFocus.returning &&
          !target.isContentEditable &&
          !target.matches('input, textarea, select') &&
          target.matches(':focus-visible')
        )
          keyboardOpen = true;
      }}
      onfocusout={shellDrag.leave}
      aria-label={m.dock_workspaces_ariaLabel()}
      data-testid="dock-surface"
    >
      <DockShellSilhouette {placement} {shown} />
      <div
        class="companion-content"
        style:clip-path={contentClip}
        style:--dock-overview-height={`${Math.max(0, shown.height - headerHeight)}px`}
        inert={machineSwitching !== null}
      >
        <!-- Pointer drag surface; its click shortcut to the field has keyboard parity via Tab. -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <header
          class="companion-header"
          class:side-header={edge}
          class:recording-header={edge && !!recording}
          style:padding-left={heldGripCenter ? `${heldGripCenter.x - 14}px` : undefined}
          style:padding-top={heldGripCenter ? `${heldGripCenter.y - 14}px` : undefined}
          style:padding-bottom={heldGripCenter ? `${26 - heldGripCenter.y}px` : undefined}
          onpointerdown={(event) => {
            if (!(event.target as HTMLElement).closest('button')) shellDrag.pointerDown(event);
          }}
          ondblclick={(event) => {
            if (
              event.defaultPrevented ||
              (event.target as HTMLElement).closest('button') ||
              shellDrag.suppressClick ||
              shellDrag.gesture ||
              shellDrag.awaiting !== null ||
              dragging ||
              placement.captureHidden
            )
              return;
            event.preventDefault();
            machineMenuOpen = false;
            // eslint-disable-next-line intent/no-component-async-data-fetch -- native app activation, not domain data
            activateIntentFromDock();
          }}
          onclick={(event) => {
            // A notch click requests typing in the pinned conversation.
            const control = (event.target as HTMLElement).closest('button');
            const grip = !!control && control === gripElement;
            if (event.defaultPrevented || shellDrag.suppressClick || (control && !grip)) {
              if (!control) shellDrag.suppressClick = false;
              return;
            }
            if (notch && pinned && !(grip && machines && onMachine)) {
              shellDrag.cancelOpen();
              conversationPresence.show();
              expandedByUser = true;
              keyboardOpen = false;
              composerAsk.request += 1;
            }
          }}
          onpointermove={shellDrag.pointerMove}
          onpointerup={(event) => shellDrag.pointerEnd(false, event)}
          onpointercancel={() => shellDrag.pointerEnd(true)}
          onlostpointercapture={() => {
            if (shellDrag.gesture) shellDrag.pointerEnd(true);
          }}
        >
          <Button
            bind:ref={gripElement}
            variant="ghost"
            size="icon-sm"
            class="dock-grip"
            aria-label={m.dock_logo_open_label()}
            aria-haspopup={machines && onMachine ? 'menu' : undefined}
            aria-expanded={machines && onMachine ? machineMenuOpen : undefined}
            data-testid="dock-drag-handle"
            wrapContent={false}
            onpointerdown={shellDrag.pointerDown}
            onpointermove={shellDrag.pointerMove}
            onpointerup={(event) => shellDrag.pointerEnd(false, event)}
            onpointercancel={() => shellDrag.pointerEnd(true)}
            onlostpointercapture={() => {
              if (shellDrag.gesture) shellDrag.pointerEnd(true);
            }}
            oncontextmenu={(event) => {
              if (
                !machines ||
                !onMachine ||
                dragging ||
                placement.captureHidden ||
                shellDrag.gesture
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              machineMenuOpen = true;
            }}
            onkeydown={(event) => {
              if (
                !machines ||
                !onMachine ||
                dragging ||
                placement.captureHidden ||
                shellDrag.gesture
              )
                return;
              if (
                event.key === 'ArrowDown' ||
                event.key === 'ContextMenu' ||
                (event.shiftKey && event.key === 'F10')
              ) {
                event.preventDefault();
                event.stopPropagation();
                machineMenuOpen = true;
              }
            }}
            onclick={(event) => {
              // The logo is an app action; the surrounding header keeps its own click behavior.
              event.stopPropagation();
              if (shellDrag.suppressClick) {
                event.preventDefault();
                shellDrag.suppressClick = false;
                return;
              }
              if (
                shellDrag.gesture ||
                shellDrag.awaiting !== null ||
                dragging ||
                placement.captureHidden
              )
                return;
              machineMenuOpen = false;
              // eslint-disable-next-line intent/no-component-async-data-fetch -- request main to show its own window, without fetching domain data
              activateIntentFromDock();
            }}
          >
            <span class="grip-mark"><Logo width={16} /></span>
          </Button>
          {#if recording}
            <div class="header-recording" class:vertical={edge} style:opacity={dragging ? 0 : 1}>
              <DockRecordingIndicator
                {recording}
                stopping={recordingStopping}
                vertical={edge}
                onOpen={reopenRecording}
                onStop={onStopRecording}
              />
            </div>
          {:else if !edge}
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
        {#if shellMotion.contentVisible && !edge}
          <DockCompanionContent
            {workspaces}
            {olderWorkspaces}
            bind:showOlder
            bind:query={overviewQuery}
            {pending}
            {expanded}
            {reveal}
            {floating}
            {floatingUp}
            settling={shellMotion.openHeight !== null}
            clip={inlineClip}
            {conversation}
            {conversationWorkspaceId}
            focusRequest={focusRequest + shortcutOpenRequest + composerAsk.request}
            focusComposerOnMount={conversationPresence.keyboardOpen ||
              (notch && composerAsk.open === conversationWorkspaceId)}
            onOpen={openWorkspace}
            onRegionsChange={conversationRegionsChanged}
            onPopupStateChange={(open) => {
              conversationPopupOpen = open;
              if (open) hoverComposerFocus.cancel();
            }}
          />
        {/if}
      </div>
    </section>
  {/if}
  {#if edge && side && !dragging && !placement.captureHidden}
    <DockSideEntries
      {workspaces}
      railHeight={shown.height}
      {headerHeight}
      {side}
      railX={placement.surface.x + shown.x}
      railY={placement.surface.y + shown.y}
      windowWidth={placement.windowBounds.width}
      windowHeight={placement.windowBounds.height}
      {reducedMotion}
      {staticData}
      focusRequest={pinned ? 0 : sideFocusRequest + shortcutOpenRequest}
      pinnedWorkspaceId={conversationWorkspaceId === CHIEF_WORKSPACE_ID
        ? assistantId
        : conversationWorkspaceId}
      conversationOpen={!!edgeState.shell}
      closeRequest={sideCloseRequest}
      disabled={pending || shellDrag.gesture !== null || shellDrag.awaiting !== null}
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
      focusRequest={focusRequest + shortcutOpenRequest + composerAsk.request}
      focusComposerOnMount={conversationPresence.keyboardOpen ||
        composerAsk.open === conversationWorkspaceId}
      onRegionsChange={conversationRegionsChanged}
      onPopupStateChange={(open) => {
        conversationPopupOpen = open;
        if (open) hoverComposerFocus.cancel();
      }}
      onStateChange={(next) => {
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
  .header-recording {
    margin-left: auto;
    display: flex;
    align-items: center;
  }
  .notch .header-recording {
    position: absolute;
    right: var(--header-wing-right);
    margin: 0;
  }
  .header-recording.vertical {
    margin: 0;
  }
  .side-header.recording-header {
    height: var(--header-height);
    flex-direction: column;
    justify-content: flex-start;
    gap: 4px;
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
  /* Collapsed, the status wing hugs its glyphs: 8px outer inset (not 12) and 3px between
     glyphs (DOCK_COMPACT_STATUS_INSET / _GAP, which size the collapsed wing). */
  .notch:not(.expanded) .header-state {
    right: calc(var(--header-wing-right) - 4px);
    --dock-status-gap: 3px;
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
