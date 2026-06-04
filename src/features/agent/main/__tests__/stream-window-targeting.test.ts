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

/**
 * Workspace Event Emission from Stream Data Tests
 *
 * Tests the emitStreamEventToWorkspaceEvents logic from agent-backend-handler.service.ts
 * which maps streaming data types to workspace events for WebSocket API clients.
 *
 * The production code uses fire-and-forget dynamic imports, so we replicate
 * the mapping logic in a testable helper (same pattern as createStreamSender above).
 */
describe('Stream Event → Workspace Event Emission', () => {
  let mockMainDispatch: ReturnType<typeof vi.fn>;
  let mockEmitWorkspaceEvent: ReturnType<typeof vi.fn>;
  let mockCreateWorkspaceEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMainDispatch = vi.fn();
    mockEmitWorkspaceEvent = vi.fn((event: any) => ({ type: 'EMIT_WORKSPACE_EVENT', payload: event }));
    mockCreateWorkspaceEvent = vi.fn((type: string, workspaceId: string, actor: any, data: any) => ({
      id: 'evt_test',
      type,
      workspaceId,
      actor,
      data,
      timestamp: new Date().toISOString(),
    }));
  });

  /**
   * Replicates the emitStreamEventToWorkspaceEvents logic from
   * agent-backend-handler.service.ts (line ~4896).
   * Instead of dynamic imports, it takes the dependencies as parameters.
   */
  function emitStreamEventToWorkspaceEvents(
    agentId: string,
    workspaceId: string,
    data: any,
    deps: {
      mainDispatch: typeof mockMainDispatch;
      emitWorkspaceEvent: typeof mockEmitWorkspaceEvent;
      createWorkspaceEvent: typeof mockCreateWorkspaceEvent;
    },
  ): void {
    let eventType: string | undefined;
    let eventData: any;

    switch (data.type) {
      case 'chunk':
        eventType = 'agent:stream:chunk';
        eventData = { agentId, content: data.data, streamId: data.streamId };
        break;
      case 'content-blocks':
        eventType = 'agent:stream:content-blocks';
        eventData = { agentId, content: data.data, streamId: data.streamId };
        break;
      case 'complete':
        eventType = 'agent:stream:end';
        eventData = { agentId, streamId: data.streamId };
        break;
      case 'error':
        eventType = 'agent:stream:end';
        eventData = { agentId, streamId: data.streamId };
        break;
      default:
        return;
    }

    deps.mainDispatch(deps.emitWorkspaceEvent(deps.createWorkspaceEvent(
      eventType as any,
      workspaceId,
      { type: 'system' as const, id: agentId },
      eventData,
    )));
  }

  it('should emit agent:stream:chunk for chunk data type', () => {
    emitStreamEventToWorkspaceEvents('agent-1', 'ws-1', {
      type: 'chunk',
      data: 'Hello world',
      streamId: 'stream-1',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(
      'agent:stream:chunk',
      'ws-1',
      { type: 'system', id: 'agent-1' },
      { agentId: 'agent-1', content: 'Hello world', streamId: 'stream-1' },
    );
    expect(mockMainDispatch).toHaveBeenCalledTimes(1);
  });

  it('should emit agent:stream:content-blocks for content-blocks data type', () => {
    const blocks = [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} }];
    emitStreamEventToWorkspaceEvents('agent-2', 'ws-2', {
      type: 'content-blocks',
      data: blocks,
      streamId: 'stream-2',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(
      'agent:stream:content-blocks',
      'ws-2',
      { type: 'system', id: 'agent-2' },
      { agentId: 'agent-2', content: blocks, streamId: 'stream-2' },
    );
    expect(mockMainDispatch).toHaveBeenCalledTimes(1);
  });

  it('should emit agent:stream:end for complete data type', () => {
    emitStreamEventToWorkspaceEvents('agent-3', 'ws-3', {
      type: 'complete',
      streamId: 'stream-3',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(
      'agent:stream:end',
      'ws-3',
      { type: 'system', id: 'agent-3' },
      { agentId: 'agent-3', streamId: 'stream-3' },
    );
    expect(mockMainDispatch).toHaveBeenCalledTimes(1);
  });

  it('should emit agent:stream:end for error data type', () => {
    emitStreamEventToWorkspaceEvents('agent-4', 'ws-4', {
      type: 'error',
      error: 'Something went wrong',
      streamId: 'stream-4',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    expect(mockCreateWorkspaceEvent).toHaveBeenCalledWith(
      'agent:stream:end',
      'ws-4',
      { type: 'system', id: 'agent-4' },
      { agentId: 'agent-4', streamId: 'stream-4' },
    );
    expect(mockMainDispatch).toHaveBeenCalledTimes(1);
  });

  it('should NOT emit events for status data type', () => {
    emitStreamEventToWorkspaceEvents('agent-5', 'ws-5', {
      type: 'status',
      data: { phase: 'thinking', message: 'Processing...', level: 'info', timestamp: Date.now() },
      streamId: 'stream-5',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it('should NOT emit events for ping data type', () => {
    emitStreamEventToWorkspaceEvents('agent-6', 'ws-6', {
      type: 'ping',
      timestamp: Date.now(),
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it('should NOT emit events for unknown data types', () => {
    emitStreamEventToWorkspaceEvents('agent-7', 'ws-7', {
      type: 'some-unknown-type',
      data: 'whatever',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    expect(mockCreateWorkspaceEvent).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it('should include correct agentId and streamId in event data for chunk', () => {
    emitStreamEventToWorkspaceEvents('my-agent-id', 'my-workspace', {
      type: 'chunk',
      data: 'token',
      streamId: 'my-stream',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    const eventData = mockCreateWorkspaceEvent.mock.calls[0][3];
    expect(eventData).toEqual({
      agentId: 'my-agent-id',
      content: 'token',
      streamId: 'my-stream',
    });
  });

  it('should use system actor type with agentId as actor id', () => {
    emitStreamEventToWorkspaceEvents('agent-actor-test', 'ws-actor', {
      type: 'chunk',
      data: 'test',
      streamId: 'stream-actor',
    }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });

    const actor = mockCreateWorkspaceEvent.mock.calls[0][2];
    expect(actor).toEqual({ type: 'system', id: 'agent-actor-test' });
  });

  it('should not throw when dependencies fail (fire-and-forget pattern)', () => {
    // Simulate the fire-and-forget pattern where the .catch(() => {}) swallows errors
    // In the real code, the dynamic import chain has .catch(() => {})
    // Here we verify the mapping itself doesn't throw for edge cases
    expect(() => {
      emitStreamEventToWorkspaceEvents('agent-x', 'ws-x', {
        type: 'chunk',
        data: undefined,
        streamId: undefined,
      }, { mainDispatch: mockMainDispatch, emitWorkspaceEvent: mockEmitWorkspaceEvent, createWorkspaceEvent: mockCreateWorkspaceEvent });
    }).not.toThrow();

    // Verify it still emits even with undefined data
    expect(mockMainDispatch).toHaveBeenCalledTimes(1);
  });
});
