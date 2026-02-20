/**
 * useThrottle Hook
 * Throttles a callback function with configurable delay
 */

export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 300,
): T {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      callback(...args);
    } else {
      // Clear existing timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Schedule call for remaining time
      const remainingTime = delay - timeSinceLastCall;
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        callback(...args);
      }, remainingTime);
    }
  }) as T;
}
