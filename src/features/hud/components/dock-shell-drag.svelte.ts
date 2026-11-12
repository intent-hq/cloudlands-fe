import { showDockContextMenu } from '$features/hud/dock-context-menu';
import { wantsDockContextMenu } from '$features/hud/dock-context-target';
import type { DockMachineOption } from './dock-machine-types';
import { spring } from '$lib/motion';
import { DOCK_NOTCH_HOVER_DELAY_MS } from '$features/hud/utils/dock-hover-intent';
import { releaseDockIntroHold } from '$features/hud/intro/dock-intro.svelte';
import { untrack } from 'svelte';
import type { DockPointerRect } from '$shared/dock-layout';
import type { DockPlacementCommand, DockPlacementSnapshot } from '$shared/dock-placement';
import {
  dockDragEndCommand,
  dockDragGripCenter,
  getDockHeaderBounds,
  type DockDragGesture,
  type DockDragFinish,
} from './dock-shell-geometry';

interface DockShellDragState {
  placement(): DockPlacementSnapshot;
  startResult(): { id: number; token: string | null } | null | undefined;
  disposed(): boolean;
  machineSwitching(): string | null;
  resizeBusy(): boolean;
  dragging(): boolean;
  grip(): HTMLElement | null;
  surface(): HTMLElement | undefined;
  shown(): DockPointerRect;
  floatingCompact(): DockPointerRect;
  headerHeight(): number;
  command(value: DockPlacementCommand): void;
  nativeCommand(value: DockPlacementCommand): void;
  started(): void;
  pinned(): boolean;
  edge(): boolean;
  expanded(): boolean;
  surfaceExpanded(): boolean;
  notch(): boolean;
  keyboardOpen(): boolean;
  setKeyboardOpen(value: boolean): void;
  setExpanded(value: boolean): void;
  pointerEntered(): void;
  leavePresence(): void;
  showPresence(): void;
  outsideFocus(event: PointerEvent): void;
  keepsOpen(inside: boolean, keyboard: boolean): boolean;
  homeDismiss(): void;
  root(): HTMLElement | undefined;
  outsideBlocked(): boolean;
  userInput(): void;
  dismiss(): void;
  popupEscapeEvent(): KeyboardEvent | null;
  machineMenuOpen(): boolean;
  machineId(): string;
  machines(): DockMachineOption[] | undefined;
  machineError(): boolean;
  switchMachine(id: string): void;
  closeMenu(): void;
  closeLikeEscape(): void;
}

