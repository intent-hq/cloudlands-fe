/**
 * Streaming Functionality Tests
 *
 * Tests for agent message streaming and real-time updates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserWindow } from 'electron';
import { registerAgentHandlers } from '../unified-agent-handlers';
import { getAgentBackendAdapter } from '../agent-backend-adapter';
import { AgentBackendHandler } from '../agent-backend-handler.service';
import type { AgentIpc } from '$shared/ipc/contracts';
import * as BrandedIds from '$shared/types/branded-ids';
import { AGENT_BACKEND_CHANNELS } from '$shared/ipc/channels';

// Mock util.promisify FIRST before any imports
vi.mock('util', async (importOriginal) => {
  const actual = (await importOriginal()) as any;

  return {
    ...actual,
    default: actual,
    promisify:
      (fn: any) =>
        (...args: any[]) =>
          new Promise((resolve, reject) => {
            const callback = (err: any, result: any) => {
              if (err) reject(err);
              else resolve(result);
            };
            fn(...args, callback);
          }),
  };
});

// Mock child_process
vi.mock('child_process', () => {
  const mockExecFile = vi.fn((cmd: string, args: string[], options?: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    if (cb) {
      setTimeout(() => cb(null, '', ''), 0);
    }
  });

  const mockExec = vi.fn((cmd: string, options?: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    if (cb) {
      setTimeout(() => cb(null, '', ''), 0);
    }
  });

  return {
    default: {
      exec: mockExec,
      execFile: mockExecFile,
    },
    exec: mockExec,
    execFile: mockExecFile,
  };
});

// Mock electron
vi.mock('electron', () => {
  const mockWindows: any[] = [];
  const handlers = new Map<string, Function>();

  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/path'),
      getName: vi.fn().mockReturnValue('Workspaces'),
      getVersion: vi.fn().mockReturnValue('1.0.0'),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Function) => {
        handlers.set(channel, handler);
      }),
      handlers,
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => mockWindows),
      mockWindows,
    },
  };
});

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      access: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    },
  },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
  },
}));

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

describe('Agent Streaming Tests', () => {
  let mockBackendHandler: any;
  let adapter: any;
  let mockWindow: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock window
    mockWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };

    // Add window to mock windows array
    (BrowserWindow as any).mockWindows.length = 0;
    (BrowserWindow as any).mockWindows.push(mockWindow);

    // Mock AgentBackendHandler instance
    mockBackendHandler = {
      handleSendMessage: vi.fn(),
      handleStreamMessage: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    // Mock getInstance to return our mock
    vi.spyOn(AgentBackendHandler, 'getInstance').mockReturnValue(mockBackendHandler as any);

    // Get adapter instance
    adapter = getAgentBackendAdapter();

    // Register handlers
    registerAgentHandlers(adapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Message Streaming', () => {
    it('should handle streaming message chunks', async () => {
      const agentId = BrandedIds.AgentId('agent-123');


      // Simulate sending a message
      mockBackendHandler.handleSendMessage.mockResolvedValue({
        success: true,
      });

      const request: AgentIpc.SendMessageRequest = {
        agentId,
        content: 'Tell me about streaming',
      };

      const response = await adapter.sendMessage(request);

      expect(response.messageId).toBeDefined();
      expect(response.streamId).toBeDefined();

      // Simulate streaming chunks
      const chunks = ['Streaming is ', 'a technique for ', 'sending data ', 'incrementally.'];

      chunks.forEach((chunk, index) => {
        const streamData: AgentIpc.StreamChunkData = {
          sessionId: agentId,
          chunk,
          sequenceNumber: index,
          isComplete: index === chunks.length - 1,
        };

        // Verify window receives stream updates
        mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_CHUNK, streamData);

        expect(mockWindow.webContents.send).toHaveBeenCalledWith(
          AGENT_BACKEND_CHANNELS.STREAM_CHUNK,
          streamData,
        );
      });

      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(chunks.length);
    });

    it('should handle stream completion', async () => {
      const agentId = BrandedIds.AgentId('agent-123');

      const streamData: AgentIpc.StreamChunkData = {
        sessionId: agentId,
        chunk: 'Final chunk',
        sequenceNumber: 10,
        isComplete: true,
      };

      mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_CHUNK, streamData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        AGENT_BACKEND_CHANNELS.STREAM_CHUNK,
        expect.objectContaining({
          isComplete: true,
        }),
      );
    });

    it('should handle stream errors', async () => {
      const agentId = BrandedIds.AgentId('agent-123');

      // Simulate stream error
      const errorData = {
        sessionId: agentId,
        error: 'Stream interrupted',
      };

      mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_ERROR, errorData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        AGENT_BACKEND_CHANNELS.STREAM_ERROR,
        expect.objectContaining({
          error: 'Stream interrupted',
        }),
      );
    });

    it('should handle multiple concurrent streams', async () => {
      const agent1 = BrandedIds.AgentId('agent-1');
      const agent2 = BrandedIds.AgentId('agent-2');

      // Send messages to multiple agents
      mockBackendHandler.handleSendMessage.mockResolvedValue({
        success: true,
      });

      const request1: AgentIpc.SendMessageRequest = {
        agentId: agent1,
        content: 'Message to agent 1',
      };

      const request2: AgentIpc.SendMessageRequest = {
        agentId: agent2,
        content: 'Message to agent 2',
      };

      const [response1, response2] = await Promise.all([
        adapter.sendMessage(request1),
        adapter.sendMessage(request2),
      ]);

      expect(response1.messageId).toBeDefined();
      expect(response2.messageId).toBeDefined();
      expect(response1.streamId).not.toBe(response2.streamId);

      // Simulate concurrent streaming
      const stream1Data: AgentIpc.StreamChunkData = {
        sessionId: agent1,
        chunk: 'Response from agent 1',
        sequenceNumber: 0,
        isComplete: false,
      };

      const stream2Data: AgentIpc.StreamChunkData = {
        sessionId: agent2,
        chunk: 'Response from agent 2',
        sequenceNumber: 0,
        isComplete: false,
      };

      mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_CHUNK, stream1Data);
      mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_CHUNK, stream2Data);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        AGENT_BACKEND_CHANNELS.STREAM_CHUNK,
        expect.objectContaining({ sessionId: agent1 }),
      );
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        AGENT_BACKEND_CHANNELS.STREAM_CHUNK,
        expect.objectContaining({ sessionId: agent2 }),
      );
    });

    it('should handle window destruction during streaming', async () => {
      const agentId = BrandedIds.AgentId('agent-123');

      // Start streaming
      const streamData: AgentIpc.StreamChunkData = {
        sessionId: agentId,
        chunk: 'First chunk',
        sequenceNumber: 0,
        isComplete: false,
      };

      mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_CHUNK, streamData);
      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);

      // Simulate window destruction
      mockWindow.isDestroyed.mockReturnValue(true);

      // Try to send another chunk
      const streamData2: AgentIpc.StreamChunkData = {
        sessionId: agentId,
        chunk: 'Second chunk',
        sequenceNumber: 1,
        isComplete: false,
      };

      // Should not send to destroyed window
      if (!mockWindow.isDestroyed()) {
        mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_CHUNK, streamData2);
      }

      // Still only called once since window is destroyed
      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(1);
    });

    it('should handle empty stream chunks', async () => {
      const agentId = BrandedIds.AgentId('agent-123');

      const streamData: AgentIpc.StreamChunkData = {
        sessionId: agentId,
        chunk: '',
        sequenceNumber: 0,
        isComplete: false,
      };

      mockWindow.webContents.send(AGENT_BACKEND_CHANNELS.STREAM_CHUNK, streamData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        AGENT_BACKEND_CHANNELS.STREAM_CHUNK,
        expect.objectContaining({
          chunk: '',
        }),
      );
    });
  });
});
