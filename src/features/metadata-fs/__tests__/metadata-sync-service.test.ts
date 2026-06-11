import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────
const { mockRpcClient, mockFs } = vi.hoisted(() => {
  const directoryChangesHandlers: Array<(event: unknown) => void> = [];
  const closeHandlers: Array<() => void> = [];

  return {
    mockRpcClient: {
      listDir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      watchDirectory: vi.fn(),
      watchDirectoryUnsubscribe: vi.fn(),
      onDirectoryChanges: vi.fn((handler: (event: unknown) => void) => {
        directoryChangesHandlers.push(handler);
      }),
      removeDirectoryChangesListener: vi.fn((handler: (event: unknown) => void) => {
        const idx = directoryChangesHandlers.indexOf(handler);
        if (idx >= 0) directoryChangesHandlers.splice(idx, 1);
      }),
      onClose: vi.fn((handler: () => void) => {
        closeHandlers.push(handler);
      }),
      removeCloseListener: vi.fn((handler: () => void) => {
        const idx = closeHandlers.indexOf(handler);
        if (idx >= 0) closeHandlers.splice(idx, 1);
      }),
      isConnected: vi.fn().mockReturnValue(true),
      // Helpers for tests to trigger events
      _directoryChangesHandlers: directoryChangesHandlers,
      _closeHandlers: closeHandlers,
    },
    mockFs: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    },
  };
});

// Mock remote RPC manager
vi.mock('$shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: {
    getClient: vi.fn().mockResolvedValue(mockRpcClient),
  },
}));

