/**
 * Performance Utilities
 * Helpers for optimizing performance in the workspace
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('performance-utils');

/**
 * Creates a debounced version of a function
 * The function will only be called after it stops being called for `delay` milliseconds
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): T & { cancel: () => void; flush: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      if (lastArgs) {
        fn(...lastArgs);
        lastArgs = null;
      }
      timeoutId = null;
    }, delay);
  }) as T;

  // Add cancel method to clear pending execution
  (debounced as any).cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  // Add flush method to execute immediately
  (debounced as any).flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      fn(...lastArgs);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return debounced as T & { cancel: () => void; flush: () => void };
}

/**
 * Creates a throttled version of a function
 * The function will be called at most once every `delay` milliseconds
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      fn(...args);
    } else {
      lastArgs = args;

      if (!timeoutId) {
        const remainingTime = delay - timeSinceLastCall;
        timeoutId = setTimeout(() => {
          if (lastArgs) {
            lastCall = Date.now();
            fn(...lastArgs);
            lastArgs = null;
          }
          timeoutId = null;
        }, remainingTime);
      }
    }
  }) as T;

  // Add cancel method
  (throttled as any).cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return throttled as T & { cancel: () => void };
}

/**
 * Batches multiple calls into a single execution
 * Useful for reducing re-renders and API calls
 */
export function batchUpdates<T>(fn: (items: T[]) => void, delay = 0): (item: T) => void {
  let items: T[] = [];
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (item: T) => {
    items.push(item);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      if (items.length > 0) {
        const batch = [...items];
        items = [];
        fn(batch);
      }
      timeoutId = null;
    }, delay);
  };
}

/**
 * Creates a memoized version of a function
 * Results are cached based on the arguments
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  options: {
    maxSize?: number;
    ttl?: number;
    keyFn?: (...args: any[]) => string;
  } = {},
): T {
  const { maxSize = 100, ttl = 0, keyFn = JSON.stringify } = options;
  const cache = new Map<string, { value: ReturnType<T>; timestamp: number }>();

  return ((...args: Parameters<T>) => {
    const key = keyFn.apply(null, args as any);
    const cached = cache.get(key);

    if (cached) {
      if (ttl === 0 || Date.now() - cached.timestamp < ttl) {
        return cached.value;
      }
    }

    const result = fn(...args);
    cache.set(key, { value: result, timestamp: Date.now() });

    // Limit cache size
    if (cache.size > maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }

    return result;
  }) as T;
}
