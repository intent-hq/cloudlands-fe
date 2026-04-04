import { type Readable, writable } from "svelte/store";

const hasRAF = typeof requestAnimationFrame === "function";
const unsetValue = Symbol("unset-throttled-readable-value");

const pending = new Set<() => void>();
let frameId: number | null = null;
let flushing = false;

const flush = (): void => {
  frameId = null;
  flushing = true;
  const callbacks = [...pending];
  pending.clear();
  for (const cb of callbacks) {
    cb();
  }
  flushing = false;
  // If callbacks triggered new updates during flush, schedule the next frame
  if (pending.size > 0) {
    frameId = requestAnimationFrame(flush);
  }
};

const schedule = (callback: () => void): void => {
  pending.add(callback);
  if (frameId === null && !flushing) {
    frameId = requestAnimationFrame(flush);
  }
};

export function createThrottledReadable<T>(source: Readable<T>): Readable<T> {
  // Skip throttling in non-browser environments (SSR, tests)
  if (!hasRAF) {
    return source;
  }

  let latest: { value: T } | null = null;
  let lastEmittedValue: T | typeof unsetValue = unsetValue;

  const store = writable<T>(undefined as T, (set) => {
    let initialized = false;
    const emit = (value: T) => {
      if (lastEmittedValue !== unsetValue && Object.is(lastEmittedValue, value)) {
        return;
      }

      lastEmittedValue = value;
      set(value);
    };

    const flushLatest = () => {
      if (latest !== null) {
        emit(latest.value);
      }
    };

    const unsubscribe = source.subscribe((value) => {
      if (!initialized) {
        initialized = true;
        emit(value);
        return;
      }
      latest = { value };
      schedule(flushLatest);
    });

    return () => {
      unsubscribe();
      latest = null;
      lastEmittedValue = unsetValue;
    };
  });

  return { subscribe: store.subscribe };
}