// Mock Logger
vi.mock('$shared/logger', () => ({
  Logger: class {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => mockFs);

import { MetadataSyncService } from '../main/metadata-sync-service';
import type { MetadataSyncConfig } from '../main/metadata-sync-service';

describe('MetadataSyncService', () => {
  let service: MetadataSyncService;
  const config: MetadataSyncConfig = {
    workspaceId: 'test-workspace',
    remoteWorkspacePath: '/home/user/.intent-workspaces/test-workspace/.workspace',
    localCachePath: '/local/workspaces/test-workspace/.workspace',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockRpcClient._directoryChangesHandlers.length = 0;
    mockRpcClient._closeHandlers.length = 0;

    // Restore getClient mock (tests that use mockImplementation leak to next test)
    const { remoteRPCManager } = await import('$shared/main/remote-rpc-manager');
    (remoteRPCManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockRpcClient);

    // Restore handler registration mocks (clearAllMocks preserves these, but
    // if a test called mockImplementation they'd be overridden)
    mockRpcClient.onDirectoryChanges.mockImplementation((handler: (event: unknown) => void) => {
      mockRpcClient._directoryChangesHandlers.push(handler);
    });
    mockRpcClient.removeDirectoryChangesListener.mockImplementation((handler: (event: unknown) => void) => {
      const idx = mockRpcClient._directoryChangesHandlers.indexOf(handler);
      if (idx >= 0) mockRpcClient._directoryChangesHandlers.splice(idx, 1);
    });
    mockRpcClient.onClose.mockImplementation((handler: () => void) => {
      mockRpcClient._closeHandlers.push(handler);
    });
    mockRpcClient.removeCloseListener.mockImplementation((handler: () => void) => {
      const idx = mockRpcClient._closeHandlers.indexOf(handler);
      if (idx >= 0) mockRpcClient._closeHandlers.splice(idx, 1);
    });

    // Default mock responses
    mockRpcClient.listDir.mockResolvedValue({ entries: [] });
    mockRpcClient.watchDirectory.mockResolvedValue({ subscriptionId: 'sub-123' });
    mockRpcClient.watchDirectoryUnsubscribe.mockResolvedValue(undefined);
    mockRpcClient.readFile.mockResolvedValue({ content: 'file content', size: 12, truncated: false });
    mockFs.readdir.mockResolvedValue([]);

    service = new MetadataSyncService(config);
  });

  afterEach(async () => {
    await service.stop();
    vi.useRealTimers();
  });

  // ── Lifecycle ──────────────────────────────────────────────────────

  describe('start/stop', () => {
    it('starts and sets isRunning to true', async () => {
      expect(service.getIsRunning()).toBe(false);
      await service.start();
      expect(service.getIsRunning()).toBe(true);
    });

    it('stops and sets isRunning to false', async () => {
      await service.start();
      await service.stop();
      expect(service.getIsRunning()).toBe(false);
    });

    it('is idempotent — calling start twice does not double-subscribe', async () => {
      await service.start();
      await service.start();
      expect(mockRpcClient.watchDirectory).toHaveBeenCalledTimes(1);
    });

    it('stops the previous service for a workspace before starting a replacement', async () => {
      await service.start();

      const replacement = new MetadataSyncService(config);
      await replacement.start();
      service = replacement;

      expect(mockRpcClient.removeDirectoryChangesListener).toHaveBeenCalledTimes(1);
      expect(mockRpcClient.removeCloseListener).toHaveBeenCalledTimes(1);
      expect(mockRpcClient.watchDirectoryUnsubscribe).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
      });
      expect(mockRpcClient._directoryChangesHandlers).toHaveLength(1);
      expect(mockRpcClient._closeHandlers).toHaveLength(1);
    });

    it('emits sync:started and sync:complete on successful start', async () => {
      const events: string[] = [];
      service.on('sync:started', () => events.push('started'));
      service.on('sync:complete', () => events.push('complete'));

      await service.start();

      expect(events).toEqual(['started', 'complete']);
    });
  });

  // ── Full sync ─────────────────────────────────────────────────────

  describe('full sync', () => {
    it('copies remote files to local cache', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'notes/spec.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
          { name: 'agents/agent1.json', type: 'file', size: 50, mtime: '2025-01-01T00:00:00Z' },
        ],
      });
      mockRpcClient.readFile
        .mockResolvedValueOnce({ content: '# Spec', size: 6, truncated: false })
        .mockResolvedValueOnce({ content: '{"id":"a1"}', size: 11, truncated: false });

      await service.start();

      expect(mockRpcClient.readFile).toHaveBeenCalledTimes(2);
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('skips files outside synced directories (workspace.json, UI state)', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'workspace.json', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
          { name: 'current-context.json', type: 'file', size: 50, mtime: '2025-01-01T00:00:00Z' },
          { name: 'first-visit-state.json', type: 'file', size: 30, mtime: '2025-01-01T00:00:00Z' },
          { name: 'panel-layout-history.json', type: 'file', size: 20, mtime: '2025-01-01T00:00:00Z' },
          { name: 'notes/spec.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
        ],
      });

      await service.start();

      // Only spec.md should be read (it's inside notes/, a synced directory)
      expect(mockRpcClient.readFile).toHaveBeenCalledTimes(1);
    });

    it('skips events.jsonl, summary.json, and file-tracking/ files during sync', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'events.jsonl', type: 'file', size: 500, mtime: '2025-01-01T00:00:00Z' },
          { name: 'summary.json', type: 'file', size: 200, mtime: '2025-01-01T00:00:00Z' },
          { name: 'file-tracking/index.json', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
          { name: 'notes/spec.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
        ],
      });

      await service.start();

      // Only notes/spec.md should be read — the others are outside synced directories
      expect(mockRpcClient.readFile).toHaveBeenCalledTimes(1);
    });

    it('deletes stale local files in synced directories not present on remote', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'notes/spec.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
        ],
      });

      // Local has extra files in synced and non-synced directories
      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath === config.localCachePath) {
          return [
            { name: 'notes', isDirectory: () => true, isFile: () => false },
            { name: 'workspace.json', isDirectory: () => false, isFile: () => true },
            { name: 'events.jsonl', isDirectory: () => false, isFile: () => true },
            { name: 'summary.json', isDirectory: () => false, isFile: () => true },
            { name: 'file-tracking', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dirPath.endsWith('/notes')) {
          return [
            { name: 'spec.md', isDirectory: () => false, isFile: () => true },
            { name: 'stale-note.md', isDirectory: () => false, isFile: () => true },
          ];
        }
        if (dirPath.endsWith('/file-tracking')) {
          return [
            { name: 'index.json', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      await service.start();

      // stale-note.md should be deleted (it's in notes/, a synced directory)
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('stale-note.md'),
      );
      // Non-synced files should NOT be deleted
      const unlinkCalls = mockFs.unlink.mock.calls.map((c: unknown[]) => c[0]);
      expect(unlinkCalls.every((p: string) => !p.includes('workspace.json'))).toBe(true);
      expect(unlinkCalls.every((p: string) => !p.includes('events.jsonl'))).toBe(true);
      expect(unlinkCalls.every((p: string) => !p.includes('summary.json'))).toBe(true);
      expect(unlinkCalls.every((p: string) => !p.includes('file-tracking'))).toBe(true);
    });

    it('deletes stale files under agents/ and assets/ not present on remote', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'agents/agent-1.json', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
        ],
      });

      mockFs.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath === config.localCachePath) {
          return [
            { name: 'agents', isDirectory: () => true, isFile: () => false },
            { name: 'assets', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dirPath.endsWith('/agents')) {
          return [
            { name: 'agent-1.json', isDirectory: () => false, isFile: () => true },
            { name: 'stale-agent.json', isDirectory: () => false, isFile: () => true },
          ];
        }
        if (dirPath.endsWith('/assets')) {
          return [
            { name: 'stale-image.png', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      await service.start();

      const unlinkCalls = mockFs.unlink.mock.calls.map((c: unknown[]) => c[0]);
      // stale-agent.json and stale-image.png should be deleted
      expect(unlinkCalls.some((p: string) => p.includes('stale-agent.json'))).toBe(true);
      expect(unlinkCalls.some((p: string) => p.includes('stale-image.png'))).toBe(true);
      // agent-1.json should NOT be deleted (it's on remote)
      expect(unlinkCalls.every((p: string) => !p.includes('agent-1.json'))).toBe(true);
    });

    it('skips directories in remote listing', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'notes', type: 'directory', size: 0, mtime: '2025-01-01T00:00:00Z' },
          { name: 'notes/spec.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
        ],
      });

      await service.start();

      // Only the file should be read, not the directory
      expect(mockRpcClient.readFile).toHaveBeenCalledTimes(1);
    });
  });

  // ── Streaming sync ────────────────────────────────────────────────

  describe('streaming sync', () => {
    it('subscribes to watchDirectory on start', async () => {
      await service.start();

      expect(mockRpcClient.watchDirectory).toHaveBeenCalledWith({
        basePath: config.remoteWorkspacePath,
        recursive: true,
        includeHidden: true,
      });
    });

    it('registers directory changes and close handlers', async () => {
      await service.start();

      expect(mockRpcClient.onDirectoryChanges).toHaveBeenCalledTimes(1);
      expect(mockRpcClient.onClose).toHaveBeenCalledTimes(1);
    });

    it('handles create/modify events by reading remote and writing local', async () => {
      await service.start();

      // Simulate a directory change event
      const handler = mockRpcClient._directoryChangesHandlers[0];
      expect(handler).toBeDefined();

      mockRpcClient.readFile.mockResolvedValue({ content: 'new content', size: 11, truncated: false });

      handler({
        subscriptionId: 'sub-123',
        changes: [
          { path: 'notes/new-note.md', action: 'create', type: 'file', mtime: '2025-01-01T00:00:00Z', size: 11 },
        ],
        timestamp: '2025-01-01T00:00:00Z',
      });

      // Wait for async handler to complete
      await vi.waitFor(() => {
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringContaining('new-note.md'),
          'new content',
          'utf-8',
        );
      });
    });

    it('handles delete events by removing local file', async () => {
      await service.start();

      const handler = mockRpcClient._directoryChangesHandlers[0];

      handler({
        subscriptionId: 'sub-123',
        changes: [
          { path: 'notes/deleted-note.md', action: 'delete', type: 'file', mtime: null, size: 0 },
        ],
        timestamp: '2025-01-01T00:00:00Z',
      });

      await vi.waitFor(() => {
        expect(mockFs.unlink).toHaveBeenCalledWith(
          expect.stringContaining('deleted-note.md'),
        );
      });
    });

    it('skips files outside synced directories in streaming events', async () => {
      await service.start();
      vi.clearAllMocks();

      const handler = mockRpcClient._directoryChangesHandlers[0];

      handler({
        subscriptionId: 'sub-123',
        changes: [
          { path: 'workspace.json', action: 'modify', type: 'file', mtime: '2025-01-01T00:00:00Z', size: 100 },
        ],
        timestamp: '2025-01-01T00:00:00Z',
      });

      // Give async handler time to run (it shouldn't)
      await vi.advanceTimersByTimeAsync(50);

      expect(mockRpcClient.readFile).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('ignores streaming events for events.jsonl, summary.json, and file-tracking/', async () => {
      await service.start();
      vi.clearAllMocks();

      const handler = mockRpcClient._directoryChangesHandlers[0];

      handler({
        subscriptionId: 'sub-123',
        changes: [
          { path: 'events.jsonl', action: 'modify', type: 'file', mtime: '2025-01-01T00:00:00Z', size: 500 },
          { path: 'summary.json', action: 'modify', type: 'file', mtime: '2025-01-01T00:00:00Z', size: 200 },
          { path: 'file-tracking/index.json', action: 'modify', type: 'file', mtime: '2025-01-01T00:00:00Z', size: 100 },
        ],
        timestamp: '2025-01-01T00:00:00Z',
      });

      await vi.advanceTimersByTimeAsync(50);

      // None of these should trigger a read or write
      expect(mockRpcClient.readFile).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('emits sync:file-changed on create/modify', async () => {
      await service.start();

      const events: unknown[] = [];
      service.on('sync:file-changed', (data: unknown) => events.push(data));

      const handler = mockRpcClient._directoryChangesHandlers[0];
      handler({
        subscriptionId: 'sub-123',
        changes: [
          { path: 'notes/note.md', action: 'modify', type: 'file', mtime: '2025-01-01T00:00:00Z', size: 50 },
        ],
        timestamp: '2025-01-01T00:00:00Z',
      });

      await vi.waitFor(() => {
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ path: 'notes/note.md', action: 'modify' });
      });
    });
  });

  // ── Reconnection ──────────────────────────────────────────────────

  describe('reconnection', () => {
    it('schedules reconnect on RPC close', async () => {
      await service.start();

      // Simulate RPC close
      const closeHandler = mockRpcClient._closeHandlers[0];
      expect(closeHandler).toBeDefined();

      // Reset mocks for reconnect
      mockRpcClient.listDir.mockResolvedValue({ entries: [] });
      mockRpcClient.watchDirectory.mockResolvedValue({ subscriptionId: 'sub-456' });

      closeHandler();

      // Advance past the first reconnect delay (1s)
      await vi.advanceTimersByTimeAsync(1100);

      // Should have called getClient again for reconnect
      const { remoteRPCManager } = await import('$shared/main/remote-rpc-manager');
      expect(remoteRPCManager.getClient).toHaveBeenCalledTimes(2);
    });

    it('uses exponential backoff for reconnection', async () => {
      const { remoteRPCManager } = await import('$shared/main/remote-rpc-manager');

      // Make getClient fail on reconnect attempts
      let callCount = 0;
      (remoteRPCManager.getClient as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return mockRpcClient; // Initial connect succeeds
        throw new Error('Connection failed');
      });

      await service.start();

      // Simulate RPC close
      const closeHandler = mockRpcClient._closeHandlers[0];
      closeHandler();

      // First reconnect at 1s
      await vi.advanceTimersByTimeAsync(1100);
      expect(callCount).toBe(2);

      // Second reconnect at 2s
      await vi.advanceTimersByTimeAsync(2100);
      expect(callCount).toBe(3);

      // Third reconnect at 4s
      await vi.advanceTimersByTimeAsync(4100);
      expect(callCount).toBe(4);
    });

    it('performs full sync on reconnect', async () => {
      await service.start();

      // Reset to track reconnect behavior
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'notes/updated.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
        ],
      });
      mockRpcClient.readFile.mockResolvedValue({ content: 'updated', size: 7, truncated: false });

      // Simulate RPC close
      const closeHandler = mockRpcClient._closeHandlers[0];
      closeHandler();

      // Advance past reconnect delay
      await vi.advanceTimersByTimeAsync(1100);

      // Full sync should have been called (listDir + readFile)
      expect(mockRpcClient.listDir).toHaveBeenCalledTimes(2); // initial + reconnect
    });

    it('does not reconnect after stop', async () => {
      await service.start();

      const closeHandler = mockRpcClient._closeHandlers[0];

      await service.stop();

      // Simulate close after stop
      if (closeHandler) closeHandler();

      await vi.advanceTimersByTimeAsync(5000);

      // getClient should only have been called once (initial start)
      const { remoteRPCManager } = await import('$shared/main/remote-rpc-manager');
      expect(remoteRPCManager.getClient).toHaveBeenCalledTimes(1);
    });

    it('emits sync:error after max reconnect attempts', async () => {
      const { remoteRPCManager } = await import('$shared/main/remote-rpc-manager');

      let callCount = 0;
      (remoteRPCManager.getClient as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return mockRpcClient;
        throw new Error('Connection failed');
      });

      const errors: unknown[] = [];
      service.on('sync:error', (err: unknown) => errors.push(err));

      await service.start();

      // Simulate close
      const closeHandler = mockRpcClient._closeHandlers[0];
      closeHandler();

      // Advance through all 10 reconnect attempts with exponential backoff
      // 1s + 2s + 4s + 8s + 16s + 30s + 30s + 30s + 30s + 30s = ~181s
      for (let i = 0; i < 11; i++) {
        await vi.advanceTimersByTimeAsync(31_000);
      }

      // Should have emitted sync:error
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(service.getIsRunning()).toBe(false);

      const stopSpy = vi.spyOn(service, 'stop');
      (remoteRPCManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockRpcClient);

      const replacement = new MetadataSyncService(config);
      await replacement.start();
      await replacement.stop();

      expect(stopSpy).not.toHaveBeenCalled();
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('unsubscribes from watch on stop', async () => {
      await service.start();
      await service.stop();

      expect(mockRpcClient.watchDirectoryUnsubscribe).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
      });
    });

    it('removes directory changes listener on stop', async () => {
      await service.start();
      await service.stop();

      expect(mockRpcClient.removeDirectoryChangesListener).toHaveBeenCalledTimes(1);
    });

    it('removes close listener on stop', async () => {
      await service.start();
      await service.stop();

      expect(mockRpcClient.removeCloseListener).toHaveBeenCalledTimes(1);
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('emits sync:error and schedules reconnect on initial failure', async () => {
      const { remoteRPCManager } = await import('$shared/main/remote-rpc-manager');
      (remoteRPCManager.getClient as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      const errors: unknown[] = [];
      service.on('sync:error', (err: unknown) => errors.push(err));

      await service.start();

      expect(errors).toHaveLength(1);
      expect(service.getIsRunning()).toBe(true); // Still running, will retry
    });

    it('handles readFile failure during full sync gracefully', async () => {
      mockRpcClient.listDir.mockResolvedValue({
        entries: [
          { name: 'notes/good.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
          { name: 'notes/bad.md', type: 'file', size: 100, mtime: '2025-01-01T00:00:00Z' },
        ],
      });
      mockRpcClient.readFile
        .mockResolvedValueOnce({ content: 'good', size: 4, truncated: false })
        .mockRejectedValueOnce(new Error('File read failed'));

      // Should not throw — errors are logged and skipped
      await service.start();

      // good.md should still be written
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('handles ENOENT on delete gracefully', async () => {
      await service.start();

      mockFs.unlink.mockRejectedValueOnce(new Error('ENOENT: no such file'));

      const handler = mockRpcClient._directoryChangesHandlers[0];
      handler({
        subscriptionId: 'sub-123',
        changes: [
          { path: 'notes/already-gone.md', action: 'delete', type: 'file', mtime: null, size: 0 },
        ],
        timestamp: '2025-01-01T00:00:00Z',
      });

      // Should not throw — ENOENT is silently ignored
      await vi.waitFor(() => {
        expect(mockFs.unlink).toHaveBeenCalled();
      });
    });
  });
});
