/**
 * Shared Time Manager
 *
 * A singleton that manages time updates for all RelativeTime components.
 * Instead of each component creating its own interval, they all subscribe
 * to this shared manager which maintains a single interval per frequency bucket.
 *
 * This significantly reduces the number of active intervals when many
 * timestamps are displayed (e.g., in activity logs, message lists).
 */

// Frequency buckets for different update intervals
type FrequencyBucket = 'second' | 'minute' | 'hour' | 'day';

interface Subscriber {
  callback: () => void;
  targetDate: Date;
}

class SharedTimeManager {
  private static instance: SharedTimeManager | null = null;

  // Subscribers grouped by update frequency
  private subscribers: Map<FrequencyBucket, Set<Subscriber>> = new Map([
    ['second', new Set()],
    ['minute', new Set()],
    ['hour', new Set()],
    ['day', new Set()],
  ]);

  // Active intervals
  private intervals: Map<FrequencyBucket, ReturnType<typeof setInterval> | null> = new Map([
    ['second', null],
    ['minute', null],
    ['hour', null],
    ['day', null],
  ]);

  // Interval durations in ms
  private readonly INTERVALS: Record<FrequencyBucket, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
  };

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): SharedTimeManager {
    if (!SharedTimeManager.instance) {
      SharedTimeManager.instance = new SharedTimeManager();
    }
    return SharedTimeManager.instance;
  }

  /**
   * Determine which frequency bucket a date belongs to based on its age
   */
  private getBucket(targetDate: Date): FrequencyBucket {
    const diffMs = Math.abs(Date.now() - targetDate.getTime());
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return 'second';
    if (diffMinutes < 60) return 'minute';
    if (diffMinutes < 60 * 24) return 'hour';
    return 'day';
  }

  /**
   * Start an interval for a bucket if not already running
   */
  private ensureInterval(bucket: FrequencyBucket): void {
    if (this.intervals.get(bucket)) return;

    const interval = setInterval(() => {
      const subs = this.subscribers.get(bucket);
      if (subs) {
        // Notify all subscribers in this bucket
        subs.forEach((sub) => {
          sub.callback();
          // Check if subscriber should move to a different bucket
          const newBucket = this.getBucket(sub.targetDate);
          if (newBucket !== bucket) {
            subs.delete(sub);
            this.subscribers.get(newBucket)?.add(sub);
            this.ensureInterval(newBucket);
            this.cleanupIntervalIfEmpty(bucket);
          }
        });
      }
    }, this.INTERVALS[bucket]);

    this.intervals.set(bucket, interval);
  }

  /**
   * Clean up interval if no subscribers remain
   */
  private cleanupIntervalIfEmpty(bucket: FrequencyBucket): void {
    const subs = this.subscribers.get(bucket);
    if (subs && subs.size === 0) {
      const interval = this.intervals.get(bucket);
      if (interval) {
        clearInterval(interval);
        this.intervals.set(bucket, null);
      }
    }
  }

  /**
   * Subscribe to time updates for a specific target date
   * @returns Unsubscribe function
   */
  subscribe(targetDate: Date, callback: () => void): () => void {
    const bucket = this.getBucket(targetDate);
    const subscriber: Subscriber = { callback, targetDate };

    this.subscribers.get(bucket)?.add(subscriber);
    this.ensureInterval(bucket);

    // Return unsubscribe function
    return () => {
      // Find and remove from whichever bucket it's in
      for (const [bucketName, subs] of this.subscribers) {
        if (subs.has(subscriber)) {
          subs.delete(subscriber);
          this.cleanupIntervalIfEmpty(bucketName);
          break;
        }
      }
    };
  }

  /**
   * Get current subscriber count (for debugging)
   */
  getSubscriberCount(): number {
    let count = 0;
    for (const subs of this.subscribers.values()) {
      count += subs.size;
    }
    return count;
  }

  /**
   * Get active interval count (for debugging)
   */
  getActiveIntervalCount(): number {
    let count = 0;
    for (const interval of this.intervals.values()) {
      if (interval) count++;
    }
    return count;
  }
}

export const sharedTimeManager = SharedTimeManager.getInstance();
