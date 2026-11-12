import { untrack } from 'svelte';
import type { DockPlacementSnapshot } from '$shared/dock-placement';
import { dockHeightStep } from '$features/hud/utils/dock-motion';
import {
  createFrameLoop,
  createGrowGate,
  createRevealSpring,
} from '$features/hud/utils/dock-shell-frames';

interface DockShellMotionState {
  placement(): DockPlacementSnapshot;
  expanded(): boolean;
  dragging(): boolean;
  reducedMotion(): boolean;
  edge(): boolean;
  compactWidth(): number;
  compactHeight(): number;
  surface(): HTMLElement | undefined;
  inputLive(): boolean;
  desiredHeight(): number;
  disposed(): boolean;
  resizeHeld(): boolean;
  resizeBusy(): boolean;
  closed(): void;
}

/** The shell's existing reveal and height lifetimes; caller retains native and focus ownership. */
export function useDockShellMotion(state: DockShellMotionState) {
  let surfaceExpanded = $state(false);
  let contentVisible = $state(false);
  let reveal = $state(0);
  const shellSpring = createRevealSpring(
    () => reveal,
    (value) => (reveal = value),
  );
  let openHeight = $state<number | null>(null);
  let heldHeight = $state<number | null>(null);
  const heightLoop = createFrameLoop();
  let heightTarget = 0;
  const growGate = createGrowGate(
    (from, to) => !state.disposed() && morphHeight(openHeight ?? from, to),
  );
  function stopHeight(preservePaintedHeight = false): void {
    growGate.cancel();
    heightLoop.cancel();
    heldHeight = null;
    if (!preservePaintedHeight) openHeight = null;
  }
  function morphHeight(from: number, to: number): void {
    heldHeight = to < from ? Math.max(heldHeight ?? 0, state.placement().surface.height) : null;
    openHeight = from;
    heightLoop.start((elapsed) => {
      const step = dockHeightStep(from, to, elapsed);
      openHeight = step.value;
      if (!step.done) return false;
      heldHeight = null;
      if (state.placement().surface.height <= to + 0.5) openHeight = null;
      return true;
    });
  }
  $effect(() => {
    const wantOpen = state.expanded();
    const moving = state.dragging();
    // Keyboard focus is immediate; normal opening and reversals keep the spring.
    const instant = state.reducedMotion();
    const room = state.edge()
      ? state.placement().surface.width > state.compactWidth() ||
        state.placement().surface.height > state.compactHeight()
      : state.placement().surface.height > state.compactHeight();
    untrack(() => {
      if (moving) {
        shellSpring.animate(0, true);
        contentVisible = false;
        surfaceExpanded = false;
        return;
      }
      if (wantOpen) {
        surfaceExpanded = true;
        if (room) {
          contentVisible = true;
          shellSpring.animate(1, instant);
        }
      } else {
        stopHeight(true);
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          focused.closest('.overview-frame') &&
          state.surface()?.contains(focused)
        )
          focused.blur();
        shellSpring.animate(0, instant);
      }
    });
  });
  $effect(() => {
    if (state.expanded() || reveal !== 0) return;
    const live = state.inputLive();
    untrack(() => {
      if (!live) contentVisible = false;
      surfaceExpanded = false;
      state.closed();
      stopHeight();
    });
  });
  $effect(() => {
    const target = state.desiredHeight();
    const settled = state.expanded() && surfaceExpanded && reveal === 1;
    const immediate =
      state.reducedMotion() ||
      state.dragging() ||
      state.placement().captureHidden ||
      state.resizeHeld() ||
      state.resizeBusy();
    untrack(() => {
      const previous = heightTarget;
      heightTarget = target;
      if (immediate) {
        if (openHeight !== null || heldHeight !== null) stopHeight();
        return;
      }
      const retainedHeight =
        openHeight !== null &&
        !heightLoop.active &&
        !growGate.pending &&
        Math.abs(openHeight - target) > 0.5;
      if ((previous === target && !retainedHeight) || previous === 0) return;
      if (!settled) {
        stopHeight(true);
        return;
      }
      const from = openHeight ?? state.placement().surface.height;
      if (target > from && state.placement().surface.height < target - 0.5) {
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
    void state.placement().surface.height;
    untrack(() => {
      // Keep a partial native grant from becoming the final morph target.
      if (growGate.pending) growGate.release();
      else if (!heightLoop.active && heldHeight === null && openHeight !== null) openHeight = null;
    });
  });
  return {
    get surfaceExpanded() {
      return surfaceExpanded;
    },
    set surfaceExpanded(value: boolean) {
      surfaceExpanded = value;
    },
    get contentVisible() {
      return contentVisible;
    },
    set contentVisible(value: boolean) {
      contentVisible = value;
    },
    get reveal() {
      return reveal;
    },
    set reveal(value: number) {
      reveal = value;
    },
    get openHeight() {
      return openHeight;
    },
    get heldHeight() {
      return heldHeight;
    },
    get settled() {
      return openHeight === null && !heightLoop.active && !growGate.pending;
    },
    stopHeight,
    animate: shellSpring.animate,
    cancelReveal: shellSpring.cancel,
    cancelGrow: growGate.cancel,
    cancelHeight: heightLoop.cancel,
  };
}