/** Own one pointer capture, its pending native acknowledgement, token and queued drag frame. */
export function useDockShellDrag(state: DockShellDragState) {
  let nativeMenuOpen = $state(false);
  let pointerInside = false;
  let dismissedUntilLeave = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let dragFrame: number | undefined;
  let dragGripCenter = $state({ x: 26, y: 20 });
  let sequence = 0;
  let gesture = $state<DockDragGesture | null>(null);
  let awaitingDragStart = $state<number | null>(null);
  let activeDragToken = $state<string | null>(null);
  let finishDrag = $state<DockDragFinish | null>(null);
  let suppressClick = false;
  let captureElement: HTMLElement | null = null;
  function sendDragEnd(token: string, finish: DockDragFinish): void {
    state.command(dockDragEndCommand(token, finish, ++sequence));
  }
  $effect(() => {
    const result = state.startResult();
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
      if (finish || !gesture || state.disposed() || state.placement().captureHidden) {
        sendDragEnd(
          result.token,
          state.disposed() || state.placement().captureHidden
            ? { action: 'cancel-drag' }
            : (finish ?? { action: 'cancel-drag' }),
        );
      } else {
        activeDragToken = result.token;
      }
    });
  });
  $effect(() => {
    if (state.placement().phase === 'idle' && activeDragToken && awaitingDragStart === null) {
      untrack(() => {
        activeDragToken = null;
        releaseGesture();
      });
    }
  });
  function enter(): void {
    if (state.disposed() || state.placement().captureHidden || dismissedUntilLeave) return;
    state.pointerEntered();
    pointerInside = true;
    clearTimeout(closeTimer);
    if (gesture || awaitingDragStart !== null || state.dragging()) return;
    if (state.pinned()) state.setKeyboardOpen(false);
    if (state.edge() || state.expanded()) return;
    state.setKeyboardOpen(false);
    if (state.surfaceExpanded()) state.setExpanded(true);
    else if (openTimer === undefined)
      openTimer = setTimeout(
        () => {
          openTimer = undefined;
          if (
            !pointerInside ||
            state.disposed() ||
            state.placement().captureHidden ||
            gesture ||
            awaitingDragStart !== null ||
            state.dragging()
          )
            return;
          if (state.pinned()) state.showPresence();
          state.setExpanded(true);
        },
        state.notch() ? DOCK_NOTCH_HOVER_DELAY_MS : spring.fast.settleMs,
      );
  }
  function cancelOpen(): void {
    clearTimeout(openTimer);
    openTimer = undefined;
  }
  function leave(event?: PointerEvent | FocusEvent): void {
    if (event instanceof PointerEvent) {
      dismissedUntilLeave = false;
      state.leavePresence();
      pointerInside = false;
      if (!gesture && awaitingDragStart === null) state.outsideFocus(event);
    }
    cancelOpen();
    clearTimeout(closeTimer);
    if (
      event instanceof FocusEvent &&
      event.relatedTarget instanceof Node &&
      state.surface()?.contains(event.relatedTarget)
    )
      return;
    const close = () => {
      if (nativeMenuOpen || gesture || awaitingDragStart !== null || state.dragging()) return;
      if (!state.keepsOpen(pointerInside, state.keyboardOpen())) {
        state.setExpanded(false);
        if (!state.pinned()) {
          releaseDockIntroHold();
          state.homeDismiss();
        }
      }
    };
    if (event instanceof FocusEvent && state.keyboardOpen()) closeTimer = setTimeout(close, 0);
    else closeTimer = setTimeout(close, spring.moderate.settleMs);
  }
  function pointerDown(event: PointerEvent): void {
    if (
      state.machineSwitching() !== null ||
      event.button !== 0 ||
      !event.isPrimary ||
      gesture ||
      awaitingDragStart !== null ||
      state.resizeBusy() ||
      state.dragging() ||
      state.placement().captureHidden
    )
      return;
    cancelOpen();
    clearTimeout(closeTimer);
    const gripBounds = state.grip()?.getBoundingClientRect();
    const surfaceBounds = state.surface()?.getBoundingClientRect();
    const visibleHeader = getDockHeaderBounds(
      state.placement(),
      state.shown(),
      state.floatingCompact(),
      state.headerHeight(),
    );
    dragGripCenter = dockDragGripCenter(
      gripBounds,
      surfaceBounds,
      state.placement().surface,
      visibleHeader,
      dragGripCenter,
    );
    gesture = {
      pointerId: event.pointerId,
      x: event.screenX,
      y: event.screenY,
      revision: state.placement().revision,
      headerBounds: getDockHeaderBounds(
        state.placement(),
        state.shown(),
        state.floatingCompact(),
        state.headerHeight(),
      ),
      origin: {
        x: event.screenX - state.placement().windowBounds.x - state.placement().surface.x,
        y: event.screenY - state.placement().windowBounds.y - state.placement().surface.y,
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
      awaitingDragStart = state.startResult()?.id ?? 0;
      suppressClick = true;
      state.started();
      cancelOpen();
      clearTimeout(closeTimer);
      state.command({
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
        state.command({ action: 'drag', token: activeDragToken, sequence: ++sequence });
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
    if (!state.disposed() && !state.placement().captureHidden) {
      if (pointerInside) enter();
      else leave();
    }
  }
  function pointerEnd(cancelled = false, event?: PointerEvent): void {
    if (event && event.pointerId !== gesture?.pointerId) return;
    const finish: DockDragFinish =
      cancelled || !event
        ? { action: 'cancel-drag' }
        : { action: 'end-drag', releasePoint: { x: event.screenX, y: event.screenY } };
    if (awaitingDragStart !== null) {
      finishDrag = finish;
    } else if (activeDragToken) {
      sendDragEnd(activeDragToken, finish);
      activeDragToken = null;
    }
    releaseGesture();
  }
  function outsidePointer(event: PointerEvent): void {
    state.userInput();
    const target = event.target;
    if (
      !(target instanceof Node) ||
      state.root()?.contains(target) ||
      (target instanceof Element && target.closest('[data-dock-conversation-portals]')) ||
      gesture ||
      awaitingDragStart !== null ||
      state.dragging() ||
      state.outsideBlocked()
    )
      return;
    state.dismiss();
  }
  async function contextMenu(event: MouseEvent): Promise<void> {
    if (
      state.placement().captureHidden ||
      state.dragging() ||
      gesture ||
      !wantsDockContextMenu(event.target)
    )
      return;
    event.preventDefault();
    if (nativeMenuOpen) return;
    nativeMenuOpen = true;
    cancelOpen();
    cancelClose();
    const current = state.machineId();
    try {
      const result = await showDockContextMenu({
        machines: state.machines(),
        currentId: state.machineId(),
        pending: state.machineSwitching(),
        error: state.machineError(),
      });
      if (
        !state.disposed() &&
        !state.placement().captureHidden &&
        !state.dragging() &&
        state.machineId() === current &&
        !state.machineSwitching() &&
        result.backendId &&
        result.backendId !== state.machineId() &&
        state.machines()?.some((item) => item.id === result.backendId)
      )
        state.switchMachine(result.backendId);
    } finally {
      nativeMenuOpen = false;
      if (!state.disposed()) leave();
    }
  }
  function keydown(event: KeyboardEvent): void {
    if (
      event.key !== 'Escape' ||
      event.isComposing ||
      state.placement().captureHidden ||
      event.defaultPrevented
    )
      return;
    if (gesture || awaitingDragStart !== null || state.dragging()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (gesture || awaitingDragStart !== null || activeDragToken) pointerEnd(true);
      else {
        const token = state.placement().dragToken;
        if (token) cancelNative(token);
      }
      return;
    }
    if (event === state.popupEscapeEvent()) return;
    if (state.machineMenuOpen()) {
      state.closeMenu();
      event.preventDefault();
      state.grip()?.focus({ preventScroll: true });
      return;
    }
    event.preventDefault();
    state.closeLikeEscape();
  }
  function cancelFrame(): void {
    if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  }
  function cancelNative(token: string): void {
    state.command({ action: 'cancel-drag', token, sequence: ++sequence });
  }
  function disposeNative(): void {
    const token = state.placement().dragToken;
    if (token)
      state.nativeCommand({
        action: 'cancel-drag',
        token,
        sequence: ++sequence,
      });
  }
  function cancelClose(): void {
    clearTimeout(closeTimer);
  }
  return {
    get pointerInside() {
      return pointerInside;
    },
    set pointerInside(value: boolean) {
      pointerInside = value;
    },
    get dismissedUntilLeave() {
      return dismissedUntilLeave;
    },
    set dismissedUntilLeave(value: boolean) {
      dismissedUntilLeave = value;
    },
    enter,
    leave,
    cancelOpen,
    cancelClose,
    get gesture() {
      return gesture;
    },
    get awaiting() {
      return awaitingDragStart;
    },
    get token() {
      return activeDragToken;
    },
    get gripCenter() {
      return dragGripCenter;
    },
    get suppressClick() {
      return suppressClick;
    },
    set suppressClick(value: boolean) {
      suppressClick = value;
    },
    get nativeMenuOpen() {
      return nativeMenuOpen;
    },
    contextMenu,
    outsidePointer,
    keydown,
    pointerDown,
    pointerMove,
    pointerEnd,
    cancelFrame,
    cancelNative,
    disposeNative,
  };
}
