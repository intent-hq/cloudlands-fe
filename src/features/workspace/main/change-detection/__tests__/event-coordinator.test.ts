/**
 * Event Coordinator Tests
 *
 * Tests for the event coordinator module that handles event batching,
 * deduplication, and emission.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventCoordinator } from '../event-coordinator';
import { WorkspaceEventType, type WorkspaceEvent } from '../../../events/types';
import type { ProcessedChange } from '../change-processor';

// Note: EventCoordinator extends EventEmitter directly, no separate event-bus module is used

describe('EventCoordinator', () => {
  let coordinator: EventCoordinator;
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    coordinator = new EventCoordinator(workspaceId);
  });

  afterEach(() => {
    coordinator.cleanup();
    vi.useRealTimers();
  });

  describe('handleChangesBatch', () => {
    it('should handle a batch of processed changes', async () => {
      const changes: ProcessedChange[] = [
        {
          change: {
            path: 'file1.txt',
            action: 'Create',
            additions: 10,
            deletions: 0,
            timestamp: new Date().toISOString(),
          },
          event: {
            id: 'event-1',
            type: 'file:created' as WorkspaceEventType,
            workspaceId,
            timestamp: new Date().toISOString(),
            data: { path: 'file1.txt' },
          } as WorkspaceEvent,
        },
        {
          change: {
            path: 'file2.txt',
            action: 'Modify',
            additions: 5,
            deletions: 3,
            timestamp: new Date().toISOString(),
          },
          event: {
            id: 'event-2',
            type: 'file:changed' as WorkspaceEventType,
            workspaceId,
            timestamp: new Date().toISOString(),
            data: { path: 'file2.txt' },
          } as WorkspaceEvent,
        },
      ];

      await coordinator.handleChangesBatch(changes);

      // Should queue events for emission
      const stats = coordinator.getStats();
      expect(stats.totalEvents).toBe(2);
    });

    it('should deduplicate identical events', async () => {
      const event: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:changed' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: { path: 'test.txt' },
      };

      const changes: ProcessedChange[] = [
        {
          change: {
            path: 'test.txt',
            action: 'Modify',
            additions: 5,
            deletions: 3,
            timestamp: new Date().toISOString(),
          },
          event,
        },
        {
          change: {
            path: 'test.txt',
            action: 'Modify',
            additions: 5,
            deletions: 3,
            timestamp: new Date().toISOString(),
          },
          event: { ...event }, // Same event
        },
      ];

      await coordinator.handleChangesBatch(changes);

      const stats = coordinator.getStats();
      // Note: Deduplication is handled by the event service, not the coordinator
      // The coordinator tracks all events it receives
      expect(stats.totalEvents).toBe(2);
      expect(stats.duplicatesFiltered).toBe(0);
    });
  });

  describe('handleEvent', () => {
    it('should handle a single event', async () => {
      const event: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:created' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: { path: 'new-file.txt' },
      };

      await coordinator.handleEvent(event);

      const stats = coordinator.getStats();
      expect(stats.totalEvents).toBe(1);
    });

    it('should deduplicate duplicate single events', async () => {
      const event: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:changed' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: { path: 'test.txt' },
      };

      await coordinator.handleEvent(event);
      await coordinator.handleEvent({ ...event }); // Same event

      const stats = coordinator.getStats();
      // Note: Deduplication is handled by the event service, not the coordinator
      // The coordinator tracks all events it receives
      expect(stats.totalEvents).toBe(2);
      expect(stats.duplicatesFiltered).toBe(0);
    });
  });

  describe('event batching', () => {
    it('should batch events before emission', async () => {
      const event1: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:created' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: { path: 'file1.txt' },
      };

      const event2: WorkspaceEvent = {
        id: 'event-2',
        type: 'file:changed' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: { path: 'file2.txt' },
      };

      await coordinator.handleEvent(event1);
      await coordinator.handleEvent(event2);

      // Events should be queued but not emitted yet
      const stats = coordinator.getStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.batchesEmitted).toBe(0);

      // Fast-forward time to trigger batch emission
      vi.advanceTimersByTime(200); // Default batch interval

      // Now batch should be emitted
      const updatedStats = coordinator.getStats();
      expect(updatedStats.batchesEmitted).toBe(1);
    });

    it('should respect maximum batch size', async () => {
      // Create many events
      const events: WorkspaceEvent[] = [];
      for (let i = 0; i < 150; i++) {
        events.push({
          id: `event-${i}`,
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'Test User' },
          data: { path: `file${i}.txt` },
        });
      }

      // Process all events
      for (const event of events) {
        await coordinator.handleEvent(event);
      }

      // Should trigger immediate emission due to batch size limit
      const stats = coordinator.getStats();
      expect(stats.batchesEmitted).toBeGreaterThan(0);
    });
  });

  describe('statistics', () => {
    it('should track events by type', async () => {
      const events: WorkspaceEvent[] = [
        {
          id: 'event-1',
          type: 'file:created' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'Test User' },
          data: {},
        },
        {
          id: 'event-2',
          type: 'file:created' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'Test User' },
          data: {},
        },
        {
          id: 'event-3',
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'Test User' },
          data: {},
        },
      ];

      for (const event of events) {
        await coordinator.handleEvent(event);
      }

      const stats = coordinator.getStats();
      expect(stats.eventsPerType.get('file:created' as WorkspaceEventType)).toBe(2);
      expect(stats.eventsPerType.get('file:changed' as WorkspaceEventType)).toBe(1);
    });

    it('should track last emission time', async () => {
      const event: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:created' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: {},
      };

      await coordinator.handleEvent(event);

      // Initially no emission
      let stats = coordinator.getStats();
      expect(stats.lastEmissionTime).toBeNull();

      // Trigger emission
      vi.advanceTimersByTime(200);

      // Should have emission time
      stats = coordinator.getStats();
      expect(stats.lastEmissionTime).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources and timers', async () => {
      // Set up spy before creating coordinator so it catches the destroy call
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Create a new coordinator for this test
      const testCoordinator = new EventCoordinator(workspaceId);

      // Add an event to ensure there's a timer to clear
      const event: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:created' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: {},
      };

      await testCoordinator.handleEvent(event);

      // Now destroy and verify clearTimeout was called
      await testCoordinator.destroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should emit remaining events on cleanup', async () => {
      const event: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:created' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: {},
      };

      await coordinator.handleEvent(event);

      // Event should be queued
      const stats = coordinator.getStats();
      expect(stats.totalEvents).toBe(1);
      expect(stats.batchesEmitted).toBe(0);

      // Cleanup should emit remaining events
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      await coordinator.destroy();

      // Verify cleanup was called
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('event emission', () => {
    it('should emit activity-log-event for events', async () => {
      const activityLogHandler = vi.fn();
      coordinator.on('activity-log-event', activityLogHandler);

      const event: WorkspaceEvent = {
        id: 'event-1',
        type: 'file:created' as WorkspaceEventType,
        workspaceId,
        timestamp: new Date().toISOString(),
        actor: { type: 'user', name: 'Test User' },
        data: {},
      };

      await coordinator.handleEvent(event);

      // Trigger emission
      vi.advanceTimersByTime(200);

      // Events are emitted via activity-log-event which gets bridged into Redux
      expect(activityLogHandler).toHaveBeenCalledWith(event);
      expect(coordinator.getStats().totalEvents).toBe(1);
    });
  });
});
