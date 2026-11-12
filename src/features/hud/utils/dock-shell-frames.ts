import { panelSpring } from '$lib/motion';

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

interface RevealSpringTiming {
  openMs: number;
  closeMs: number;
}

/** Critically damped reveal; retargeting carries the last painted position and velocity. */
export function createRevealSpring(
  read: () => number,
  write: (value: number) => void,
  timing: RevealSpringTiming = panelSpring,
) {
  const loop = createFrameLoop();
  let target = 0;
  let velocity = 0;
  const cancel = (): void => {
    loop.cancel();
    velocity = 0;
  };
  return {
    cancel,
    animate(next: number, instant: boolean): void {
      if (target === next && loop.active && !instant) return;
      loop.cancel();
      target = next;
      let position = read();
      if (instant || (position === next && velocity === 0)) {
        velocity = 0;
        write(next);
        return;
      }
      const duration = (next ? timing.openMs : timing.closeMs) / 1000;
      // At the nominal duration, a full reveal is within 0.1% and 1%/s of rest.
      const omega = 10.5 / duration;
      let lastElapsed = 0;
      loop.start((elapsed) => {
        const dt = (elapsed - lastElapsed) / 1000;
        lastElapsed = elapsed;
        const offset = position - next;
        const carry = velocity + omega * offset;
        const decay = Math.exp(-omega * dt);
        position = next + (offset + carry * dt) * decay;
        velocity = (velocity - omega * carry * dt) * decay;
        if (position < 0 || position > 1) {
          position = Math.max(0, Math.min(1, position));
          velocity = 0;
        }
        const settled = Math.abs(position - next) < 0.001 && Math.abs(velocity) < 0.01;
        if (settled) velocity = 0;
        write(settled ? next : position);
        return settled;
      });
    },
  };
}

/** Reduced motion keeps the same lifecycle with opacity only. */
export function createRevealFade(
  read: () => number,
  write: (value: number) => void,
  duration = panelSpring.reducedMs,
) {
  const loop = createFrameLoop();
  let target = 0;
  return {
    cancel: loop.cancel,
    animate(next: number): void {
      if (target === next && loop.active) return;
      loop.cancel();
      target = next;
      const from = read();
      if (from === next) return;
      const travelMs = duration * Math.abs(next - from);
      loop.start((elapsed) => {
        const progress = Math.min(1, elapsed / travelMs);
        write(from + (next - from) * progress);
        return progress === 1;
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
