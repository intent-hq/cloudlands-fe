/**
 * Event System Integration Tests
 *
 * Tests the complete event flow from file changes to UI updates
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkspaceEventBus } from '../src/features/events/workspace-event-bus';
import { WorkspaceEventService } from '../src/features/events/workspace-event-service';
import { EventCoordinator } from '../src/features/workspace/change-detection/event-coordinator';
import { ChangeDetectorRefactored } from '../src/features/workspace/change-detector-refactored';
import {
  WorkspaceEventType,
  type FileChangedEvent,
} from '../src/features/events/types';
import type { ProcessedChange } from '../src/features/workspace/types';
import { resetDeduplicationService } from '../src/features/events/event-deduplication.service';

// Mock dependencies
vi.mock('../src/shared/logger', () => ({
  Logger: class {
    constructor(public name: string) {}
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  },
}));

vi.mock('../src/features/events/event-store', () => ({
  EventStore: class {
    constructor() {}
    addEvent = vi.fn();
    getEvents = vi.fn().mockReturnValue([]);
    queryEvents = vi.fn().mockReturnValue([]);
    getEventCount = vi.fn().mockReturnValue(0);
    clearEvents = vi.fn();
    destroy = vi.fn();
  },
}));

vi.mock('../src/features/workspace/git-service', () => ({
  GitService: class {
    constructor() {}
    getStatus = vi.fn().mockResolvedValue({ files: [] });
    getDiff = vi.fn().mockResolvedValue('');
  },
}));

vi.mock('../src/features/file-tracking/file-tracking-storage', () => ({
  FileTrackingStorage: class {
    constructor() {}
    getTrackedChanges = vi.fn().mockResolvedValue({ files: [] });
    saveTrackedChanges = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('Event System Integration', () => {
  const workspaceId = 'test-workspace-integration';
  let eventBus: WorkspaceEventBus;
  let eventService: WorkspaceEventService;
  let eventCoordinator: EventCoordinator;
  let changeDetector: ChangeDetectorRefactored;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset deduplication service to ensure clean state
    resetDeduplicationService();

    // Create instances
    eventBus = new WorkspaceEventBus(workspaceId);
    changeDetector = new ChangeDetectorRefactored({
      workspaceId,
      workspacePath: '/test/path',
    });
    eventService = new WorkspaceEventService({
      workspaceId,
      eventBus, // Pass the event bus to ensure same instance
      changeDetector, // Pass the change detector directly
    });
    eventCoordinator = new EventCoordinator(workspaceId);

    // Initialize the event service to set up listeners
    await eventService.initialize();

    // Connect the coordinator's activity-log-event to the change detector
    // This simulates the real app flow:
    // EventCoordinator -> 'activity-log-event' -> ChangeDetector -> 'activity-log-event' -> WorkspaceEventService
    eventCoordinator.on('activity-log-event', (event) => {
      changeDetector.emit('activity-log-event', event);
    });
  });

  afterEach(() => {
    // Clean up
    eventCoordinator.destroy();
    // Note: eventBus and changeDetector don't have destroy methods
  });

  describe('Full Event Flow', () => {
    it.skip('should handle file change from detection to subscription', async () => {
      const callback = vi.fn();

      // Subscribe to file change events
      eventBus.subscribe({
        filters: [{ type: WorkspaceEventType.FileModified }],
        callback,
      });

      // Simulate a file change
      const change: ProcessedChange = {
        event: {
          id: 'file-change-1',
          workspaceId,
          timestamp: new Date().toISOString(),
          type: WorkspaceEventType.FileModified,
          actor: { type: 'user', id: 'test-user', name: 'Test User' },
          data: {
            path: 'src/app.ts',
            action: 'modify',
            changes: {
              additions: 5,
              deletions: 2,
            },
          },
          metadata: { filePath: 'src/app.ts' },
        } as FileChangedEvent,
        metadata: {
          gitStatus: 'M',
          diff: '+ added line\n- removed line',
        },
      };

      // Process the change through the coordinator
      await eventCoordinator.handleChangesBatch([change]);

      // Wait for batching
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify the event was received
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(change.event);
    });

    it.skip('should handle multiple file changes in batch', async () => {
      const callback = vi.fn();

      // Subscribe to all events
      eventBus.subscribe({
        filters: [],
        callback,
      });

      // Create multiple changes
      const changes: ProcessedChange[] = [
        {
          event: {
            id: 'batch-1',
            workspaceId,
            timestamp: new Date().toISOString(),
            type: WorkspaceEventType.FileModified,
            actor: { type: 'user', id: 'test-user', name: 'Test User' },
            data: { path: 'file1.ts', action: 'modify' },
            metadata: { filePath: 'file1.ts' },
          } as FileChangedEvent,
          metadata: {},
        },
        {
          event: {
            id: 'batch-2',
            workspaceId,
            timestamp: new Date().toISOString(),
            type: WorkspaceEventType.FileModified,
            actor: { type: 'user', id: 'test-user', name: 'Test User' },
            data: { path: 'file2.ts', action: 'create' },
            metadata: { filePath: 'file2.ts' },
          } as FileChangedEvent,
          metadata: {},
        },
        {
          event: {
            id: 'batch-3',
            workspaceId,
            timestamp: new Date().toISOString(),
            type: WorkspaceEventType.FileModified,
            actor: { type: 'user', id: 'test-user', name: 'Test User' },
            data: { path: 'file3.ts', action: 'delete' },
            metadata: { filePath: 'file3.ts' },
          } as FileChangedEvent,
          metadata: {},
        },
      ];

      // Process all changes
      await eventCoordinator.handleChangesBatch(changes);

      // Wait for batching
      await new Promise((resolve) => setTimeout(resolve, 150));

      // All events should be received
      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith(changes[0].event);
      expect(callback).toHaveBeenCalledWith(changes[1].event);
      expect(callback).toHaveBeenCalledWith(changes[2].event);
    });

    it('should filter events by type correctly', async () => {
      const fileCallback = vi.fn();
      const allCallback = vi.fn();

      // Subscribe to file events only - using proper EventFilter format
      eventBus.subscribe({
        filters: [{ field: 'type', operator: 'equals', value: 'file:changed' }],
        callback: fileCallback,
      });

      // Subscribe to all events
      eventBus.subscribe({
        filters: [],
        callback: allCallback,
      });

      // Emit different types of file events directly to the bus
      const modifyEvent: FileChangedEvent = {
        id: 'filter-modify-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'test-user', name: 'Test User' },
        data: { path: 'test.ts', action: 'modify' },
        metadata: { filePath: 'test.ts' },
      };

      const createEvent: FileChangedEvent = {
        id: 'filter-create-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'test-user', name: 'Test User' },
        data: { path: 'new.ts', action: 'create' },
        metadata: { filePath: 'new.ts' },
      };

      // Emit events directly
      eventBus.emitEvent(modifyEvent);
      eventBus.emitEvent(createEvent);

      // Verify correct filtering
      expect(fileCallback).toHaveBeenCalledTimes(2);
      expect(fileCallback).toHaveBeenCalledWith(modifyEvent);
      expect(fileCallback).toHaveBeenCalledWith(createEvent);

      expect(allCallback).toHaveBeenCalledTimes(2);
      expect(allCallback).toHaveBeenCalledWith(modifyEvent);
      expect(allCallback).toHaveBeenCalledWith(createEvent);
    });

    it.skip('should handle rapid successive changes correctly', async () => {
      const callback = vi.fn();

      eventBus.subscribe({
        filters: [],
        callback,
      });

      // Simulate rapid file saves
      for (let i = 0; i < 5; i++) {
        const change: ProcessedChange = {
          event: {
            id: `rapid-${i}`,
            workspaceId,
            timestamp: new Date().toISOString(),
            type: WorkspaceEventType.FileModified,
            actor: { type: 'user', id: 'test-user', name: 'Test User' },
            data: { path: `file${i}.ts`, action: 'modify' },
            metadata: { filePath: `file${i}.ts` }, // Different files
          } as FileChangedEvent,
          metadata: {},
        };

        await eventCoordinator.handleChangesBatch([change]);
        // Small delay between saves
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Wait for all batches to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // All 5 events should be received (different files)
      expect(callback).toHaveBeenCalledTimes(5);
    });

    it('should deduplicate identical events within window', async () => {
      const callback = vi.fn();

      eventBus.subscribe({
        filters: [],
        callback,
      });

      // Same file, same action, within deduplication window
      const event: FileChangedEvent = {
        id: 'dedup-test-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'test-user', name: 'Test User' },
        data: { path: 'same-file.ts', action: 'modify' },
        metadata: { filePath: 'same-file.ts' },
      };

      // Emit the same event multiple times rapidly
      eventBus.emitEvent(event);
      eventBus.emitEvent({ ...event, id: 'dedup-test-2' }); // Different ID, same content
      eventBus.emitEvent({ ...event, id: 'dedup-test-3' });

      // Only first event should be received
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(event);
    });
  });

  describe('Error Handling', () => {
    it('should handle subscriber errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Subscriber error');
      });
      const normalCallback = vi.fn();

      // Subscribe with error-throwing callback
      eventBus.subscribe({
        filters: [],
        callback: errorCallback,
      });

      // Subscribe with normal callback
      eventBus.subscribe({
        filters: [],
        callback: normalCallback,
      });

      const event: FileChangedEvent = {
        id: 'error-test-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: WorkspaceEventType.FileModified,
        actor: { type: 'user', id: 'test-user', name: 'Test User' },
        data: { path: 'test.ts', action: 'modify' },
        metadata: { filePath: 'test.ts' },
      };

      // Emit event directly to bus
      eventBus.emitEvent(event);

      // Both callbacks should be called despite error
      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(normalCallback).toHaveBeenCalledTimes(1);
      expect(normalCallback).toHaveBeenCalledWith(event);

      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });
});
