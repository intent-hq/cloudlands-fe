/**
 * Tests for EventPersistenceService
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import {
  EventPersistenceService,
  importEventsFromFile,
} from '../event-persistence';
import type { WorkspaceEvent } from '$features/events/types';
import { installLocalStorageMock } from '$store/renderer/utils/test-helpers/local-storage-mock';

// Mock browser environment
vi.mock('$app/environment', () => ({
  browser: true,
}));

const mockLocalStorage = installLocalStorageMock();

// Mock Blob
global.Blob = class MockBlob {
  content: string[];
  constructor(content: string[]) {
    this.content = content;
  }
  get size() {
    return this.content.join('').length;
  }
} as any;

describe('EventPersistenceService', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  const createMockEvent = (id: string): WorkspaceEvent =>
    ({
      id,
      workspaceId: 'ws-1',
      type: 'file:changed',
      timestamp: new Date().toISOString(),
      actor: { type: 'user' },
    }) as WorkspaceEvent;

  describe('constructor', () => {
    it('should create service with workspace ID', () => {
      const service = new EventPersistenceService('ws-1');
      expect(service).toBeDefined();
    });
  });

  describe('saveEvents', () => {
    it('should save events to localStorage', async () => {
      const service = new EventPersistenceService('ws-1');
      const events = [createMockEvent('evt-1'), createMockEvent('evt-2')];

      await service.saveEvents(events);

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
      expect(savedData.events).toHaveLength(2);
      expect(savedData.version).toBe(1);
    });

    it('should limit stored events to MAX_STORED_EVENTS', async () => {
      const service = new EventPersistenceService('ws-1');
      const events = Array.from({ length: 600 }, (_, i) => createMockEvent(`evt-${i}`));

      await service.saveEvents(events);

      const savedData = JSON.parse(mockLocalStorage.setItem.mock.calls[0][1]);
      expect(savedData.events.length).toBeLessThanOrEqual(500);
    });
  });

  describe('loadEvents', () => {
    it('should load events from localStorage', async () => {
      const service = new EventPersistenceService('ws-1');
      const events = [createMockEvent('evt-1')];

      mockLocalStorage.setItem(
        'workspace-events-ws-1',
        JSON.stringify({
          version: 1,
          events,
          lastUpdated: new Date().toISOString(),
        }),
      );

      const loaded = await service.loadEvents();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('evt-1');
    });

    it('should return empty array if no stored events', async () => {
      const service = new EventPersistenceService('ws-1');
      const loaded = await service.loadEvents();
      expect(loaded).toEqual([]);
    });

    it('should clear and return empty on version mismatch', async () => {
      const service = new EventPersistenceService('ws-1');
      mockLocalStorage.setItem(
        'workspace-events-ws-1',
        JSON.stringify({
          version: 999,
          events: [createMockEvent('evt-1')],
          lastUpdated: new Date().toISOString(),
        }),
      );

      const loaded = await service.loadEvents();
      expect(loaded).toEqual([]);
      expect(mockLocalStorage.removeItem).toHaveBeenCalled();
    });
  });

  describe('clearEvents', () => {
    it('should remove events from localStorage', () => {
      const service = new EventPersistenceService('ws-1');
      service.clearEvents();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('workspace-events-ws-1');
    });
  });

  describe('getStorageInfo', () => {
    it('should return storage info', () => {
      const service = new EventPersistenceService('ws-1');
      mockLocalStorage.setItem('workspace-events-ws-1', JSON.stringify({ events: [] }));
      const info = service.getStorageInfo();
      expect(info).toBeDefined();
      expect(info?.used).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('importEventsFromFile', () => {
  it('should import events from valid file', async () => {
    const mockFile = {
      text: vi.fn().mockResolvedValue(JSON.stringify({ events: [{ id: 'evt-1' }] })),
    } as unknown as File;

    const events = await importEventsFromFile(mockFile);
    expect(events).toHaveLength(1);
  });

  it('should throw on invalid file format', async () => {
    const mockFile = {
      text: vi.fn().mockResolvedValue(JSON.stringify({ invalid: true })),
    } as unknown as File;

    await expect(importEventsFromFile(mockFile)).rejects.toThrow('Invalid event file format');
  });
});
