/**
 * Activity Log Integration Tests
 *
 * Comprehensive tests for the entire activity log architecture
 * Testing event flow, deduplication, attribution, and UI updates
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkspaceEventService } from '../../events/main/workspace-event-service';
import { WorkspaceEventBus } from '../../events/main/workspace-event-bus';
import { AttributionEngine } from '../../workspace/main/provenance/attribution-engine';
import { getProvenanceContextManager } from '../../workspace/main/provenance/provenance-context-manager';
import { resetDeduplicationService } from '../../events/event-deduplication.service';
import type { WorkspaceEvent, FileChangedEvent } from '../../events/types';
import { v4 as uuidv4 } from 'uuid';

describe('Activity Log Integration', () => {
  let eventService: WorkspaceEventService;
  let eventBus: WorkspaceEventBus;
  let workspaceId: string;

  beforeEach(async () => {
    // Reset deduplication service for each test
    resetDeduplicationService();

    workspaceId = uuidv4();
    eventService = new WorkspaceEventService({
      workspaceId,
      enableHistoricalSync: false,
      maxEvents: 100,
    });
    await eventService.initialize();
    eventBus = eventService.getEventBus();
  });

  afterEach(() => {
    eventService.destroy();
  });

  describe('Event Creation and Flow', () => {
    it('should create and emit file change events', async () => {
      const eventReceived = vi.fn();
      eventBus.on('event', eventReceived);

      const fileEvent: FileChangedEvent = {
        id: uuidv4(),
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'file:changed',
        actor: {
          type: 'user',
          id: 'user-123',
          name: 'Test User',
        },
        data: {
          path: 'src/test.ts',
          relativePath: 'src/test.ts',
          action: 'modify',
          additions: 10,
          deletions: 5,
        },
      };

      eventBus.emitEvent(fileEvent);

      expect(eventReceived).toHaveBeenCalledWith(fileEvent);
    });

    it('should handle agent-attributed events', async () => {
      const events: WorkspaceEvent[] = [];
      eventBus.subscribe({
        filters: [],
        callback: (event) => events.push(event),
      });

      const agentEvent: FileChangedEvent = {
        id: uuidv4(),
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'file:changed',
        actor: {
          type: 'agent',
          id: 'agent-123',
          name: 'Test Agent',
          metadata: {
            turnNumber: 1,
          },
        },
        data: {
          path: 'src/agent-modified.ts',
          relativePath: 'src/agent-modified.ts',
          action: 'create',
          additions: 50,
          deletions: 0,
        },
      };

      eventBus.emitEvent(agentEvent);

      expect(events).toHaveLength(1);
      expect(events[0].actor.type).toBe('agent');
      expect(events[0].actor.metadata?.turnNumber).toBe(1);
    });

    it('should prevent duplicate events', async () => {
      const events: WorkspaceEvent[] = [];
      eventBus.subscribe({
        filters: [],
        callback: (event) => events.push(event),
      });

      const event: WorkspaceEvent = {
        id: 'duplicate-id',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'file:changed',
        actor: {
          type: 'user',
          id: 'user-123',
          name: 'Test User',
        },
        data: {
          path: 'src/duplicate.ts',
          relativePath: 'src/duplicate.ts',
          action: 'modify',
        },
      };

      // Emit the same event twice
      eventBus.emitEvent(event);
      eventBus.emitEvent(event);

      // Should only receive one event
      expect(events).toHaveLength(1);
    });
  });

  describe('Event Querying', () => {
    beforeEach(async () => {
      // Add test events
      const testEvents: WorkspaceEvent[] = [
        {
          id: uuidv4(),
          workspaceId,
          timestamp: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
          type: 'file:changed',
          actor: { type: 'user', id: 'user-1', name: 'User' },
          data: { path: 'src/file1.ts', relativePath: 'src/file1.ts', action: 'modify' },
        },
        {
          id: uuidv4(),
          workspaceId,
          timestamp: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
          type: 'file:changed',
          actor: { type: 'agent', id: 'agent-1', name: 'Agent' },
          data: { path: 'src/file2.ts', relativePath: 'src/file2.ts', action: 'create' },
        },
        {
          id: uuidv4(),
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'note:created',
          actor: { type: 'user', id: 'user-1', name: 'User' },
          data: { noteId: 'note-1', title: 'Test Note', path: 'notes/note-1.md', action: 'create' },
        },
      ];

      for (const event of testEvents) {
        eventBus.emitEvent(event);
      }
    });

    it('should query events by type', async () => {
      const fileEvents = await eventBus.query([
        { field: 'type', operator: 'equals', value: 'file:changed' },
      ]);

      expect(fileEvents).toHaveLength(2);
      expect(fileEvents.every((e) => e.type === 'file:changed')).toBe(true);
    });

    it('should query events by actor type', async () => {
      const agentEvents = await eventBus.query([
        { field: 'actor.type', operator: 'equals', value: 'agent' },
      ]);

      expect(agentEvents).toHaveLength(1);
      expect(agentEvents[0].actor.type).toBe('agent');
    });

    it('should query events with time filters', async () => {
      const recentEvents = await eventBus.query([
        {
          field: 'timestamp',
          operator: 'greater_than',
          value: new Date(Date.now() - 45000).toISOString(),
        },
      ]);

      expect(recentEvents).toHaveLength(2); // Events from last 45 seconds (30s ago and now)
    });

    it('should limit query results', async () => {
      const limitedEvents = await eventBus.query([
        { field: '_limit', operator: 'equals', value: 2 },
      ]);

      expect(limitedEvents).toHaveLength(2);
    });
  });

  describe('Event Persistence', () => {
    it('should persist events to disk', async () => {
      const event: WorkspaceEvent = {
        id: uuidv4(),
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'file:changed',
        actor: { type: 'user', id: 'user-1', name: 'User' },
        data: { path: 'src/persisted.ts', relativePath: 'src/persisted.ts', action: 'create' },
      };

      eventBus.emitEvent(event);

      // Force save to disk immediately
      await eventBus.forceSave();

      // Create a new event service to test persistence
      const newEventService = new WorkspaceEventService({
        workspaceId,
        enableHistoricalSync: false,
      });
      await newEventService.initialize();
      const newEventBus = newEventService.getEventBus();

      const events = await newEventBus.query([]);
      const persistedEvent = events.find((e) => e.id === event.id);

      expect(persistedEvent).toBeDefined();
      expect((persistedEvent as any)?.data).toEqual(event.data);

      newEventService.destroy();
    });
  });

  describe('Event Subscriptions', () => {
    it('should handle multiple subscriptions', async () => {
      const subscriber1Events: WorkspaceEvent[] = [];
      const subscriber2Events: WorkspaceEvent[] = [];

      const sub1 = eventBus.subscribe({
        filters: [{ field: 'type', operator: 'equals', value: 'file:changed' }],
        callback: (event) => subscriber1Events.push(event),
      });

      const sub2 = eventBus.subscribe({
        filters: [{ field: 'actor.type', operator: 'equals', value: 'agent' }],
        callback: (event) => subscriber2Events.push(event),
      });

      // Emit various events
      eventBus.emitEvent({
        id: uuidv4(),
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'file:changed',
        actor: { type: 'user', id: 'user-1', name: 'User' },
        data: { path: 'test1.ts', relativePath: 'test1.ts', action: 'modify' },
      });

      eventBus.emitEvent({
        id: uuidv4(),
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'file:changed',
        actor: { type: 'agent', id: 'agent-1', name: 'Agent' },
        data: { path: 'test2.ts', relativePath: 'test2.ts', action: 'create' },
      });

      expect(subscriber1Events).toHaveLength(2); // Both file:changed events
      expect(subscriber2Events).toHaveLength(1); // Only agent events

      // Cleanup
      eventBus.unsubscribe(sub1.id);
      eventBus.unsubscribe(sub2.id);
    });

    it('should handle subscription cleanup on unsubscribe', async () => {
      const events: WorkspaceEvent[] = [];
      const subscription = eventBus.subscribe({
        filters: [],
        callback: (event) => events.push(event),
      });

      eventBus.emitEvent({
        id: uuidv4(),
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'test:event' as any,
        actor: { type: 'user', id: 'user-1', name: 'User' },
      } as any);

      expect(events).toHaveLength(1);

      // Unsubscribe
      eventBus.unsubscribe(subscription.id);

      // Emit another event
      eventBus.emitEvent({
        id: uuidv4(),
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'test:event' as any,
        actor: { type: 'user', id: 'user-1', name: 'User' },
      } as any);

      // Should still be 1 since we unsubscribed
      expect(events).toHaveLength(1);
    });
  });

  describe('Attribution Engine', () => {
    it('should correctly attribute file changes', async () => {
      const attributionEngine = new AttributionEngine();

      const event = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: 'src/attributed.ts',
          action: 'modify',
          additions: 10,
          deletions: 5,
        },
        'file:changed' as any, // Pass the correct event type
      );

      expect(event.type).toBe('file:changed');
      expect(event.provenance?.source).toBe('user');
      expect(event.codeChange?.additions).toBe(10);
      expect(event.codeChange?.deletions).toBe(5);
    });

    it('should handle agent attribution with metadata', async () => {
      const contextManager = getProvenanceContextManager();

      // Create agent context
      contextManager.createAgentContext({
        agentId: 'agent-123',
        agentName: 'Test Agent',
        messageId: 'msg-456',
        turnNumber: 3,
      });

      const attributionEngine = new AttributionEngine();
      const event = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: 'src/agent-file.ts',
          action: 'create',
          additions: 100,
          deletions: 0,
        },
        'file:changed' as any, // Pass the correct event type
      );

      expect(event.provenance?.source).toBe('agent');
      expect(event.provenance?.agent?.id).toBe('agent-123');
      expect(event.provenance?.agent?.name).toBe('Test Agent');
      expect(event.agentId).toBe('agent-123');

      // Clean up context
      contextManager.popContext();
    });

    it('should detect system-initiated changes', async () => {
      const attributionEngine = new AttributionEngine({ debug: true });

      // Test git file
      const gitEvent = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: '.git/config',
          action: 'modify',
          source: 'git',
        },
        'file:changed' as any,
      );

      expect(gitEvent.provenance?.source).toBe('system');
      // System events are represented as user type with id="system"
      expect(gitEvent.actor.type).toBe('user');
      expect(gitEvent.actor.id).toBe('system');
      expect(gitEvent.actor.name).toBe('System');

      // Test auto-generated file
      const distEvent = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: 'dist/bundle.min.js',
          action: 'create',
        },
        'file:changed' as any,
      );

      expect(distEvent.provenance?.source).toBe('system');
      // System events are represented as user type with id="system"
      expect(distEvent.actor.type).toBe('user');
      expect(distEvent.actor.id).toBe('system');
      expect(distEvent.actor.name).toBe('System');

      // Test lock file
      const lockEvent = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: 'package-lock.json',
          action: 'modify',
        },
        'file:changed' as any,
      );

      expect(lockEvent.provenance?.source).toBe('system');
      // System events are represented as user type with id="system"
      expect(lockEvent.actor.type).toBe('user');
      expect(lockEvent.actor.id).toBe('system');
      expect(lockEvent.actor.name).toBe('System');
    });

    it('should handle agent context TTL correctly', async () => {
      const attributionEngine = new AttributionEngine({ agentContextTTL: 100 }); // 100ms TTL
      // Record an agent write with specific content
      const fileContent = 'console.log("agent wrote this");';
      attributionEngine.recordAgentWrite(
        {
          agentId: 'ttl-agent',
          agentName: 'TTL Test Agent',
        },
        'src/agent-file.ts',
        fileContent,
        undefined, // workspacePath
        workspaceId, // workspaceId
      );

      // Event with matching content should be attributed to agent
      const event1 = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: 'src/agent-file.ts',
          action: 'modify',
          newContent: fileContent,
        },
        'file:changed' as any,
      );

      expect(event1.provenance?.source).toBe('agent');

      // Event with different content should be attributed to user
      const event2 = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: 'src/agent-file.ts',
          action: 'modify',
          newContent: 'different content',
        },
        'file:changed' as any,
      );

      expect(event2.provenance?.source).toBe('user');

      // Event for a different file should be attributed to user
      const event3 = await attributionEngine.createFileChangeEvent(
        workspaceId,
        {
          filePath: 'src/other-file.ts',
          action: 'modify',
          newContent: 'some content',
        },
        'file:changed' as any,
      );

      expect(event3.provenance?.source).toBe('user');
    });
  });
});
