import { spring } from '$lib/motion';

/** One display frame: the most time a motion advances per painted frame. */
const FRAME_MS = 1000 / 60;
/** The most a motion may fall behind real time (throttled or long-stalled frames). */
const MAX_LAG_MS = 100;
/** If the window stops producing frames, a timer finishes the motion instead. */
const STALLED_FRAME_MS = 64;

/** One cancellable requestAnimationFrame loop. `step` gets elapsed ms and returns true when done. */
export function createFrameLoop() {
  let frame: number | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (fallback !== undefined) clearTimeout(fallback);
    frame = undefined;
    fallback = undefined;
  };
  return {
    get active(): boolean {
      return frame !== undefined || fallback !== undefined;
    },
    cancel,
    start(step: (elapsed: number) => boolean): void {
      cancel();
      const requested = performance.now();
      let last: number | undefined;
      let elapsed = 0;
      const tick = (now: number) => {
        cancel();
        // Advance by frames actually shown, at most one frame's worth at a time: a short
        // stall (mounting content, a native reply) slows the motion instead of skipping
        // part of it. It never lags real time by more than MAX_LAG_MS, so a window whose
        // frames are throttled still finishes as soon as frames resume.
        elapsed = Math.max(
          elapsed + Math.min(Math.max(0, now - (last ?? requested)), FRAME_MS),
          now - requested - MAX_LAG_MS,
        );
        last = now;
        if (!step(elapsed)) schedule();
      };
      // A non-key dock window can stop receiving animation frames entirely; the timer
      // keeps the motion moving so the shell never stays half open.
      const schedule = (): void => {
        frame = requestAnimationFrame(tick);
        fallback = setTimeout(() => tick(performance.now()), STALLED_FRAME_MS);
      };
      schedule();
    },
  };
}

/** Open and close timing for a reveal; durations scale with the remaining distance. */
export interface RevealTiming {
  openMs: number;
  closeMs: number;
  openEasing: (t: number) => number;
  closeEasing: (t: number) => number;
}

/** The shell reveal default: the moderate spring opens and its exit curve closes. */
const MODERATE_REVEAL: RevealTiming = {
  openMs: spring.moderate.settleMs,
  closeMs: spring.moderate.exit.duration,
  openEasing: spring.moderate.easing,
  closeEasing: spring.moderate.exit.easing,
};

/**
 * Reveal progress (0 closed, 1 open). An interrupted motion reverses from the current
 * value, and the last frame lands exactly on the target.
 */
export function createRevealTween(
  read: () => number,
  write: (value: number) => void,
  timing: RevealTiming = MODERATE_REVEAL,
) {
  const loop = createFrameLoop();
  let target = 0;
  return {
    cancel: loop.cancel,
    animate(next: number, instant: boolean): void {
      if (target === next && loop.active && !instant) return;
      loop.cancel();
      target = next;
      const from = read();
      if (instant || from === next) {
        write(next);
        return;
      }
      const duration = (next ? timing.openMs : timing.closeMs) * Math.abs(next - from);
      const easing = next ? timing.openEasing : timing.closeEasing;
      loop.start((elapsed) => {
        const progress = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 1;
        // The last frame lands exactly on the target, whatever the easing rounds to.
        write(progress >= 1 ? next : from + (next - from) * easing(progress));
        return progress >= 1;
      });
    },
  };
}

/**
 * Holds a growth until the native window grants room, but never longer than `waitMs`:
 * then the morph starts anyway (the layout clamps it to the window until native catches
 * up). `release(granted)` starts it at once, toward at most what native granted.
 */
export function createGrowGate(start: (from: number, to: number) => void, waitMs = 34) {
  let pending: { from: number; to: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const cancel = (): void => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };
  const release = (granted = Infinity): void => {
    const grow = pending;
    if (!grow) return;
    cancel();
    start(grow.from, Math.min(grow.to, granted));
  };
  return {
    get pending(): boolean {
      return pending !== null;
    },
    hold(from: number, to: number): void {
      cancel();
      pending = { from, to, timer: setTimeout(() => release(), waitMs) };
    },
    release,
    cancel,
  };
}
