/**
 * Tests for Terminal Buffer Manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalBufferManager } from '../terminal-buffer-manager';
import { installLocalStorageMock } from '$lib/store/utils/test-helpers/local-storage-mock';

// Mock the Logger
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const localStorageMock = installLocalStorageMock();

// Mock navigator.storage
Object.defineProperty(global, 'navigator', {
  value: {
    storage: {
      estimate: vi.fn().mockResolvedValue({ quota: 10000000, usage: 0 }),
    },
  },
});

describe('TerminalBufferManager', () => {
  let manager: TerminalBufferManager;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    manager = new TerminalBufferManager('workspace-1', 'terminal-1');
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('saveBuffer', () => {
    it('should save buffer to localStorage', async () => {
      const lines = ['line 1', 'line 2', 'line 3'];
      const result = await manager.saveBuffer(lines, 0, 2);
      expect(result).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it('should trim trailing empty lines', async () => {
      const lines = ['line 1', 'line 2', '', ''];
      await manager.saveBuffer(lines, 0, 1);
      const stored = localStorageMock.setItem.mock.calls[0][1];
      const snapshot = JSON.parse(stored);
      expect(snapshot.lines).toEqual(['line 1', 'line 2']);
    });

    it('should limit line length', async () => {
      const longLine = 'x'.repeat(2000);
      const lines = [longLine];
      await manager.saveBuffer(lines, 0, 0);
      const stored = localStorageMock.setItem.mock.calls[0][1];
      const snapshot = JSON.parse(stored);
      expect(snapshot.lines[0].length).toBeLessThanOrEqual(1001); // 1000 + ellipsis
    });
  });

  describe('restoreBuffer', () => {
    it('should restore saved buffer', async () => {
      const lines = ['line 1', 'line 2'];
      await manager.saveBuffer(lines, 5, 1);

      const restored = await manager.restoreBuffer();
      expect(restored).not.toBeNull();
      expect(restored?.lines).toEqual(lines);
      expect(restored?.cursorX).toBe(5);
      expect(restored?.cursorY).toBe(1);
    });

    it('should return null for non-existent buffer', async () => {
      const restored = await manager.restoreBuffer();
      expect(restored).toBeNull();
    });

    it('should reject old snapshots', async () => {
      const oldSnapshot = {
        lines: ['old line'],
        cursorX: 0,
        cursorY: 0,
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        version: 1,
      };
      localStorageMock.setItem(
        'terminal-buffer-workspace-1-terminal-1',
        JSON.stringify(oldSnapshot),
      );

      const restored = await manager.restoreBuffer();
      expect(restored).toBeNull();
    });
  });

  describe('clearBuffer', () => {
    it('should clear saved buffer', async () => {
      await manager.saveBuffer(['line 1'], 0, 0);
      await manager.clearBuffer();
      const restored = await manager.restoreBuffer();
      expect(restored).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return stats for saved buffer', async () => {
      await manager.saveBuffer(['line 1', 'line 2'], 0, 1);
      const stats = manager.getStats();
      expect(stats).not.toBeNull();
      expect(stats?.lineCount).toBe(2);
      expect(stats?.age).toBeLessThan(1000);
    });

    it('should return null for non-existent buffer', () => {
      const stats = manager.getStats();
      expect(stats).toBeNull();
    });
  });
});
