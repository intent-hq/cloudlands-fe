/**
 * useDebounce Hook
 * Debounces a value with configurable delay
 */

export function useDebounce<T>(value: T, delay: number = 300): T {
  let debouncedValue = $state(value);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    // Clear previous timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Set new timeout
    timeoutId = setTimeout(() => {
      debouncedValue = value;
    }, delay);

    // Cleanup on unmount
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  });

  return debouncedValue;
}
