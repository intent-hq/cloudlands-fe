/**
 * Agent Test Utilities
 *
 * Helper functions and utilities for testing the agent system.
 */

import type { AgentSession, AgentMessage } from '../../../shared/types';
import { AgentStatus } from '../../../shared/types/agent.types';
import { createAgentId, createWorkspaceId } from '../../../shared/types/branded-ids';
import { randomUUID } from 'crypto';

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
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
