import { flushSync } from 'svelte';
import { vi } from 'vitest';

export interface AnimationFrames {
  /** Timestamp of the most recent frame; `performance.now()` returns it. */
  readonly now: number;
  /** Callbacks queued for the next frame. */
  readonly pending: number;
  /** Runs one browser frame and returns how many callbacks ran. */
  runFrame(): number;
  /** Runs frames until none are queued or `limit` frames ran; returns the frame count. */
  runFrames(limit?: number): number;
}

export interface AnimationFramesOptions {
  frameMs?: number;
  /** Runs after each callback, where browsers drain microtasks. Defaults to Svelte's `flushSync`. */
  afterCallback?: () => void;
}

/**
 * Stubs `requestAnimationFrame`, `cancelAnimationFrame` and `performance.now`
 * with browser frame semantics:
 * - a frame runs only the callbacks queued before it started; callbacks
 *   requested during a frame run in the next one;
 * - a callback cancelled while its frame runs does not run;
 * - pending updates (Svelte effects) run after each callback, not once per frame.
 *
 * Restore with `vi.unstubAllGlobals()` and `vi.restoreAllMocks()`.
 */
export function installAnimationFrames(options: AnimationFramesOptions = {}): AnimationFrames {
  const frameMs = options.frameMs ?? 1000 / 60;
  const afterCallback = options.afterCallback ?? (() => flushSync());
  let callbacks = new Map<number, FrameRequestCallback>();
  let running = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  let now = 0;

  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextId += 1;
    callbacks.set(nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id);
    running.delete(id);
  });

  const runFrame = () => {
    now += frameMs;
    running = callbacks;
    callbacks = new Map();
    let ran = 0;
    const errors: unknown[] = [];
    for (const [id, callback] of running) {
      // A callback earlier in this frame may have cancelled this one.
      if (!running.delete(id)) continue;
      ran += 1;
      // Like browsers, a throwing callback does not stop the rest of the frame.
      try {
        callback(now);
      } catch (error) {
        errors.push(error);
      }
      afterCallback();
    }
    running = new Map();
    if (errors.length > 0) throw errors[0];
    return ran;
  };

  return {
    get now() {
      return now;
    },
    get pending() {
      return callbacks.size;
    },
    runFrame,
    runFrames(limit = 120) {
      let frames = 0;
      while (callbacks.size > 0 && frames < limit) {
        runFrame();
        frames += 1;
      }
      return frames;
    },
  };
}
