import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MetadataFileWatcher } from '../main/metadata-file-watcher';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { WatchEvent, WatchSubscription } from '../main/unified-workspace-watcher';

// Capture the subscription callback so tests can simulate events
let capturedSubscription: WatchSubscription | null = null;
const mockUnsubscribe = vi.fn();

vi.mock('../main/unified-workspace-watcher', () => ({
  UnifiedWorkspaceWatcher: {
    getInstance: vi.fn(() => ({
      subscribe: vi.fn((subscription: WatchSubscription) => {
        capturedSubscription = subscription;
        return mockUnsubscribe;
      }),
    })),
  },
}));

// Mock fs
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  access: vi.fn(),
}));


/** Helper to simulate a watch event through the captured subscription */
function simulateEvent(type: WatchEvent['type'], absolutePath: string, workspacePath: string) {
  if (!capturedSubscription) {
    throw new Error('No subscription captured — did you call watcher.start()?');
  }
  const relativePath = path.relative(workspacePath, absolutePath);
  capturedSubscription.callback({
    type,
    path: absolutePath,
    relativePath,
    timestamp: new Date().toISOString(),
  });
}

describe('MetadataFileWatcher', () => {
  let watcher: MetadataFileWatcher;
  const workspaceId = 'test-workspace-id';
  const workspacePath = '/test/workspace/path';

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubscription = null;
    watcher = new MetadataFileWatcher(workspaceId, workspacePath);
  });

  afterEach(async () => {
    await watcher.stop();
  });

  it('should initialize and start watching', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([] as any);
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    await watcher.start();

    // Verify that a subscription was registered with the unified watcher
    expect(capturedSubscription).not.toBeNull();
    expect(capturedSubscription!.pathPatterns).toEqual([
      'notes/',
      'workspace.json',
      'activity-log.json',
      'git-tracking.json',
    ]);
  });

  it('should emit note:file-changed event when a note file changes', async () => {
    const noteContent = JSON.stringify({
      id: 'test-note',
      content: 'Test content',
      title: 'Test Note',
    });

    vi.mocked(fs.readdir).mockResolvedValue(['test-note.json'] as any);
    vi.mocked(fs.readFile).mockResolvedValue(noteContent);
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    const eventPromise = new Promise((resolve) => {
      watcher.on('note:file-changed', (event) => {
        resolve(event);
      });
    });

    await watcher.start();

    // Simulate file change via unified watcher subscription
    simulateEvent('change', path.join(workspacePath, 'notes', 'test-note.json'), workspacePath);

    // Wait for debounce to settle
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const event = await eventPromise;

    expect(event).toMatchObject({
      workspaceId,
      type: 'note',
      fileType: 'note',
      action: 'change',
      noteId: 'test-note',
    });
  });

  it('should emit comment:file-changed event when a comments file changes', async () => {
    vi.mocked(fs.readdir).mockResolvedValue(['spec.comments.json'] as any);
    vi.mocked(fs.readFile).mockResolvedValue('{}');
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    const eventPromise = new Promise((resolve) => {
      watcher.on('comment:file-changed', (event) => {
        resolve(event);
      });
    });

    await watcher.start();

    // Simulate file change via unified watcher subscription
    simulateEvent('change', path.join(workspacePath, 'notes', 'spec.comments.json'), workspacePath);

    // Wait for debounce to settle
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const event = await eventPromise;

    expect(event).toMatchObject({
      workspaceId,
      type: 'comment',
      fileType: 'comments',
      action: 'change',
      noteId: 'spec',
    });
  });

  it('should debounce rapid file changes', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([] as any);
    vi.mocked(fs.readFile).mockResolvedValue('{}');
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    let eventCount = 0;
    watcher.on('metadata:changed', () => {
      eventCount++;
    });

    await watcher.start();

    // Simulate rapid file changes via unified watcher subscription
    for (let i = 0; i < 5; i++) {
      simulateEvent('change', path.join(workspacePath, 'workspace.json'), workspacePath);
    }

    // Wait for debounce to settle
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Should only emit one event due to debouncing
    expect(eventCount).toBe(1);
  });

  it('should handle file deletion', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([] as any);
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    const eventPromise = new Promise((resolve) => {
      watcher.on('note:file-changed', (event) => {
        if (event.action === 'unlink') {
          resolve(event);
        }
      });
    });

    await watcher.start();

    // Simulate file deletion via unified watcher subscription
    simulateEvent('unlink', path.join(workspacePath, 'notes', 'deleted-note.json'), workspacePath);

    // Wait for debounce to settle
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const event = await eventPromise;

    expect(event).toMatchObject({
      workspaceId,
      type: 'note',
      action: 'unlink',
      noteId: 'deleted-note',
    });
  });

  it('should call unsubscribe on stop', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([] as any);
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    await watcher.start();
    await watcher.stop();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
