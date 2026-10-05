/**
 * Shared 30 fps frame clock for main-thread ambient motion.
 *
 * Subscribers run at most once per 1000/30 ms slot of `performance.now()`, the
 * same slot rule the Aurora canvas uses to throttle its render loop, so pose
 * changes from every subscriber land in frames Aurora already produces instead
 * of interleaving with them. One requestAnimationFrame loop serves all
 * subscribers and stops while there are none or while the window is blurred.
 */
const FRAME_CLOCK_INTERVAL_MS = 1000 / 30;

export type FrameClockCallback = (frameTimeMs: number) => void;

const subscribers = new Set<FrameClockCallback>();
let frame = 0;
let lastSlot = -1;
let blurObserver: MutationObserver | undefined;

function slotOf(timeMs: number): number {
  return Math.floor(timeMs / FRAME_CLOCK_INTERVAL_MS);
}

function windowBlurred(): boolean {
  return document.documentElement.hasAttribute('data-window-blurred');
}

/** Start of the current 30 fps slot, in `performance.now()` milliseconds. */
export function currentFrameTime(): number {
  return slotOf(performance.now()) * FRAME_CLOCK_INTERVAL_MS;
}

function tick(): void {
  frame = 0;
  if (subscribers.size === 0 || windowBlurred()) return;
  const slot = slotOf(performance.now());
  if (slot !== lastSlot) {
    lastSlot = slot;
    const frameTime = slot * FRAME_CLOCK_INTERVAL_MS;
    for (const callback of [...subscribers]) callback(frameTime);
  }
  if (subscribers.size > 0) frame = requestAnimationFrame(tick);
}

function schedule(): void {
  if (frame !== 0 || subscribers.size === 0 || windowBlurred()) return;
  frame = requestAnimationFrame(tick);
}

function stop(): void {
  if (frame === 0) return;
  cancelAnimationFrame(frame);
  frame = 0;
}

function observeWindowBlur(): void {
  if (blurObserver) return;
  blurObserver = new MutationObserver(() => {
    if (windowBlurred()) stop();
    else schedule();
  });
  blurObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-window-blurred'],
  });
}

/**
 * Subscribe to the shared clock. The callback receives the slot start time on
 * every slot change while the window is focused; it is not called for the slot
 * that is current at subscription time, so subscribers that need an immediate
 * pose should write it themselves with `currentFrameTime()`.
 */
export function subscribeFrameClock(callback: FrameClockCallback): () => void {
  subscribers.add(callback);
  observeWindowBlur();
  schedule();
  return () => {
    subscribers.delete(callback);
    if (subscribers.size > 0) return;
    stop();
    blurObserver?.disconnect();
    blurObserver = undefined;
  };
}
