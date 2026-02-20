/**
 * Tests for time formatting utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatRelativeTime,
  formatChatTime,
  formatDateSeparator,
  groupMessagesByDate,
  shouldShowTimeSeparator,
  formatFullTimestamp,
  getSmartTimestamp,
} from '../timeFormatting';

describe('timeFormatting', () => {
  const NOW = new Date('2025-12-13T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatRelativeTime', () => {
    it('should return "Just now" for very recent times', () => {
      const date = new Date(NOW.getTime() - 5000); // 5 seconds ago
      expect(formatRelativeTime(date)).toBe('Just now');
    });

    it('should return seconds ago', () => {
      const date = new Date(NOW.getTime() - 30000); // 30 seconds ago
      expect(formatRelativeTime(date)).toBe('30 seconds ago');
    });

    it('should return "1 minute ago"', () => {
      const date = new Date(NOW.getTime() - 60000); // 1 minute ago
      expect(formatRelativeTime(date)).toBe('1 minute ago');
    });

    it('should return minutes ago', () => {
      const date = new Date(NOW.getTime() - 5 * 60000); // 5 minutes ago
      expect(formatRelativeTime(date)).toBe('5 minutes ago');
    });

    it('should return "1 hour ago"', () => {
      const date = new Date(NOW.getTime() - 60 * 60000); // 1 hour ago
      expect(formatRelativeTime(date)).toBe('1 hour ago');
    });

    it('should return hours ago', () => {
      const date = new Date(NOW.getTime() - 3 * 60 * 60000); // 3 hours ago
      expect(formatRelativeTime(date)).toBe('3 hours ago');
    });

    it('should return "Yesterday"', () => {
      const date = new Date(NOW.getTime() - 24 * 60 * 60000); // 1 day ago
      expect(formatRelativeTime(date)).toBe('Yesterday');
    });

    it('should return days ago', () => {
      const date = new Date(NOW.getTime() - 3 * 24 * 60 * 60000); // 3 days ago
      expect(formatRelativeTime(date)).toBe('3 days ago');
    });

    it('should return weeks ago', () => {
      const date = new Date(NOW.getTime() - 14 * 24 * 60 * 60000); // 2 weeks ago
      expect(formatRelativeTime(date)).toBe('2 weeks ago');
    });

    it('should return months ago', () => {
      const date = new Date(NOW.getTime() - 60 * 24 * 60 * 60000); // ~2 months ago
      expect(formatRelativeTime(date)).toBe('2 months ago');
    });

    it('should accept string dates', () => {
      const dateStr = new Date(NOW.getTime() - 5000).toISOString();
      expect(formatRelativeTime(dateStr)).toBe('Just now');
    });
  });

  describe('formatChatTime', () => {
    it('should format time correctly', () => {
      const result = formatChatTime(NOW);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('should accept string dates', () => {
      const result = formatChatTime(NOW.toISOString());
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('formatDateSeparator', () => {
    it('should return "Today" for today', () => {
      expect(formatDateSeparator(NOW)).toBe('Today');
    });

    it('should return "Yesterday" for yesterday', () => {
      const yesterday = new Date(NOW.getTime() - 24 * 60 * 60000);
      expect(formatDateSeparator(yesterday)).toBe('Yesterday');
    });
  });

  describe('groupMessagesByDate', () => {
    it('should return empty array for empty messages', () => {
      expect(groupMessagesByDate([])).toEqual([]);
    });

    it('should group messages by date', () => {
      const messages = [
        { id: 1, timestamp: NOW },
        { id: 2, timestamp: NOW },
        { id: 3, timestamp: new Date(NOW.getTime() - 24 * 60 * 60000) },
      ];

      const groups = groupMessagesByDate(messages);
      expect(groups).toHaveLength(2);
      expect(groups[0].messages).toHaveLength(2);
      expect(groups[1].messages).toHaveLength(1);
    });
  });

  describe('shouldShowTimeSeparator', () => {
    it('should return false for null timestamps', () => {
      expect(shouldShowTimeSeparator(null, null)).toBe(false);
      expect(shouldShowTimeSeparator(NOW, null)).toBe(false);
      expect(shouldShowTimeSeparator(null, NOW)).toBe(false);
    });

    it('should return false for close timestamps', () => {
      const prev = new Date(NOW.getTime() - 2 * 60000); // 2 minutes ago
      expect(shouldShowTimeSeparator(NOW, prev)).toBe(false);
    });

    it('should return true for distant timestamps', () => {
      const prev = new Date(NOW.getTime() - 10 * 60000); // 10 minutes ago
      expect(shouldShowTimeSeparator(NOW, prev)).toBe(true);
    });
  });

  describe('formatFullTimestamp', () => {
    it('should return a full timestamp string', () => {
      const result = formatFullTimestamp(NOW);
      expect(result).toContain('2025');
    });
  });
});
