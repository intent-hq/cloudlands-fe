import { sharedTimeManager } from './shared-time-manager.svelte';

/**
 * Calculate relative time string from a timestamp
 * Pure function - no side effects
 */
function calculateRelativeTime(target: Date): string {
  const now = Date.now();
  const then = target.getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  // Future dates
  if (diffMs < 0) {
    const futureDiffMs = Math.abs(diffMs);
    const futureDiffMinutes = Math.floor(futureDiffMs / 60000);
    const futureDiffHours = Math.floor(futureDiffMinutes / 60);
    const futureDiffDays = Math.floor(futureDiffHours / 24);

    if (futureDiffMinutes < 1) return 'in a few seconds';
    if (futureDiffMinutes === 1) return 'in 1 minute';
    if (futureDiffMinutes < 60) return `in ${futureDiffMinutes} minutes`;
    if (futureDiffHours === 1) return 'in 1 hour';
    if (futureDiffHours < 24) return `in ${futureDiffHours} hours`;
    if (futureDiffDays === 1) return 'tomorrow';
    if (futureDiffDays < 7) return `in ${futureDiffDays} days`;
    return target.toLocaleDateString();
  }

  // Past dates
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
  if (diffMinutes === 1) return '1 minute ago';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffWeeks === 1) return '1 week ago';
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  if (diffMonths === 1) return '1 month ago';
  if (diffMonths < 12) return `${diffMonths} months ago`;
  if (diffYears === 1) return '1 year ago';
  return `${diffYears} years ago`;
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
        return 'Invalid date';
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
 * Calculate compact time string from a timestamp
 * Pure function - no side effects
 */
function calculateCompactTime(target: Date): string {
  const now = Date.now();
  const diffMs = now - target.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffWeeks < 5) return `${diffWeeks}w`;
  if (diffMonths < 12) return `${diffMonths}mo`;
  const isThisYear = target.getFullYear() === new Date().getFullYear();
  if (isThisYear) {
    // Show month and day for this year
    return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  // Otherwise show year
  return target.getFullYear().toString();
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
