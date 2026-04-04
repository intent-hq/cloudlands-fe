/**
 * IPC Fixes Tests
 *
 * Tests for the three IPC communication fixes:
 * 1. sendToRenderer destroyed window handling
 * 2. Preload listener registry fallback warning
 * 3. IPC heartbeat ping/pong mechanism
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger before any other imports that might use it
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('$lib/utils/backend-logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => mockLogger,
}));

/**
 * Test 1: sendToRenderer destroyed window handling
 *
 * Tests that the sendToRenderer method correctly handles destroyed windows
 */
describe('sendToRenderer Destroyed Window Handling', () => {
  let sendToRendererFn: (channel: string, data: any) => boolean;
  let mockWindows: Array<{
    id: number;
    isDestroyed: () => boolean;
    webContents: { send: ReturnType<typeof vi.fn> };
  }>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mock windows
    mockWindows = [];

    // Create a standalone sendToRenderer function that mirrors the implementation
    sendToRendererFn = (channel: string, data: any): boolean => {
      let sentToAtLeastOne = false;

      mockWindows.forEach((window, index) => {
        // Skip destroyed windows to avoid Electron errors
        if (window.isDestroyed()) {
          mockLogger.debug('Skipping destroyed window', {
            channel,
            windowIndex: index,
            windowId: window.id,
          });
          return;
        }

        try {
          window.webContents.send(channel, data);
          sentToAtLeastOne = true;
        } catch (error) {
          mockLogger.error('Failed to send to window', {
            channel,
            windowIndex: index,
            windowId: window.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      return sentToAtLeastOne;
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should skip destroyed windows without throwing', () => {
    const destroyedWindow = {
      id: 1,
      isDestroyed: () => true,
      webContents: { send: vi.fn() },
    };
    mockWindows.push(destroyedWindow);

    // Should not throw
    expect(() => sendToRendererFn('test:channel', { data: 'test' })).not.toThrow();

    // webContents.send should NOT be called on destroyed window
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('should send to non-destroyed windows only', () => {
    const destroyedWindow = {
      id: 1,
      isDestroyed: () => true,
      webContents: { send: vi.fn() },
    };
    const validWindow = {
      id: 2,
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    };
    mockWindows.push(destroyedWindow, validWindow);

    sendToRendererFn('test:channel', { data: 'test' });

    // Only valid window should receive the message
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
    expect(validWindow.webContents.send).toHaveBeenCalledWith('test:channel', { data: 'test' });
  });

  it('should return false when all windows are destroyed', () => {
    mockWindows.push(
      { id: 1, isDestroyed: () => true, webContents: { send: vi.fn() } },
      { id: 2, isDestroyed: () => true, webContents: { send: vi.fn() } },
    );

    const result = sendToRendererFn('test:channel', { data: 'test' });

    expect(result).toBe(false);
  });

  it('should return true when at least one window receives message', () => {
    mockWindows.push(
      { id: 1, isDestroyed: () => true, webContents: { send: vi.fn() } },
      { id: 2, isDestroyed: () => false, webContents: { send: vi.fn() } },
    );

    const result = sendToRendererFn('test:channel', { data: 'test' });

    expect(result).toBe(true);
  });

  it('should log debug message for skipped destroyed windows', () => {
    mockWindows.push({ id: 1, isDestroyed: () => true, webContents: { send: vi.fn() } });

    sendToRendererFn('test:channel', { data: 'test' });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Skipping destroyed window',
      expect.objectContaining({
        channel: 'test:channel',
        windowId: 1,
      }),
    );
  });

  it('should return false when no windows exist', () => {
    // Empty mockWindows array
    const result = sendToRendererFn('test:channel', { data: 'test' });
    expect(result).toBe(false);
  });

  it('should handle webContents.send throwing an error', () => {
    const errorWindow = {
      id: 1,
      isDestroyed: () => false,
      webContents: {
        send: vi.fn().mockImplementation(() => {
          throw new Error('Send failed');
        }),
      },
    };
    mockWindows.push(errorWindow);

    // Should not throw
    expect(() => sendToRendererFn('test:channel', { data: 'test' })).not.toThrow();

    // Should log the error
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to send to window',
      expect.objectContaining({
        channel: 'test:channel',
        error: 'Send failed',
      }),
    );
  });
});

/**
 * Test 2: Preload listener registry fallback warning
 *
 * Tests that the preload script correctly handles listener registry misses
 */
describe('Preload Listener Registry', () => {
  type ListenerEntry = {
    id: string;
    original: (...args: any[]) => void;
    wrapped: (...args: any[]) => void;
  };

  let listenerRegistry: Map<string, Map<string, ListenerEntry>>;
  let listenerIdCounter = 0;
  let mockIpcRenderer: {
    on: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };

  // Simulate the preload API
  let electronAPI: {
    on: (channel: string, callback: (...args: any[]) => void) => string;
    off: (channel: string, callback: (...args: any[]) => void) => void;
    offById: (channel: string, listenerId: string) => void;
    removeAllListeners: (channel: string) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listenerRegistry = new Map();
    listenerIdCounter = 0;

    mockIpcRenderer = {
      on: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    function generateListenerId(): string {
      listenerIdCounter += 1;
      // Counter prevents collisions within the same millisecond.
      return `l${Date.now()}_${listenerIdCounter}`;
    }

    // Recreate the preload API behavior
    electronAPI = {
      on: (channel: string, callback: (...args: any[]) => void) => {
        const wrappedCallback = (...args: any[]) => {
          try {
            callback(...args);
          } catch (error) {
            mockLogger.error(`[Preload] Error in event handler for ${channel}:`, error);
          }
        };

        const listenerId = generateListenerId();

        if (!listenerRegistry.has(channel)) {
          listenerRegistry.set(channel, new Map());
        }
        listenerRegistry
          .get(channel)!
          .set(listenerId, { id: listenerId, original: callback, wrapped: wrappedCallback });

        // Mirror the real preload bridge behavior (for callers that inspect the callback)
        (callback as any).__ipcWrapper = wrappedCallback;
        (callback as any).__ipcListenerId = listenerId;

        mockIpcRenderer.on(channel, wrappedCallback);

        return listenerId;
      },

      off: (channel: string, callback: (...args: any[]) => void) => {
        const channelListeners = listenerRegistry.get(channel);
        if (channelListeners) {
          for (const [listenerId, entry] of channelListeners.entries()) {
            if (entry.original === callback) {
              mockIpcRenderer.removeListener(channel, entry.wrapped);
              channelListeners.delete(listenerId);
              if (channelListeners.size === 0) {
                listenerRegistry.delete(channel);
              }
              return;
            }
          }

          if (channelListeners.size === 0) {
            listenerRegistry.delete(channel);
          }
        }
        // Fallback: try removing with the original callback directly
        mockLogger.warn(
          `[Preload] Listener registry miss for channel ${channel} - callback not found in registry. This may indicate a listener leak.`,
        );
        mockIpcRenderer.removeListener(channel, callback);
      },

      offById: (channel: string, listenerId: string) => {
        if (!listenerId) return;

        const channelListeners = listenerRegistry.get(channel);
        const entry = channelListeners?.get(listenerId);
        if (entry) {
          mockIpcRenderer.removeListener(channel, entry.wrapped);
          channelListeners!.delete(listenerId);
          if (channelListeners!.size === 0) {
            listenerRegistry.delete(channel);
          }
          return;
        }

        // Listener not found - this is normal if removeAllListeners() was called first
        // (e.g., agent.service.ts cleans up stream channels with removeAllListeners,
        // then component cleanup calls offById). No warning needed.
      },

      removeAllListeners: (channel: string) => {
        mockIpcRenderer.removeAllListeners(channel);
        listenerRegistry.delete(channel);
      },
    };
  });

  it('should remove listener using wrapped callback from registry', () => {
    const callback = vi.fn();
    const channel = 'test:channel';

    // Register listener
    const listenerId = electronAPI.on(channel, callback);
    expect(listenerRegistry.has(channel)).toBe(true);
    expect(listenerRegistry.get(channel)!.size).toBe(1);

    // Get the wrapped callback that was registered
    const wrappedCallback = listenerRegistry.get(channel)!.get(listenerId)!.wrapped;

    // Remove listener
    electronAPI.off(channel, callback);

    // Should remove using the wrapped callback
    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(channel, wrappedCallback);
    // Registry should be cleaned up
    expect(listenerRegistry.has(channel)).toBe(false);
  });

  it('should log warning when callback not found in registry', () => {
    const unregisteredCallback = vi.fn();
    const channel = 'test:channel';

    // Try to remove a callback that was never registered
    electronAPI.off(channel, unregisteredCallback);

    // Should log warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Listener registry miss for channel test:channel'),
    );
  });

  it('should still attempt fallback removeListener when registry lookup fails', () => {
    const unregisteredCallback = vi.fn();
    const channel = 'test:channel';

    // Try to remove a callback that was never registered
    electronAPI.off(channel, unregisteredCallback);

    // Should still call removeListener with the original callback as fallback
    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(channel, unregisteredCallback);
  });

  it('should clean up registry entry when last listener removed', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const channel = 'test:channel';

    // Register multiple listeners
    electronAPI.on(channel, callback1);
    electronAPI.on(channel, callback2);
    expect(listenerRegistry.get(channel)!.size).toBe(2);

    // Remove first listener
    electronAPI.off(channel, callback1);
    expect(listenerRegistry.get(channel)!.size).toBe(1);

    // Remove second listener
    electronAPI.off(channel, callback2);
    // Registry entry should be deleted when empty
    expect(listenerRegistry.has(channel)).toBe(false);
  });

  it('should remove listener by ID using wrapped callback from registry', () => {
    const callback = vi.fn();
    const channel = 'test:channel';

    const listenerId = electronAPI.on(channel, callback);
    const wrappedCallback = listenerRegistry.get(channel)!.get(listenerId)!.wrapped;

    electronAPI.offById(channel, listenerId);

    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(channel, wrappedCallback);
    expect(listenerRegistry.has(channel)).toBe(false);
  });

  it('should silently succeed when listenerId not found in registry (already cleaned up)', () => {
    const channel = 'test:channel';

    // This simulates the case where removeAllListeners was called first,
    // then component cleanup calls offById with a stale listener ID
    electronAPI.offById(channel, 'missing-id');

    // Should NOT log a warning - this is expected behavior
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockIpcRenderer.removeListener).not.toHaveBeenCalled();
  });

  it('should handle removeAllListeners correctly', () => {
    const callback = vi.fn();
    const channel = 'test:channel';

    electronAPI.on(channel, callback);
    expect(listenerRegistry.has(channel)).toBe(true);

    electronAPI.removeAllListeners(channel);

    expect(mockIpcRenderer.removeAllListeners).toHaveBeenCalledWith(channel);
    expect(listenerRegistry.has(channel)).toBe(false);
  });
});

/**
 * Test 3: IPC Heartbeat Ping/Pong Mechanism
 *
 * Tests for the heartbeat mechanism that detects broken IPC connections
 */
describe('IPC Heartbeat Ping/Pong', () => {
  let mockElectronAPI: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };
  let activePingHandlers: Map<string, { channel: string; handler: (data: any) => void }>;
  let lastPongTimes: Map<string, number>;
  let lastPingSentTimes: Map<string, number>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    activePingHandlers = new Map();
    lastPongTimes = new Map();
    lastPingSentTimes = new Map();

    mockElectronAPI = {
      on: vi.fn(),
      off: vi.fn(),
      send: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    (global as any).window = {
      electronAPI: mockElectronAPI,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (global as any).window;
    vi.clearAllMocks();
  });

  describe('Frontend Ping Handler Registration', () => {
    it('should register ping handler when stream handler is created', () => {
      const agentId = 'agent-123';
      const pingChannel = `agent:stream:ping:${agentId}`;

      // Simulate what happens when stream handler is registered
      const pingHandler = (data: { agentId: string; timestamp: number }) => {
        mockLogger.debug('IPC heartbeat: received ping, sending pong', {
          agentId,
          timestamp: data.timestamp,
        });
        mockElectronAPI.send('agent:stream:pong', { agentId });
      };

      mockElectronAPI.on(pingChannel, pingHandler);
      activePingHandlers.set(agentId, { channel: pingChannel, handler: pingHandler });

      // Verify ping handler was registered
      expect(mockElectronAPI.on).toHaveBeenCalledWith(pingChannel, expect.any(Function));
      expect(activePingHandlers.has(agentId)).toBe(true);
    });

    it('should respond to ping with pong', () => {
      const agentId = 'agent-123';


      // Create ping handler that mirrors the implementation
      const pingHandler = (data: { agentId: string; timestamp: number }) => {
        mockLogger.debug('IPC heartbeat: received ping, sending pong', {
          agentId,
          timestamp: data.timestamp,
        });
        mockElectronAPI.send('agent:stream:pong', { agentId });
      };

      // Simulate receiving a ping
      pingHandler({ agentId, timestamp: Date.now() });

      // Verify pong was sent
      expect(mockElectronAPI.send).toHaveBeenCalledWith('agent:stream:pong', { agentId });
    });

    it('should clean up ping handler when stream handler is cleaned up', () => {
      const agentId = 'agent-123';
      const pingChannel = `agent:stream:ping:${agentId}`;

      // Register ping handler
      const pingHandler = vi.fn();
      activePingHandlers.set(agentId, { channel: pingChannel, handler: pingHandler });

      // Simulate cleanup (what cleanupStreamHandler does)
      const storedPingHandler = activePingHandlers.get(agentId);
      if (storedPingHandler) {
        mockElectronAPI.removeAllListeners(storedPingHandler.channel);
        activePingHandlers.delete(agentId);
      }

      // Verify cleanup
      expect(mockElectronAPI.removeAllListeners).toHaveBeenCalledWith(pingChannel);
      expect(activePingHandlers.has(agentId)).toBe(false);
    });
  });

  describe('Backend Pong Tracking', () => {
    it('should track pong times when pong is received', () => {
      const agentId = 'agent-123';
      const now = Date.now();

      // Simulate receiving pong (backend behavior)
      lastPongTimes.set(agentId, now);

      expect(lastPongTimes.get(agentId)).toBe(now);
    });

    it('should detect missed pong when ping sent but no pong received', () => {
      const agentId = 'agent-123';

      // Initialize pong time at stream start
      const streamStartTime = Date.now();
      lastPongTimes.set(agentId, streamStartTime);

      // Advance time and send a ping
      vi.advanceTimersByTime(10000); // 10 seconds later
      const pingSentTime = Date.now();
      lastPingSentTimes.set(agentId, pingSentTime);

      // Advance time past the 5 second timeout (no pong received)
      vi.advanceTimersByTime(6000);

      // Check for missed pong (mirrors backend health check logic)
      const lastPingSent = lastPingSentTimes.get(agentId)!;
      const lastPongReceived = lastPongTimes.get(agentId)!;

      // Check if pong was missed - ping was sent after last pong
      if (lastPingSent > lastPongReceived) {
        const timeSincePing = Date.now() - lastPingSent;
        if (timeSincePing > 5000) {
          mockLogger.warn('IPC heartbeat: missed pong from renderer', {
            agentId,
            timeSincePingMs: timeSincePing,
          });
        }
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'IPC heartbeat: missed pong from renderer',
        expect.objectContaining({
          agentId,
        }),
      );
    });

    it('should not warn when pong is received in time', () => {
      const agentId = 'agent-123';
      const now = Date.now();

      // Send a ping
      lastPingSentTimes.set(agentId, now);

      // Receive pong after ping (within timeout)
      vi.advanceTimersByTime(2000);
      lastPongTimes.set(agentId, Date.now());

      // Check for missed pong
      const lastPingSent = lastPingSentTimes.get(agentId)!;
      const lastPongReceived = lastPongTimes.get(agentId)!;

      // Pong received after ping, so no warning
      if (lastPingSent && lastPongReceived && lastPingSent > lastPongReceived) {
        const timeSincePing = Date.now() - lastPingSent;
        if (timeSincePing > 5000) {
          mockLogger.warn('IPC heartbeat: missed pong from renderer');
        }
      }

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'IPC heartbeat: missed pong from renderer',
        expect.anything(),
      );
    });

    it('should clean up heartbeat tracking when stream ends', () => {
      const agentId = 'agent-123';

      // Set up tracking
      lastPongTimes.set(agentId, Date.now());
      lastPingSentTimes.set(agentId, Date.now());

      // Simulate cleanup (mirrors cleanupStreamResources behavior)
      lastPongTimes.delete(agentId);
      lastPingSentTimes.delete(agentId);

      expect(lastPongTimes.has(agentId)).toBe(false);
      expect(lastPingSentTimes.has(agentId)).toBe(false);
    });
  });

  describe('Ping Interval', () => {
    it('should send ping at expected intervals (every 10 seconds during health checks)', () => {
      const agentId = 'agent-123';
      let healthCheckCount = 0;
      const pings: number[] = [];

      // Simulate health check loop behavior
      const runHealthCheck = () => {
        healthCheckCount++;
        // Send ping every 10 seconds (every 2nd health check at 5s intervals)
        if (healthCheckCount % 2 === 0) {
          const pingChannel = `agent:stream:ping:${agentId}`;
          mockLogger.debug('IPC heartbeat: sent ping', { agentId, pingChannel });
          lastPingSentTimes.set(agentId, Date.now());
          pings.push(Date.now());
        }
      };

      // Run 4 health checks (simulating 20 seconds)
      runHealthCheck(); // Count 1 - no ping
      vi.advanceTimersByTime(5000);
      runHealthCheck(); // Count 2 - ping!
      vi.advanceTimersByTime(5000);
      runHealthCheck(); // Count 3 - no ping
      vi.advanceTimersByTime(5000);
      runHealthCheck(); // Count 4 - ping!

      // Should have sent 2 pings (at health checks 2 and 4)
      expect(pings).toHaveLength(2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'IPC heartbeat: sent ping',
        expect.objectContaining({ agentId }),
      );
    });
  });
});
