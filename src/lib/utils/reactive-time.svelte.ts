import { formatCompactRelativeTime, formatRelativeTime } from '$lib/i18n/format';
import { sharedTimeManager } from './shared-time-manager.svelte';
import { m } from '$shared/paraglide/messages.js';

/**
 * Calculate relative time string from a timestamp in the active locale
 * (e.g., "now", "5 minutes ago", "yesterday", "in 2 days").
 * Pure function - no side effects
 */
function calculateRelativeTime(target: Date): string {
  return formatRelativeTime(target);
}

/**
 * Creates a reactive relative time string that automatically updates.
 * Uses the shared time manager to avoid creating individual intervals per component.
 * The update interval is smart - it updates more frequently for recent times
 * and less frequently for older times.
 *
 * @param targetDate - The date to calculate relative time from
 * @returns An object with the reactive time and cleanup function
 */
export function createReactiveRelativeTime(targetDate: Date | string | number) {
  const target = new Date(targetDate);

  // Validate the date
  if (isNaN(target.getTime())) {
    return {
      get time() {
        return m.ui_time_invalidDate_label();
      },
      cleanup: () => {},
    };
  }

  // Use reactive state that will be updated by the shared manager
  let currentTime = $state(Date.now());

  // Subscribe to the shared time manager
  const unsubscribe = sharedTimeManager.subscribe(target, () => {
    currentTime = Date.now();
  });

  // Return object with getter and cleanup
  return {
    get time() {
      // Access currentTime to establish reactivity dependency
      void currentTime;
      return calculateRelativeTime(target);
    },
    cleanup: unsubscribe,
  };
}

/**
 * Calculate compact time string from a timestamp in the active locale
 * (e.g., "now", "2m", "3h", "5d", then a short date).
 * Pure function - no side effects
 */
function calculateCompactTime(target: Date): string {
  return formatCompactRelativeTime(target);
}

/**
 * Creates a reactive compact relative time (e.g., "2m", "3h", "5d")
 * Uses the shared time manager to avoid creating individual intervals per component.
 *
 * @param targetDate - The date to calculate relative time from
 * @returns An object with the reactive time and cleanup function
 */
export function createReactiveCompactTime(targetDate: Date | string | number) {
  const target = new Date(targetDate);

  if (isNaN(target.getTime())) {
    return {
      get time() {
        return 'Invalid';
      },
      cleanup: () => {},
    };
  }

  // Use reactive state that will be updated by the shared manager
  let currentTime = $state(Date.now());

  // Subscribe to the shared time manager
  const unsubscribe = sharedTimeManager.subscribe(target, () => {
    currentTime = Date.now();
  });

  // Return object with getter and cleanup
  return {
    get time() {
      // Access currentTime to establish reactivity dependency
      void currentTime;
      return calculateCompactTime(target);
    },
    cleanup: unsubscribe,
  };
}
