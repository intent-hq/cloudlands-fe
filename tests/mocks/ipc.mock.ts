/**
 * IPC Mock for Testing
 *
 * Provides mock implementations of Electron IPC for testing.
 */

import { vi } from 'vitest';
import type { AgentConfig, AgentSession } from '$shared/types/agent.types';

interface MockIPCHandlers {
  [channel: string]: (data: any) => Promise<any> | any;
}

interface MockEventEmitter {
  listeners: Map<string, Map<string, (data: any) => void>>;
  emit(channel: string, data: any): void;
  on(channel: string, handler: (data: any) => void): string;
  off(channel: string, handler: (data: any) => void): void;
  offById(channel: string, listenerId: string): void;
  removeAllListeners(channel: string): void;
}

export class IPCMock {
  private handlers: MockIPCHandlers = {};
  private eventEmitter: MockEventEmitter;
  private mockSessions = new Map<string, any>();
  private mockFiles = new Map<string, string>();
  private listenerIdCounter = 0;

  constructor() {
    this.eventEmitter = {
      listeners: new Map(),
      emit: (channel: string, data: any) => {
        const handlers = this.eventEmitter.listeners.get(channel);
        if (handlers) {
          handlers.forEach((handler) => handler(data));
        }
      },
      on: (channel: string, handler: (data: any) => void) => {
        if (!this.eventEmitter.listeners.has(channel)) {
          this.eventEmitter.listeners.set(channel, new Map());
        }
        const listenerId = this.generateListenerId();
        this.eventEmitter.listeners.get(channel)!.set(listenerId, handler);
        return listenerId;
      },
      off: (channel: string, handler: (data: any) => void) => {
        const handlers = this.eventEmitter.listeners.get(channel);
        if (!handlers) return;

        for (const [listenerId, storedHandler] of handlers.entries()) {
          if (storedHandler === handler) {
            handlers.delete(listenerId);
            break;
          }
        }

        if (handlers.size === 0) {
          this.eventEmitter.listeners.delete(channel);
        }
      },
      offById: (channel: string, listenerId: string) => {
        const handlers = this.eventEmitter.listeners.get(channel);
        if (!handlers) return;
        handlers.delete(listenerId);
        if (handlers.size === 0) {
          this.eventEmitter.listeners.delete(channel);
        }
      },
      removeAllListeners: (channel: string) => {
        this.eventEmitter.listeners.delete(channel);
      },
    };

    this.setupDefaultHandlers();
  }

  /**
   * Set up default IPC handlers
   */
  private setupDefaultHandlers() {
    // Agent backend handlers
    this.handlers['agent:backend:create'] = async (data) => {
      const sessionId = `session-${Date.now()}`;
      const agentData = {
        sessionId,
        agentId: data.agentId,
        name: data.name,
        model: data.model,
      };

      this.mockSessions.set(data.agentId, agentData);

      return {
        success: true,
        data: agentData,
      };
    };

    this.handlers['agent:backend:stream-message'] = async (data) => {
      const { agentId, content, sessionId } = data;

      // Always use sessionId for consistency with the fix
      const streamSessionId = sessionId;

      // Simulate streaming response
      setTimeout(() => {
        this.eventEmitter.emit(`agent:stream:${streamSessionId}`, {
          type: 'chunk',
          data: 'Mock response: ',
          timestamp: Date.now(),
          sessionId: streamSessionId,
          agentId,
        });
      }, 10);

      setTimeout(() => {
        this.eventEmitter.emit(`agent:stream:${streamSessionId}`, {
          type: 'chunk',
          data: content,
          timestamp: Date.now(),
          sessionId: streamSessionId,
          agentId,
        });
      }, 20);

      setTimeout(() => {
        this.eventEmitter.emit(`agent:stream:${streamSessionId}`, {
          type: 'complete',
          timestamp: Date.now(),
          sessionId: streamSessionId,
          agentId,
        });
      }, 30);

      return { success: true };
    };

    this.handlers['agent:backend:stop'] = async (data) => {
      this.mockSessions.delete(data.agentId);
      return { success: true };
    };

    // File system handlers
    this.handlers['file:read'] = async (data) => {
      const content = this.mockFiles.get(data.path);
      if (content) {
        return { success: true, data: content };
      }
      return { success: false, error: 'File not found' };
    };

    this.handlers['file:write'] = async (data) => {
      this.mockFiles.set(data.path, data.content);
      return { success: true };
    };

    this.handlers['file:delete'] = async (data) => {
      this.mockFiles.delete(data.path);
      return { success: true };
    };

    this.handlers['file:mkdir'] = async () => ({ success: true });

    this.handlers['file:list'] = async (data) => {
      const files: any[] = [];
      const prefix = `${data.path}/`;

      for (const filePath of this.mockFiles.keys()) {
        if (filePath.startsWith(prefix)) {
          const relativePath = filePath.substring(prefix.length);

          // If recursive is false, only include files in immediate directory
          if (!data.recursive && relativePath.includes('/')) {
            continue;
          }

          files.push({
            name: relativePath.split('/')[0],
            path: filePath,
            isFile: true,
            isDirectory: false,
          });
        }
      }

      return { success: true, data: files };
    };

    this.handlers['file:copy'] = async (data) => {
      const content = this.mockFiles.get(data.source);
      if (content) {
        this.mockFiles.set(data.destination, content);
        return { success: true };
      }
      return { success: false, error: 'Source file not found' };
    };

    // Agent rules handlers
    this.handlers['agent:get-rules-file-content'] = async (data) => {
      const mockRules: Record<string, string> = {
        chat: 'You are a helpful AI assistant.',
        debug: 'Debug the issue.',
        workspace: 'Help with workspace tasks.',
        'task-loop': 'Work through tasks iteratively.',
        'task-focused': 'Focus on completing a single task.',
      };

      return {
        success: true,
        data: mockRules[data.instruction] || mockRules.chat,
      };
    };

    // Model handlers
    this.handlers['agent:get-available-models'] = async () => ({
      success: true,
      data: [
        { id: 'augment', name: 'Augment', provider: 'augment', available: true },
        { id: 'sonnet-3.5', name: 'Claude Sonnet', provider: 'anthropic', available: true },
        { id: 'gpt-4', name: 'GPT-4', provider: 'openai', available: true },
      ],
    });
  }

