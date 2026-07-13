import {
  describe,
  it,
  expect,
} from 'vitest';
import { getAttributionOpacity } from '../attribution-color-scale';

/**
 * Tests for attribution-color-scale.ts
 *
 * The current implementation:
 * - Returns a numeric opacity value (0-1), not a color string
 * - For small time ranges (<5 mins), returns 0 (fully transparent)
 * - Base opacity from relative position: 0 → 0.3 (30% of range)
 * - Boost from absolute recency: up to +0.2 (20% boost for very recent edits)
 */

describe('Attribution Color Scale', () => {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const MONTH = 30 * DAY;

  describe('Small time range (<5 mins)', () => {
    it('should return 0 opacity when all edits are within 5 minutes', () => {
      const now = Date.now();
      const oldest = now - 3 * MINUTE; // 3 mins ago
      const newest = now;

      // All timestamps should be 0 (fully transparent)
      expect(getAttributionOpacity(oldest, oldest, newest)).toBe(0);
      expect(getAttributionOpacity(newest, oldest, newest)).toBe(0);
      expect(getAttributionOpacity(now - 1 * MINUTE, oldest, newest)).toBe(0);
    });
  });

  describe('Relative recency (position in edit history)', () => {
    it('should scale opacity based on position when no absolute recency boost', () => {
      const now = Date.now();
      const oldest = now - 30 * DAY; // 30 days ago
      const newest = now - 2 * DAY; // 2 days ago (no absolute boost since >10 mins)

      // Oldest edit: relativePosition = 0, so baseOpacity = 0, boost = 0
      const oldestOpacity = getAttributionOpacity(oldest, oldest, newest);
      expect(oldestOpacity).toBe(0);

      // Newest edit: relativePosition = 1, baseOpacity = 0.3, no boost (>10 mins old)
      const newestOpacity = getAttributionOpacity(newest, oldest, newest);
      expect(newestOpacity).toBe(0.3);

      // Middle edit: relativePosition = 0.5, baseOpacity = 0.15
      const middle = oldest + (newest - oldest) / 2;
      const middleOpacity = getAttributionOpacity(middle, oldest, newest);
      expect(middleOpacity).toBe(0.15);
    });
  });

  describe('Absolute recency boost', () => {
    it('should boost opacity for edits within 10 minutes', () => {
      const now = Date.now();
      const oldest = now - 6 * MONTH; // 6 months ago
      const newest = now - 2 * MINUTE; // 2 minutes ago

      // relativePosition = 1.0, baseOpacity = 0.3
      // absoluteRecency = 1 - (2/10) = 0.8
      // boost = 0.8 * 0.2 = 0.16
      // total = 0.3 + 0.16 = 0.46
      const newestOpacity = getAttributionOpacity(newest, oldest, newest);
      expect(newestOpacity).toBeCloseTo(0.46, 2);
    });

    it('should give maximum boost for very recent edits (< 1 minute)', () => {
      const now = Date.now();
      const oldest = now - 6 * MONTH; // 6 months ago
      const newest = now - 30 * 1000; // 30 seconds ago = 0.5 minutes

      // relativePosition = 1.0, baseOpacity = 0.3
      // absoluteRecency = 1 - (0.5/10) = 0.95
      // boost = 0.95 * 0.2 = 0.19
      // total = 0.3 + 0.19 = 0.49
      const newestOpacity = getAttributionOpacity(newest, oldest, newest);
      expect(newestOpacity).toBeCloseTo(0.49, 2);
    });

    it('should give no boost for edits older than 10 minutes', () => {
      const now = Date.now();
      const oldest = now - 6 * MONTH; // 6 months ago
      const newest = now - 2 * HOUR; // 2 hours ago = 120 mins

      // relativePosition = 1.0, baseOpacity = 0.3
      // absoluteRecency = max(0, 1 - (120/10)) = 0
      // boost = 0
      // total = 0.3
      const newestOpacity = getAttributionOpacity(newest, oldest, newest);
      expect(newestOpacity).toBe(0.3);
    });
  });

  describe('Real-world scenarios', () => {
    it('6-month-old note with edits 2 days ago should show medium opacity', () => {
      const now = Date.now();
      const oldest = now - 6 * MONTH;
      const newest = now - 2 * DAY;

      // No boost for 2-day old edit
      const opacity = getAttributionOpacity(newest, oldest, newest);
      expect(opacity).toBe(0.3);
    });

    it('6-month-old note with edits 2 minutes ago should show higher opacity', () => {
      const now = Date.now();
      const oldest = now - 6 * MONTH;
      const newest = now - 2 * MINUTE;

      // With boost for recent edit
      const opacity = getAttributionOpacity(newest, oldest, newest);
      expect(opacity).toBeCloseTo(0.46, 2);
    });

    it('old note with gradient of edits should show ascending opacity', () => {
      const now = Date.now();
      const oldest = now - 6 * MONTH;
      const middle = now - 3 * MONTH;
      const newest = now - 2 * DAY;

      const oldestOpacity = getAttributionOpacity(oldest, oldest, newest);
      const middleOpacity = getAttributionOpacity(middle, oldest, newest);
      const newestOpacity = getAttributionOpacity(newest, oldest, newest);

      // Should be ascending opacity
      expect(oldestOpacity).toBe(0);
      expect(middleOpacity).toBeCloseTo(0.15, 2);
      expect(newestOpacity).toBe(0.3);
    });

    it('2-minute-old note should return 0 (all transparent)', () => {
      const now = Date.now();
      const oldest = now - 2 * MINUTE;
      const newest = now;

      const opacity = getAttributionOpacity(newest, oldest, newest);
      expect(opacity).toBe(0); // Range too small
    });
  });

  describe('Custom absolute recency window', () => {
    it('should respect custom time window for absolute recency', () => {
      const now = Date.now();
      const oldest = now - 6 * MONTH;
      const newest = now - 2 * MINUTE;

      // With 20-minute window instead of 10-minute
      // absoluteRecency = 1 - (2/20) = 0.9
      // boost = 0.9 * 0.2 = 0.18
      // total = 0.3 + 0.18 = 0.48
      const opacity = getAttributionOpacity(newest, oldest, newest, 20);
      expect(opacity).toBeCloseTo(0.48, 2);
    });
  });
});
