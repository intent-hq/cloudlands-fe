/**
 * Event Deduplication Service Tests
 *
 * Tests for the centralized event deduplication service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EventDeduplicationService,
  getDeduplicationService,
  resetDeduplicationService,
  type DeduplicationConfig,
} from '../src/features/events/event-deduplication.service';
import { WorkspaceEventType, type WorkspaceEvent } from '../src/features/events/types';

// Mock the logger
vi.mock('../src/shared/logger', () => ({
  Logger: class MockLogger {
    constructor(name: string) {}
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('EventDeduplicationService', () => {
  beforeEach(() => {
    // Reset the service before each test
    resetDeduplicationService();
  });

  afterEach(() => {
    // Clean up
    vi.clearAllMocks();
    resetDeduplicationService();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getDeduplicationService();
      const instance2 = getDeduplicationService();

      expect(instance1).toBe(instance2);
    });

    it('should reset properly', () => {
      const instance1 = getDeduplicationService();
      resetDeduplicationService();
      const instance2 = getDeduplicationService();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate events within window', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 1000,
      });

      const event: WorkspaceEvent = {
        id: 'test-event-1',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'test.txt', action: 'modify' },
      };

      // First occurrence should not be a duplicate
      expect(service.isDuplicate(event)).toBe(false);

      // Second occurrence should be a duplicate
      expect(service.isDuplicate(event)).toBe(true);

      // Third occurrence should still be a duplicate
      expect(service.isDuplicate(event)).toBe(true);
    });

    it('should not detect duplicate after window expires', async () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 100, // 100ms window
      });

      const event: WorkspaceEvent = {
        id: 'test-event-2',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'test.txt', action: 'modify' },
      };

      // First occurrence
      expect(service.isDuplicate(event)).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should not be a duplicate after window
      expect(service.isDuplicate(event)).toBe(false);
    });

    it('should handle different events correctly', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 1000,
      });

      const event1: WorkspaceEvent = {
        id: 'event-1',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'file1.txt', action: 'modify' },
        metadata: { filePath: 'file1.txt' }, // Add metadata for deduplication
      };

      const event2: WorkspaceEvent = {
        id: 'event-2',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'file2.txt', action: 'modify' },
        metadata: { filePath: 'file2.txt' }, // Different file path
      };

      // Both events should be unique (different file paths)
      expect(service.isDuplicate(event1)).toBe(false);
      expect(service.isDuplicate(event2)).toBe(false);

      // Checking again should show duplicates
      expect(service.isDuplicate(event1)).toBe(true);
      expect(service.isDuplicate(event2)).toBe(true);
    });

    it('should respect enabled flag', () => {
      const service = getDeduplicationService({
        enabled: false,
        windowMs: 1000,
      });

      const event: WorkspaceEvent = {
        id: 'test-event-3',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'test.txt', action: 'modify' },
      };

      // Should never detect duplicates when disabled
      expect(service.isDuplicate(event)).toBe(false);
      expect(service.isDuplicate(event)).toBe(false);
      expect(service.isDuplicate(event)).toBe(false);
    });
  });

  describe('Batch Filtering', () => {
    it('should filter duplicate events from array', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 1000,
      });

      const events: WorkspaceEvent[] = [
        {
          id: 'batch-1',
          workspaceId: 'workspace-1',
          timestamp: new Date().toISOString(),
          type: WorkspaceEventType.FileModified,
          actor: { type: 'user', id: 'user-1', name: 'Test User' },
          data: { path: 'file1.txt', action: 'modify' },
          metadata: { filePath: 'file1.txt' },
        },
        {
          id: 'batch-1', // Same ID = true duplicate (same event flowing through multiple bus paths)
          workspaceId: 'workspace-1',
          timestamp: new Date().toISOString(),
          type: WorkspaceEventType.FileModified,
          actor: { type: 'user', id: 'user-1', name: 'Test User' },
          data: { path: 'file1.txt', action: 'modify' },
          metadata: { filePath: 'file1.txt' },
        },
        {
          id: 'batch-2',
          workspaceId: 'workspace-1',
          timestamp: new Date().toISOString(),
          type: WorkspaceEventType.FileModified,
          actor: { type: 'user', id: 'user-1', name: 'Test User' },
          data: { path: 'file2.txt', action: 'modify' },
          metadata: { filePath: 'file2.txt' }, // Different file path
        },
      ];

      const filtered = service.filterDuplicates(events);

      // Should only have 2 unique events (batch-1 appears twice with same ID)
      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('batch-1');
      expect(filtered[1].id).toBe('batch-2');
    });

    it('should NOT filter events with different IDs even if metadata matches', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 1000,
      });

      const events: WorkspaceEvent[] = [
        {
          id: 'rapid-1',
          workspaceId: 'workspace-1',
          timestamp: new Date().toISOString(),
          type: WorkspaceEventType.FileModified,
          actor: { type: 'user', id: 'user-1', name: 'Test User' },
          data: { path: 'file1.txt', action: 'modify' },
          metadata: { filePath: 'file1.txt' },
        },
        {
          id: 'rapid-2', // Different ID = genuinely different event
          workspaceId: 'workspace-1',
          timestamp: new Date().toISOString(),
          type: WorkspaceEventType.FileModified,
          actor: { type: 'user', id: 'user-1', name: 'Test User' },
          data: { path: 'file1.txt', action: 'modify' },
          metadata: { filePath: 'file1.txt' }, // Same metadata but different ID
        },
      ];

      const filtered = service.filterDuplicates(events);

      // Both events should pass — different IDs mean genuinely different events
      expect(filtered).toHaveLength(2);
      expect(filtered[0].id).toBe('rapid-1');
      expect(filtered[1].id).toBe('rapid-2');
    });
  });

  describe('Statistics', () => {
    it('should track statistics correctly', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 1000,
      });

      const event1: WorkspaceEvent = {
        id: 'stats-1',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'file1.txt', action: 'modify' },
        metadata: { filePath: 'file1.txt' },
      };

      const event2: WorkspaceEvent = {
        id: 'stats-2',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'file2.txt', action: 'modify' },
        metadata: { filePath: 'file2.txt' },
      };

      // Check some events
      service.isDuplicate(event1); // Not duplicate
      service.isDuplicate(event1); // Duplicate (same type, actor, filePath)
      service.isDuplicate(event2); // Not duplicate (different filePath)
      service.isDuplicate(event1); // Duplicate

      const stats = service.getStats();

      expect(stats.totalChecked).toBe(4);
      expect(stats.duplicatesFound).toBe(2);
      expect(stats.cacheSize).toBe(2); // Two unique event keys tracked
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 1000,
      });

      const event: WorkspaceEvent = {
        id: 'clear-test-1',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'test.txt', action: 'modify' },
      };

      // Add an event
      expect(service.isDuplicate(event)).toBe(false);
      expect(service.isDuplicate(event)).toBe(true);

      // Clear cache
      service.clear();

      // Should not be a duplicate after clearing
      expect(service.isDuplicate(event)).toBe(false);
    });

    it('should handle max cache size', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 60000, // Long window
        maxCacheSize: 3, // Small cache
      });

      // Add more events than cache size
      for (let i = 0; i < 5; i++) {
        const event: WorkspaceEvent = {
          id: `cache-test-${i}`,
          workspaceId: 'workspace-1',
          timestamp: new Date().toISOString(),
          type: WorkspaceEventType.FileModified,
          actor: { type: 'user', id: 'user-1', name: 'Test User' },
          data: { path: `file${i}.txt`, action: 'modify' },
        };

        service.isDuplicate(event);
      }

      const stats = service.getStats();

      // Cache should be cleaned up when exceeding max size
      expect(stats.cacheSize).toBeLessThanOrEqual(3);
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      const service = getDeduplicationService({
        enabled: true,
        windowMs: 1000,
      });

      const event: WorkspaceEvent = {
        id: 'config-test-1',
        workspaceId: 'workspace-1',
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'user-1', name: 'Test User' },
        data: { path: 'test.txt', action: 'modify' },
      };

      // Initially enabled
      expect(service.isDuplicate(event)).toBe(false);
      expect(service.isDuplicate(event)).toBe(true);

      // Disable deduplication
      service.updateConfig({ enabled: false });

      // Should not detect duplicates when disabled
      expect(service.isDuplicate(event)).toBe(false);
    });
  });
});
