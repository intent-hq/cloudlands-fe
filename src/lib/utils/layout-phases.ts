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
 */

interface Task {
  fn: () => void;
  cancelled: boolean;
}

/** Cancels the scheduled task. Safe to call after the task has run. */
export type CancelLayoutTask = () => void;

let readTasks: Task[] = [];
let writeTasks: Task[] = [];
let frameId: number | null = null;
let flushing = false;

function runTask(task: Task) {
  if (task.cancelled) return;
  try {
    task.fn();
  } catch (error) {
    // Surface the failure without losing the rest of the queue.
    queueMicrotask(() => {
      throw error;
    });
  }
}

const FRAME_PENDING = -1;
let scheduledWith: typeof globalThis.requestAnimationFrame | null = null;

function ensureFrame() {
  const raf = globalThis.requestAnimationFrame;
  // The scheduledWith comparison re-arms the frame when the pending one was
  // scheduled against a different requestAnimationFrame implementation —
  // test environments stub rAF per test, which would otherwise strand the
  // queue behind a callback that never fires.
  if (frameId !== null && scheduledWith === raf) return;
  scheduledWith = raf;
  // Sentinel first: stubs that invoke the callback synchronously reset
  // frameId to null inside flush() before the call returns — the returned
  // id must not be written back over that.
  frameId = FRAME_PENDING;
  const id = raf(flush);
  if (frameId === FRAME_PENDING) frameId = id;
}

function flush() {
  frameId = null;
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
  if (readTasks.length > 0 || writeTasks.length > 0) ensureFrame();
}

/**
 * Schedule a layout READ (measurement) for the next batched frame.
 * Returns a cancel function.
 */
export function scheduleLayoutRead(fn: () => void): CancelLayoutTask {
  const task: Task = { fn, cancelled: false };
  readTasks.push(task);
  // Mid-flush scheduling is handled by the flush itself: reads queued during
  // the read phase join it, reads queued during the write phase roll over to
  // the frame the flush tail schedules.
  if (!flushing) ensureFrame();
  return () => {
    task.cancelled = true;
  };
}

/**
 * Schedule a layout WRITE (mutation) for the write phase of the next batched
 * frame. Returns a cancel function.
 */
export function scheduleLayoutWrite(fn: () => void): CancelLayoutTask {
  const task: Task = { fn, cancelled: false };
  writeTasks.push(task);
  if (!flushing) ensureFrame();
  return () => {
    task.cancelled = true;
  };
}
