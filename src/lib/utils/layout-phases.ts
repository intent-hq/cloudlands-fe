/**
 * Shared layout read/write scheduler.
 *
 * Interleaving DOM writes with layout reads (getBoundingClientRect,
 * clientWidth, getComputedStyle, …) forces synchronous reflows. During a
 * workspace switch many components measure themselves in the same burst, so
 * independent rAF callbacks that each write-then-read multiply the cost.
 *
 * This module coalesces all participants into a single animation frame that
 * runs every READ task first (against one clean layout) and every WRITE task
 * after, so at most one layout pass is forced per frame regardless of how
 * many components measure.
 *
 * Rules:
 * - Reads scheduled during the read phase join the current phase.
 * - Writes scheduled during either phase run in this frame's write phase.
 * - Reads scheduled during the write phase defer to the NEXT frame (the
 *   write phase dirties layout).
 * - Cancelling never cancels the shared frame. A task queued after a cancel
 *   (for example, by a tween callback that runs earlier in the same browser
 *   frame) must still run in that frame; a new request would run next frame.
 */

interface Task {
  fn: () => void;
  pending: boolean;
}

/** Cancels the scheduled task. Safe to call after the task has run. */
export type CancelLayoutTask = () => void;

let readTasks: Task[] = [];
let writeTasks: Task[] = [];
let frameRequested = false;
let flushing = false;
let pendingTasks = 0;

function runTask(task: Task) {
  if (!task.pending) return;
  task.pending = false;
  pendingTasks -= 1;
  try {
    task.fn();
  } catch (error) {
    // Surface the failure without losing the rest of the queue.
    queueMicrotask(() => {
      throw error;
    });
  }
}

let scheduledWith: typeof globalThis.requestAnimationFrame | null = null;

function cancelTask(task: Task) {
  if (!task.pending) return;
  task.pending = false;
  pendingTasks -= 1;
  // Release cancelled closures; the armed frame then flushes nothing.
  if (pendingTasks > 0 || flushing) return;
  readTasks = [];
  writeTasks = [];
}

function ensureFrame() {
  const raf = globalThis.requestAnimationFrame;
  // The scheduledWith comparison re-arms the frame when the pending one was
  // scheduled against a different requestAnimationFrame implementation —
  // test environments stub rAF per test, which would otherwise strand the
  // queue behind a callback that never fires.
  if (frameRequested && scheduledWith === raf) return;
  scheduledWith = raf;
  // Set before the call: stubs that invoke the callback synchronously clear
  // it inside flush().
  frameRequested = true;
  raf(flush);
}

function flush() {
  frameRequested = false;
  flushing = true;
  try {
    while (readTasks.length > 0) {
      const batch = readTasks;
      readTasks = [];
      for (const task of batch) runTask(task);
    }
    while (writeTasks.length > 0) {
      const batch = writeTasks;
      writeTasks = [];
      for (const task of batch) runTask(task);
    }
  } finally {
    flushing = false;
  }
  // Reads queued during the write phase run next frame, against clean layout.
  if (pendingTasks > 0) ensureFrame();
  else {
    readTasks = [];
    writeTasks = [];
  }
}

/**
 * Schedule a layout READ (measurement) for the next batched frame.
 * Returns a cancel function.
 */
export function scheduleLayoutRead(fn: () => void): CancelLayoutTask {
  const task: Task = { fn, pending: true };
  pendingTasks += 1;
  readTasks.push(task);
  // Mid-flush scheduling is handled by the flush itself: reads queued during
  // the read phase join it, reads queued during the write phase roll over to
  // the frame the flush tail schedules.
  if (!flushing) ensureFrame();
  return () => cancelTask(task);
}

/**
 * Schedule a layout WRITE (mutation) for the write phase of the next batched
 * frame. Returns a cancel function.
 */
export function scheduleLayoutWrite(fn: () => void): CancelLayoutTask {
  const task: Task = { fn, pending: true };
  pendingTasks += 1;
  writeTasks.push(task);
  if (!flushing) ensureFrame();
  return () => cancelTask(task);
}
