import { describe, expect, it } from 'vitest';
import {
  formatMergeQueueEta,
  formatMergeQueuePosition,
  formatMergeQueueSummary,
  usableMergeQueueEntry,
} from './merge-queue';

describe('merge-queue formatting', () => {
  it('formats the position with and without the queue size', () => {
    expect(formatMergeQueuePosition({ position: 2, queueSize: 3 })).toBe('#2 of 3 in queue');
    expect(formatMergeQueuePosition({ position: 2 })).toBe('#2 in queue');
    // An inconsistent size (smaller than the position) is dropped.
    expect(formatMergeQueuePosition({ position: 4, queueSize: 3 })).toBe('#4 in queue');
  });

  it('rounds the estimate up to whole minutes and switches to hours', () => {
    expect(formatMergeQueueEta(2254)).toBe('~38 min to merge');
    expect(formatMergeQueueEta(0)).toBe('~1 min to merge');
    expect(formatMergeQueueEta(59)).toBe('~1 min to merge');
    expect(formatMergeQueueEta(3600)).toBe('~1 h 0 min to merge');
    expect(formatMergeQueueEta(3900)).toBe('~1 h 5 min to merge');
    expect(formatMergeQueueEta(undefined)).toBeNull();
    expect(formatMergeQueueEta(-5)).toBeNull();
    expect(formatMergeQueueEta(Number.NaN)).toBeNull();
  });

  it('joins position and estimate, omitting the estimate when absent', () => {
    expect(formatMergeQueueSummary({ position: 2, queueSize: 2, estimatedTimeToMerge: 2254 })).toBe(
      '#2 of 2 in queue · ~38 min to merge',
    );
    expect(formatMergeQueueSummary({ position: 1, queueSize: 3 })).toBe('#1 of 3 in queue');
  });

  it('ignores missing or malformed entries (older daemons)', () => {
    for (const bad of [
      undefined,
      null,
      {},
      { position: 0 },
      { position: 1.5 },
      { position: '2' },
    ]) {
      expect(usableMergeQueueEntry(bad)).toBeNull();
      expect(formatMergeQueueSummary(bad)).toBeNull();
    }
  });
});
