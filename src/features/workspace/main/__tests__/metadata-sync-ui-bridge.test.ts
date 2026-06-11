import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MetadataSyncService } from '../../../metadata-fs/main/metadata-sync-service';
import { EventEmitter } from '../../../../shared/utils/event-emitter';
import { createMetadataSyncUiBridge } from '../utils/metadata-sync-ui-bridge';

describe('createMetadataSyncUiBridge', () => {
  let syncService: MetadataSyncService;
  let sendToWorkspaceWindows: ReturnType<typeof vi.fn>;
  let refreshAgents: ReturnType<typeof vi.fn>;
  let readFile: ReturnType<typeof vi.fn>;
  let logger: { warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    syncService = new EventEmitter() as MetadataSyncService;
    sendToWorkspaceWindows = vi.fn();
    refreshAgents = vi.fn();
    readFile = vi.fn().mockResolvedValue('---\ntitle: Test\n---\nHello from cache');
    logger = { warn: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const createBridge = () =>
    createMetadataSyncUiBridge({
      syncService,
      workspaceId: 'ws-1',
      localCachePath: '/tmp/ws-1/.workspace',
      sendToWorkspaceWindows,
      refreshAgents,
      logger,
      readFile,
    });

  it('flushes pending note refreshes after the debounce delay', async () => {
    createBridge();

    syncService.emit('sync:file-changed', { path: 'notes/note-1.md', action: 'change' });
    await vi.advanceTimersByTimeAsync(500);

    expect(readFile).toHaveBeenCalledWith('/tmp/ws-1/.workspace/notes/note-1.md');
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'note:updated', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      content: 'Hello from cache',
      source: 'external',
    });
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'note:content-changed:ws-1', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      content: 'Hello from cache',
      source: 'external',
    });
  });

  it('disposes listeners and clears pending debounce work before stop or replacement', async () => {
    const bridge = createBridge();
    syncService.emit('sync:file-changed', { path: 'notes/note-1.md', action: 'change' });

    expect(syncService.listenerCount('sync:file-changed')).toBe(1);
    expect(syncService.listenerCount('sync:complete')).toBe(1);

    bridge.dispose();
    await vi.advanceTimersByTimeAsync(500);

    expect(syncService.listenerCount('sync:file-changed')).toBe(0);
    expect(syncService.listenerCount('sync:complete')).toBe(0);
    expect(readFile).not.toHaveBeenCalled();
    expect(sendToWorkspaceWindows).not.toHaveBeenCalled();
  });

  it('clears delayed sync-complete flush work on dispose', async () => {
    const bridge = createBridge();
    syncService.emit('sync:file-changed', { path: 'notes/note-1.md', action: 'change' });
    syncService.emit('sync:complete');

    bridge.dispose();
    await vi.advanceTimersByTimeAsync(500);

    expect(readFile).not.toHaveBeenCalled();
    expect(sendToWorkspaceWindows).not.toHaveBeenCalled();
  });
});