  /**
   * Mock the invoke function
   */
  mockInvoke() {
    return vi.fn(async (channel: string, data?: any) => {
      const handler = this.handlers[channel];
      if (handler) {
        return handler(data);
      }

      console.warn(`No mock handler for IPC channel: ${channel}`);
      return { success: false, error: `No handler for ${channel}` };
    });
  }

  /**
   * Install the mock on window.electronAPI
   */
  install() {
    (window as any).electronAPI = {
      invoke: this.mockInvoke(),
      on: this.eventEmitter.on.bind(this.eventEmitter),
      off: this.eventEmitter.off.bind(this.eventEmitter),
      offById: this.eventEmitter.offById.bind(this.eventEmitter),
      removeAllListeners: this.eventEmitter.removeAllListeners.bind(this.eventEmitter),
      emit: this.eventEmitter.emit.bind(this.eventEmitter),
    };
  }

  private generateListenerId(): string {
    this.listenerIdCounter += 1;
    // Counter prevents collisions within the same millisecond.
    return `l${Date.now()}_${this.listenerIdCounter}`;
  }

  /**
   * Add a custom handler
   */
  addHandler(channel: string, handler: (data: any) => Promise<any> | any) {
    this.handlers[channel] = handler;
  }

  /**
   * Simulate a stream event
   */
  simulateStreamEvent(sessionId: string, event: any) {
    this.eventEmitter.emit(`agent:stream:${sessionId}`, event);
  }

  /**
   * Add a mock file
   */
  addMockFile(path: string, content: string) {
    this.mockFiles.set(path, content);
  }

  /**
   * Get a mock file
   */
  getMockFile(path: string): string | undefined {
    return this.mockFiles.get(path);
  }

  /**
   * Clear all mock data
   */
  clear() {
    this.mockSessions.clear();
    this.mockFiles.clear();
    this.eventEmitter.listeners.clear();
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      sessions: this.mockSessions.size,
      files: this.mockFiles.size,
      listeners: this.eventEmitter.listeners.size,
      handlers: Object.keys(this.handlers).length,
    };
  }
}

/**
 * Create and install IPC mock for testing
 */
export function setupIPCMock(): IPCMock {
  const mock = new IPCMock();
  mock.install();
  return mock;
}

/**
 * Helper to create mock agent session
 */
export function createMockSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: `agent-${Date.now()}`,
    sessionId: `session-${Date.now()}`,
    workspaceId: 'test-workspace',
    name: 'Test Agent',
    status: 'active',
    messages: [],
    model: 'augment',
    systemPrompt: 'Test prompt',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock agent config
 */
export function createMockConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: `agent-${Date.now()}`,
    name: 'Test Agent',
    model: 'augment',
    systemPrompt: 'Test prompt',
    workspaceId: 'test-workspace',
    provider: 'augment',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
