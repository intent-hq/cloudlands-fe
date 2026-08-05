/**
 * Tests for date utilities
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  formatDistanceToNow,
  formatDate,
  formatRelativeTimeCompact,
} from '../date';

describe('date utilities', () => {
  const NOW = new Date('2025-12-13T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatDistanceToNow', () => {
    it('should return "now" for very recent times', () => {
      const date = new Date(NOW.getTime() - 5000); // 5 seconds ago
      expect(formatDistanceToNow(date)).toBe('now');
    });

    it('should return "1 minute ago"', () => {
      const date = new Date(NOW.getTime() - 60000); // 1 minute ago
      expect(formatDistanceToNow(date)).toBe('1 minute ago');
    });

    it('should return "5 minutes ago"', () => {
      const date = new Date(NOW.getTime() - 5 * 60000); // 5 minutes ago
      expect(formatDistanceToNow(date)).toBe('5 minutes ago');
    });

    it('should return "1 hour ago"', () => {
      const date = new Date(NOW.getTime() - 60 * 60000); // 1 hour ago
      expect(formatDistanceToNow(date)).toBe('1 hour ago');
    });

    it('should return "3 hours ago"', () => {
      const date = new Date(NOW.getTime() - 3 * 60 * 60000); // 3 hours ago
      expect(formatDistanceToNow(date)).toBe('3 hours ago');
    });

    it('should return "yesterday"', () => {
      const date = new Date(NOW.getTime() - 24 * 60 * 60000); // 1 day ago
      expect(formatDistanceToNow(date)).toBe('yesterday');
    });

    it('should return "5 days ago"', () => {
      const date = new Date(NOW.getTime() - 5 * 24 * 60 * 60000); // 5 days ago
      expect(formatDistanceToNow(date)).toBe('5 days ago');
    });

    it('should return "last month"', () => {
      const date = new Date(NOW.getTime() - 30 * 24 * 60 * 60000); // 30 days ago
      expect(formatDistanceToNow(date)).toBe('last month');
    });

    it('should return "last year"', () => {
      const date = new Date(NOW.getTime() - 365 * 24 * 60 * 60000); // 365 days ago
      expect(formatDistanceToNow(date)).toBe('last year');
    });

    it('should accept string dates', () => {
      const dateStr = new Date(NOW.getTime() - 5000).toISOString();
      expect(formatDistanceToNow(dateStr)).toBe('now');
    });
  });

  describe('formatDate', () => {
    it('should format date correctly', () => {
      const result = formatDate(NOW);
      expect(result).toContain('Dec');
      expect(result).toContain('2025');
    });

    it('should accept string dates', () => {
      const result = formatDate(NOW.toISOString());
      expect(result).toContain('Dec');
    });
  });

  describe('formatRelativeTimeCompact', () => {
    it('should return "Never" for null/undefined', () => {
      expect(formatRelativeTimeCompact(null)).toBe('Never');
      expect(formatRelativeTimeCompact(undefined)).toBe('Never');
    });

    it('should return minutes ago for recent times', () => {
      const date = new Date(NOW.getTime() - 30 * 60000); // 30 minutes ago
      expect(formatRelativeTimeCompact(date)).toBe('30m ago');
    });

    it('should return hours ago', () => {
      const date = new Date(NOW.getTime() - 3 * 60 * 60000); // 3 hours ago
      expect(formatRelativeTimeCompact(date)).toBe('3h ago');
    });

    it('should return days ago', () => {
      const date = new Date(NOW.getTime() - 3 * 24 * 60 * 60000); // 3 days ago
      expect(formatRelativeTimeCompact(date)).toBe('3d ago');
    });

    it('should return weeks ago for older dates', () => {
      const date = new Date(NOW.getTime() - 14 * 24 * 60 * 60000); // 14 days ago
      expect(formatRelativeTimeCompact(date)).toBe('2w ago');
    });
  });
});
