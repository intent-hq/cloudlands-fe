/**
 * Event Store Memory Management Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventStore } from '../main/event-store';
import { WorkspaceEvent, WorkspaceEventType } from '../types';

describe('EventStore Memory Management', () => {
  let store: EventStore;
  const workspaceId = 'test-workspace';

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up
    if (store) {
      await store.clear();
    }
  });

  describe('Memory Limits', () => {
    it('should respect maxEvents limit', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 10,
        persistToDisk: false,
      });

      // Add 15 events
      for (let i = 0; i < 15; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'test' },
          data: { path: `file-${i}.ts` },
        };
        store.add(event);
      }

      // Should only have 10 events
      const allEvents = store.getAll();
      expect(allEvents.length).toBe(10);

      // Should have kept the most recent events
      expect(allEvents[0].id).toBe('event-5');
      expect(allEvents[9].id).toBe('event-14');
    });

    it('should handle memory pressure', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 10000,
        persistToDisk: false,
      });

      // Add many large events to trigger memory pressure
      for (let i = 0; i < 5000; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'test' },
          data: {
            path: `file-${i}.ts`,
            // Large data payload
            content: 'x'.repeat(1000),
          },
        };
        store.add(event);
      }

      // Memory usage should be managed
      const usage = store.getMemoryUsage();
      expect(usage.eventCount).toBeLessThanOrEqual(5000);
    });

    it('should not retain pending append references when persistence is disabled', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 100,
        persistToDisk: false,
      });

      for (let i = 0; i < 25; i++) {
        store.add({
          id: `event-${i}`,
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'test' },
          data: { path: `file-${i}.ts`, diff: 'x'.repeat(100000) },
        });
      }

      expect((store as any).pendingEvents).toHaveLength(0);
      expect((store.getAll()[0].data as any).diff.length).toBeLessThan(100000);
    });

    it('should trigger compaction automatically', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 200,
        persistToDisk: false,
        compactOnSave: true,
      });

      // Add many events to trigger automatic compaction
      for (let i = 0; i < 150; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'test' },
          data: { path: `file-${i}.ts` },
        };
        store.add(event);
      }

      const allEvents = store.getAll();

      // Should have all events within limit
      expect(allEvents.length).toBeLessThanOrEqual(200);
      expect(allEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Index Management', () => {
    it('should maintain indexes correctly', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 100,
        persistToDisk: false,
        indexByType: true,
        indexByActor: true,
      });

      // Add events of different types
      const types: WorkspaceEventType[] = [
        'file:changed',
        'file:created',
        'file:deleted',
      ] as WorkspaceEventType[];

      for (let i = 0; i < 30; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: types[i % 3],
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: {
            type: i % 2 === 0 ? 'user' : 'agent',
            name: i % 2 === 0 ? 'user1' : 'agent1',
          },
          data: { path: `file-${i}.ts` },
        };
        store.add(event);
      }

      // Check type index
      const changedEvents = store.getByType('file:changed' as WorkspaceEventType);
      expect(changedEvents.length).toBe(10);

      // Check actor index
      const userEvents = store.getByActor('user', 'user1');
      expect(userEvents.length).toBe(15);

      const agentEvents = store.getByActor('agent', 'agent1');
      expect(agentEvents.length).toBe(15);
    });

    it('should clean up indexes when removing events', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 10,
        persistToDisk: false,
        indexByType: true,
      });

      // Add 20 events (will trigger removal of first 10)
      for (let i = 0; i < 20; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'test' },
          data: { path: `file-${i}.ts` },
        };
        store.add(event);
      }

      // First 10 events should be removed
      const event0 = store.getById('event-0');
      expect(event0).toBeUndefined();

      // Last 10 events should exist
      const event15 = store.getById('event-15');
      expect(event15).toBeDefined();

      // Memory usage should reflect correct counts
      const usage = store.getMemoryUsage();
      expect(usage.eventCount).toBe(10);
      expect((store as any).eventIndex.has('event-0')).toBe(false);
      expect((store as any).typeIndex.get('file:changed')?.has('event-0')).toBe(false);
    });

    it('should delete empty index buckets after stale events are removed', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 1,
        persistToDisk: false,
        indexByType: true,
        indexByActor: true,
      });

      store.add({
        id: 'old-event',
        type: 'file:created' as WorkspaceEventType,
        workspaceId,
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'agent', name: 'old-agent' },
        data: { path: 'old.ts' },
      });
      store.add({
        id: 'new-event',
        type: 'file:changed' as WorkspaceEventType,
        workspaceId,
        timestamp: '2026-01-02T00:00:00Z',
        actor: { type: 'user', name: 'new-user' },
        data: { path: 'new.ts' },
      });

      expect((store as any).typeIndex.has('file:created')).toBe(false);
      expect((store as any).actorIndex.has('agent:old-agent')).toBe(false);
      expect((store as any).dateIndex.has('2026-01-01')).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle rapid event addition', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 1000,
        persistToDisk: false,
      });

      const startTime = Date.now();

      // Add 1000 events rapidly
      for (let i = 0; i < 1000; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: 'file:changed' as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'test' },
          data: { path: `file-${i}.ts` },
        };
        store.add(event);
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);

      // All events should be stored
      expect(store.getAll().length).toBe(1000);
    });

    it('should query efficiently with indexes', async () => {
      store = new EventStore(workspaceId, {
        maxEvents: 5000,
        persistToDisk: false,
        indexByType: true,
      });

      // Add many events
      for (let i = 0; i < 5000; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: (i % 10 === 0 ? 'file:created' : 'file:changed') as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: { type: 'user', name: 'test' },
          data: { path: `file-${i}.ts` },
        };
        store.add(event);
      }

      const startTime = Date.now();

      // Query by type (should use index)
      const createdEvents = store.getByType('file:created' as WorkspaceEventType);

      const duration = Date.now() - startTime;

      // Query should be fast (< 10ms)
      expect(duration).toBeLessThan(10);
      expect(createdEvents.length).toBe(500);
    }, 30000);
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', async () => {
      store = new EventStore(workspaceId, {
        persistToDisk: false,
      });

      // Add various events
      for (let i = 0; i < 100; i++) {
        const event: WorkspaceEvent = {
          id: `event-${i}`,
          type: (i % 3 === 0
            ? 'file:created'
            : i % 3 === 1
              ? 'file:changed'
              : 'file:deleted') as WorkspaceEventType,
          workspaceId,
          timestamp: new Date().toISOString(),
          actor: {
            type: i % 2 === 0 ? 'user' : 'agent',
            name: i % 2 === 0 ? 'user1' : 'agent1',
          },
          data: { path: `file-${i}.ts` },
        };
        store.add(event);
      }

      const stats = store.getStatistics();

      expect(stats.totalEvents).toBe(100);
      expect(stats.eventsByType['file:created' as WorkspaceEventType]).toBe(34);
      expect(stats.eventsByType['file:changed' as WorkspaceEventType]).toBe(33);
      expect(stats.eventsByType['file:deleted' as WorkspaceEventType]).toBe(33);
      expect(stats.eventsByActor['user:user1']).toBe(50);
      expect(stats.eventsByActor['agent:agent1']).toBe(50);
    });
  });
});
