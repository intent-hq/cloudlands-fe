/**
 * Stream Window Targeting Tests
 *
 * Tests for the cross-stream prevention fix that ensures stream messages
 * are sent only to the window that initiated each stream.
 *
 * This addresses a bug where running two coordinators simultaneously
 * caused their output to "cross streams" - coordinator A's output
 * would render in coordinator B's window and vice-versa.
 *
 * The fix tracks which window initiated each stream via streamWindowIds
 * and uses sendStreamToRenderer to target the correct window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  const createStreamSender = (streamWindowIds: Map<string, number>) => (agentId: string, channel: string, data: any): boolean => {
    const targetWindowId = streamWindowIds.get(agentId);
    const windows = (BrowserWindow as any).mockWindows;

    if (targetWindowId !== undefined) {
      // Send only to target window (targeted delivery)
      const targetWindow = windows.find((w: any) => w.id === targetWindowId);
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send(channel, data);
        return true;
      }
      return false;
    } else {
      // Broadcast to all windows (fallback for backend-initiated streams)
      let sent = false;
      for (const window of windows) {
        if (!window.isDestroyed()) {
          window.webContents.send(channel, data);
          sent = true;
        }
      }
      return sent;
    }
  };

  it('should send stream messages only to the originating window', () => {
    const streamWindowIds = new Map<string, number>();
    streamWindowIds.set('agent-1', mockWindow1.id);
    streamWindowIds.set('agent-2', mockWindow2.id);

    const sendStreamToRenderer = createStreamSender(streamWindowIds);

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
      expect.objectContaining({ content: 'Response from agent 1' }),
    );

    // Window 2 should only receive agent 2's stream
    expect(mockWindow2.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow2.webContents.send).toHaveBeenCalledWith(
      'agent:stream:agent-2',
      expect.objectContaining({ content: 'Response from agent 2' }),
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

  it('should fall back to broadcast when no window ID is tracked', () => {
    // Empty map simulates no window tracking (e.g., backend-initiated stream)
    const streamWindowIds = new Map<string, number>();
    const sendStreamToRenderer = createStreamSender(streamWindowIds);

    sendStreamToRenderer('agent-untracked', 'agent:stream:agent-untracked', {
      type: 'chunk',
      content: 'Broadcast message',
    });

    // Both windows should receive the message (broadcast fallback)
    expect(mockWindow1.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow2.webContents.send).toHaveBeenCalledTimes(1);
    expect(mockWindow1.webContents.send).toHaveBeenCalledWith(
      'agent:stream:agent-untracked',
      expect.objectContaining({ content: 'Broadcast message' }),
    );
    expect(mockWindow2.webContents.send).toHaveBeenCalledWith(
      'agent:stream:agent-untracked',
      expect.objectContaining({ content: 'Broadcast message' }),
    );
  });

  it('should clean up window tracking when stream ends', () => {
    const streamWindowIds = new Map<string, number>();
    streamWindowIds.set('agent-cleanup', mockWindow1.id);

    // Verify window is tracked
    expect(streamWindowIds.has('agent-cleanup')).toBe(true);

    // Simulate stream cleanup (what cleanupStreamResources does)
    streamWindowIds.delete('agent-cleanup');

    // Verify cleanup
    expect(streamWindowIds.has('agent-cleanup')).toBe(false);
  });

  it('should skip destroyed windows when sending targeted messages', () => {
    const streamWindowIds = new Map<string, number>();
    streamWindowIds.set('agent-destroyed', mockWindow1.id);

    // Mark window 1 as destroyed
    mockWindow1.isDestroyed.mockReturnValue(true);

    const sendStreamToRenderer = createStreamSender(streamWindowIds);

    const result = sendStreamToRenderer('agent-destroyed', 'agent:stream:agent-destroyed', {
      type: 'chunk',
      content: 'Should not be sent',
    });

    // Destroyed window should not receive the message
    expect(mockWindow1.webContents.send).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('should handle multiple streams to same window correctly', () => {
    const streamWindowIds = new Map<string, number>();
    // Two agents, both started from window 1
    streamWindowIds.set('agent-a', mockWindow1.id);
    streamWindowIds.set('agent-b', mockWindow1.id);

    const sendStreamToRenderer = createStreamSender(streamWindowIds);

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
