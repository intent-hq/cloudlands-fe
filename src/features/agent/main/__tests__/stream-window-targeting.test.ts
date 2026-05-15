/**
 * Stream Window Targeting Tests
 *
 * Tests for the cross-stream prevention fix that ensures stream messages
 * are sent only to windows viewing the stream's workspace.
 *
 * This addresses a bug where running two coordinators simultaneously
 * caused their output to "cross streams" - coordinator A's output
 * would render in coordinator B's window and vice-versa.
 *
 * The fix tracks each stream's workspace via streamWorkspaceIds
 * and uses sendStreamToRenderer to target the correct workspace windows.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import { BrowserWindow } from 'electron';

// Mock electron
vi.mock('electron', () => {
  const mockWindows: any[] = [];

  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/path'),
      getName: vi.fn().mockReturnValue('Workspaces'),
      getVersion: vi.fn().mockReturnValue('1.0.0'),
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => mockWindows),
      fromWebContents: vi.fn((webContents: any) => mockWindows.find((w) => w.webContents === webContents)),
      mockWindows,
    },
  };
});

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    constructor() {}
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  },
}));

describe('Stream Window Targeting (Cross-Stream Prevention)', () => {
  let mockWindow1: any;
  let mockWindow2: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create two mock windows with unique IDs (simulates two workspace windows)
    mockWindow1 = {
      id: 1,
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };

    mockWindow2 = {
      id: 2,
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };

    // Add both windows to mock windows array
    (BrowserWindow as any).mockWindows.length = 0;
    (BrowserWindow as any).mockWindows.push(mockWindow1);
    (BrowserWindow as any).mockWindows.push(mockWindow2);
  });

  /**
   * Helper that mimics the sendStreamToRenderer logic from agent-backend-handler.service.ts
   * This tests the core targeting logic without the full service instantiation.
   */
  const createStreamSender =
    (streamWorkspaceIds: Map<string, string>, workspaceWindowIds: Map<string, number[]>) =>
    (agentId: string, channel: string, data: any): boolean => {
      const workspaceId = streamWorkspaceIds.get(agentId);
      if (!workspaceId) {
        return false;
      }

      const targetWindowIds = workspaceWindowIds.get(workspaceId) ?? [];
      if (targetWindowIds.length === 0) {
        return false;
      }

      const targetWindowSet = new Set(targetWindowIds);
      const windows = (BrowserWindow as any).mockWindows;
      const dataWithWorkspaceId = { ...data, workspaceId };

      let sent = false;
      for (const window of windows) {
        if (targetWindowSet.has(window.id) && !window.isDestroyed()) {
          window.webContents.send(channel, dataWithWorkspaceId);
          sent = true;
        }
      }
      return sent;
    };

  it('should send stream messages only to windows for the agent workspace', () => {
    const streamWorkspaceIds = new Map<string, string>();
    streamWorkspaceIds.set('agent-1', 'workspace-1');
    streamWorkspaceIds.set('agent-2', 'workspace-2');
    const workspaceWindowIds = new Map<string, number[]>([
      ['workspace-1', [mockWindow1.id]],
      ['workspace-2', [mockWindow2.id]],
    ]);

    const sendStreamToRenderer = createStreamSender(streamWorkspaceIds, workspaceWindowIds);

    // Agent 1 sends stream data
    sendStreamToRenderer('agent-1', 'agent:stream:agent-1', {
      type: 'chunk',
      content: 'Response from agent 1',
    });

    // Agent 2 sends stream data
    sendStreamToRenderer('agent-2', 'agent:stream:agent-2', {
      type: 'chunk',
      content: 'Response from agent 2',
    });

    // Window 1 should only receive agent 1's stream
    expect(mockWindow1.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow1.webContents.send).toHaveBeenCalledWith(
      'agent:stream:agent-1',
      expect.objectContaining({ content: 'Response from agent 1', workspaceId: 'workspace-1' }),
    );

    // Window 2 should only receive agent 2's stream
    expect(mockWindow2.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow2.webContents.send).toHaveBeenCalledWith(
      'agent:stream:agent-2',
      expect.objectContaining({ content: 'Response from agent 2', workspaceId: 'workspace-2' }),
    );

    // Verify no cross-contamination
    expect(mockWindow1.webContents.send).not.toHaveBeenCalledWith(
      'agent:stream:agent-2',
      expect.anything(),
    );
    expect(mockWindow2.webContents.send).not.toHaveBeenCalledWith(
      'agent:stream:agent-1',
      expect.anything(),
    );
  });

  it('should drop workspace-scoped stream messages when no workspace is tracked', () => {
    const streamWorkspaceIds = new Map<string, string>();
    const workspaceWindowIds = new Map<string, number[]>([['workspace-1', [mockWindow1.id]]]);
    const sendStreamToRenderer = createStreamSender(streamWorkspaceIds, workspaceWindowIds);

    const result = sendStreamToRenderer('agent-untracked', 'agent:stream:agent-untracked', {
      type: 'chunk',
      content: 'Dropped message',
    });

    expect(result).toBe(false);
    expect(mockWindow1.webContents.send).not.toHaveBeenCalled();
    expect(mockWindow2.webContents.send).not.toHaveBeenCalled();
  });

  it('should drop workspace-scoped stream messages when no workspace windows are tracked', () => {
    const streamWorkspaceIds = new Map<string, string>([['agent-untracked', 'workspace-missing']]);
    const workspaceWindowIds = new Map<string, number[]>();
    const sendStreamToRenderer = createStreamSender(streamWorkspaceIds, workspaceWindowIds);

    const result = sendStreamToRenderer('agent-untracked', 'agent:stream:agent-untracked', {
      type: 'chunk',
      content: 'Dropped message',
    });

    expect(result).toBe(false);
    expect(mockWindow1.webContents.send).not.toHaveBeenCalled();
    expect(mockWindow2.webContents.send).not.toHaveBeenCalled();
  });

  it('should clean up window tracking when stream ends', () => {
    const streamWorkspaceIds = new Map<string, string>();
    streamWorkspaceIds.set('agent-cleanup', 'workspace-1');

    // Verify workspace is tracked
    expect(streamWorkspaceIds.has('agent-cleanup')).toBe(true);

    // Simulate stream cleanup (what cleanupStreamResources does)
    streamWorkspaceIds.delete('agent-cleanup');

    // Verify cleanup
    expect(streamWorkspaceIds.has('agent-cleanup')).toBe(false);
  });

  it('should skip destroyed windows when sending targeted messages', () => {
    const streamWorkspaceIds = new Map<string, string>();
    streamWorkspaceIds.set('agent-destroyed', 'workspace-1');
    const workspaceWindowIds = new Map<string, number[]>([['workspace-1', [mockWindow1.id]]]);

    // Mark window 1 as destroyed
    mockWindow1.isDestroyed.mockReturnValue(true);

    const sendStreamToRenderer = createStreamSender(streamWorkspaceIds, workspaceWindowIds);

    const result = sendStreamToRenderer('agent-destroyed', 'agent:stream:agent-destroyed', {
      type: 'chunk',
      content: 'Should not be sent',
    });

    // Destroyed window should not receive the message
    expect(mockWindow1.webContents.send).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('should handle multiple streams to same window correctly', () => {
    const streamWorkspaceIds = new Map<string, string>();
    // Two agents, both in workspace 1
    streamWorkspaceIds.set('agent-a', 'workspace-1');
    streamWorkspaceIds.set('agent-b', 'workspace-1');
    const workspaceWindowIds = new Map<string, number[]>([['workspace-1', [mockWindow1.id]]]);

    const sendStreamToRenderer = createStreamSender(streamWorkspaceIds, workspaceWindowIds);

    sendStreamToRenderer('agent-a', 'agent:stream:agent-a', {
      type: 'chunk',
      content: 'Message A',
    });
    sendStreamToRenderer('agent-b', 'agent:stream:agent-b', {
      type: 'chunk',
      content: 'Message B',
    });

    // Window 1 should receive both messages
    expect(mockWindow1.webContents.send).toHaveBeenCalledTimes(2);
    // Window 2 should receive nothing
    expect(mockWindow2.webContents.send).not.toHaveBeenCalled();
  });
});
