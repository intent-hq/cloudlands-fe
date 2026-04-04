/**
 * Tests for WorkspaceStorageManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceStorageManager } from '../workspace-storage-manager';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });

describe('WorkspaceStorageManager', () => {
  let manager: WorkspaceStorageManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLocalStorage.clear();
    vi.clearAllMocks();
    manager = new WorkspaceStorageManager();
  });

  afterEach(() => {
    manager.cleanup();
    vi.useRealTimers();
  });

  describe('saveState', () => {
    it('should save state to localStorage with debounce', () => {
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'ready' } });

      // Should not save immediately
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();

      // Advance timer
      vi.advanceTimersByTime(300);

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });

    it('should save immediately when immediate=true', () => {
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'ready' } }, true);
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });

    it('should not save without workspace ID', () => {
      manager.saveState('', { workspace: { id: '', status: 'ready' } });
      vi.advanceTimersByTime(300);
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    it('should merge updates with existing state', () => {
      // Save initial state
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'loading' } }, true);

      // Update state
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'ready' } }, true);

      const saved = JSON.parse(mockLocalStorage.setItem.mock.calls[1][1]);
      expect(saved.workspace.status).toBe('ready');
    });
  });

  describe('loadState', () => {
    it('should return null for empty workspace ID', () => {
      expect(manager.loadState('')).toBeNull();
    });

    it('should return null when no state exists', () => {
      expect(manager.loadState('ws-1')).toBeNull();
    });

    it('should load state from localStorage', () => {
      const state = {
        version: 2,
        workspace: { id: 'ws-1', status: 'ready' },
        mainPanel: { type: 'notes' },
        drawer: { open: false, type: null, itemId: null },
        navigation: { history: [], currentIndex: -1 },
        ui: { hasInitialized: true, lastUpdated: Date.now() },
      };
      mockLocalStorage.setItem('workspace:state:ws-1', JSON.stringify(state));

      const loaded = manager.loadState('ws-1');
      expect(loaded?.workspace.id).toBe('ws-1');
    });

    it('should use memory cache on subsequent loads', () => {
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'ready' } }, true);
      mockLocalStorage.getItem.mockClear();

      manager.loadState('ws-1');
      expect(mockLocalStorage.getItem).not.toHaveBeenCalled();
    });
  });

  describe('clearState', () => {
    it('should remove state from localStorage', () => {
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'ready' } }, true);
      manager.clearState('ws-1');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('workspace:state:ws-1');
    });

    it('should cancel pending saves', () => {
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'ready' } });
      manager.clearState('ws-1');
      vi.advanceTimersByTime(300);
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('migrateWorkspaceId', () => {
    it('should migrate state from old to new ID', () => {
      manager.saveState('old-id', { workspace: { id: 'old-id', status: 'ready' } }, true);
      manager.migrateWorkspaceId('old-id', 'new-id');

      expect(manager.loadState('new-id')).toBeDefined();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('workspace:state:old-id');
    });
  });

  describe('cleanup', () => {
    it('should clear timers and cache', () => {
      manager.saveState('ws-1', { workspace: { id: 'ws-1', status: 'ready' } });
      manager.cleanup();
      vi.advanceTimersByTime(300);
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });
  });
});
