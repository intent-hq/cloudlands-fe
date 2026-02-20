/**
 * Agent Test Utilities
 *
 * Helper functions and utilities for testing the agent system.
 */

import type {
  AgentSession,
  AgentMessage,
  AgentId,
  SessionId,
  WorkspaceId,
} from '../../../shared/types';
import { AgentStatus } from '../../../shared/types/agent.types';
import {
  createAgentId,
  createSessionId,
  createWorkspaceId,
} from '../../../shared/types/branded-ids';
import type { AgentConfig } from '../agent-types';
import { randomUUID } from 'crypto';
import { Logger } from '../../../main/utils/logger';

const logger = new Logger('AgentTestUtils');

/**
 * Create a mock agent session for testing
 */
export function createMockSession(overrides: Partial<AgentSession> = {}): AgentSession {
  // Use UUIDs for all IDs
  const agentIdStr = randomUUID();
  const workspaceIdStr = randomUUID();

  const agentId = overrides.id || createAgentId(agentIdStr);
  const workspaceId = overrides.workspaceId || createWorkspaceId(workspaceIdStr);

  return {
    id: agentId,
    backendSessionId: null,
    workspaceId,
    name: `test-agent-${agentId}`,
    model: 'test-model',
    status: AgentStatus.Idle,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    isStreaming: false,
    isProcessing: false,
    ...overrides,
  };
}

/**
 * Create a mock agent message
 */
export function createMockMessage(
  role: 'user' | 'assistant' | 'system' = 'user',
  content: string = 'Test message',
  overrides: Partial<AgentMessage> = {},
): AgentMessage & { content: string } {
  const message: AgentMessage & { content: string } = {
    id: `msg-${Date.now()}-${Math.random()}`,
    role,
    content,
    contentBlocks: [{ type: 'text', text: content }],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
  return message;
}

/**
 * Create a mock agent configuration
 */
export function createMockConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: 'test-provider',
    model: 'test-model',
    apiKey: 'test-api-key', // pragma: allowlist secret
    temperature: 0.7,
    maxTokens: 1000,
    systemPrompt: 'You are a test agent',
    ...overrides,
  };
}

/**
 * Simulate agent streaming response
 */
export async function* simulateStreaming(
  content: string,
  chunkSize: number = 5,
  delayMs: number = 50,
): AsyncGenerator<string> {
  const words = content.split(' ');
  let buffer = '';

  for (const word of words) {
    buffer += (buffer ? ' ' : '') + word;

    if (buffer.length >= chunkSize) {
      yield buffer;
      buffer = '';
      await delay(delayMs);
    }
  }

  if (buffer) {
    yield buffer;
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await delay(interval);
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Create a memory snapshot for leak detection
 */
export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

export function takeMemorySnapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    timestamp: Date.now(),
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    rss: usage.rss,
  };
}

/**
 * Compare two memory snapshots
 */
export function compareMemorySnapshots(
  before: MemorySnapshot,
  after: MemorySnapshot,
  threshold: number = 10 * 1024 * 1024, // 10MB default
): {
  hasLeak: boolean;
  diff: Partial<MemorySnapshot>;
  percentage: number;
} {
  const diff = {
    heapUsed: after.heapUsed - before.heapUsed,
    heapTotal: after.heapTotal - before.heapTotal,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
    rss: after.rss - before.rss,
  };

  const hasLeak = diff.heapUsed > threshold;
  const percentage = before.heapUsed > 0 ? (diff.heapUsed / before.heapUsed) * 100 : 0;

  return { hasLeak, diff, percentage };
}

/**
 * Force garbage collection (requires --expose-gc flag)
 */
export function forceGC(): void {
  if (global.gc) {
    global.gc();
  } else {
    logger.warn('Garbage collection not exposed. Run with --expose-gc flag.');
  }
}

/**
 * Measure function execution time
 */
export async function measureTime<T>(
  fn: () => T | Promise<T>,
  label?: string,
): Promise<{ result: T; duration: number }> {
  const startTime = performance.now();
  const result = await fn();
  const duration = performance.now() - startTime;

  if (label) {
    logger.info(`${label}: ${duration.toFixed(2)}ms`);
  }

  return { result, duration };
}

/**
 * Create a test workspace
 */
export function createTestWorkspace(id?: WorkspaceId) {
  const workspaceIdStr = randomUUID();
  return {
    id: id || createWorkspaceId(workspaceIdStr),
    name: 'Test Workspace',
    path: '/test/workspace',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPCHandler = (...args: any[]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPCResponse = ((...args: any[]) => any) | any;

/**
 * Mock IPC communication
 */
export class MockIPCChannel {
  private handlers: Map<string, IPCHandler> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private responses: Map<string, any> = new Map();

  on(channel: string, handler: IPCHandler): void {
    this.handlers.set(channel, handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(channel: string, ...args: any[]): void {
    const handler = this.handlers.get(channel);
    if (handler) {
      handler(...args);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setResponse(channel: string, response: any): void {
    this.responses.set(channel, response);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async invoke(channel: string, ...args: any[]): Promise<any> {
    const response = this.responses.get(channel) as IPCResponse;
    if (typeof response === 'function') {
      return response(...args);
    }
    return response;
  }

  clear(): void {
    this.handlers.clear();
    this.responses.clear();
  }
}

/**
 * Create a test error with context
 */
export function createTestError(
  message: string,
  code?: string,
  context?: any,
): Error & { code?: string; context?: any } {
  const error = new Error(message) as Error & { code?: string; context?: any };
  if (code) error.code = code;
  if (context) error.context = context;
  return error;
}

/**
 * Validate agent session structure
 */
export function validateSession(session: any): session is AgentSession {
  return (
    session &&
    typeof session === 'object' &&
    'id' in session &&
    'workspaceId' in session &&
    'name' in session &&
    'status' in session &&
    'messages' in session &&
    Array.isArray(session.messages)
  );
}

/**
 * Generate random test data
 */
export function generateTestData(count: number = 10): {
  sessions: AgentSession[];
  messages: AgentMessage[];
} {
  const sessions: AgentSession[] = [];
  const messages: AgentMessage[] = [];

  for (let i = 0; i < count; i++) {
    const session = createMockSession();
    const messageCount = Math.floor(Math.random() * 10) + 1;

    for (let j = 0; j < messageCount; j++) {
      const role = j % 2 === 0 ? 'user' : 'assistant';
      const message = createMockMessage(
        role as 'user' | 'assistant',
        `Test message ${j} for session ${i}`,
      );
      messages.push(message);
      session.messages.push(message);
    }

    sessions.push(session);
  }

  return { sessions, messages };
}

/**
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry helper for flaky operations
 */
export async function retry<T>(
  fn: () => T | Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await delay(delayMs * attempt);
      }
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Clean up test resources
 */
export async function cleanupTestResources(
  sessions: AgentSession[],
  handlers: (() => void)[] = [],
): Promise<void> {
  // Clear sessions
  sessions.length = 0;

  // Remove event handlers
  for (const handler of handlers) {
    if (typeof handler === 'function') {
      handler();
    }
  }

  // Force garbage collection if available
  forceGC();

  // Small delay to allow cleanup
  await delay(100);
}
