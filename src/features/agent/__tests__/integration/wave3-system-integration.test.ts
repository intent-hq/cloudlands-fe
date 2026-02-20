/**
 * Wave 3 System Integration Tests
 *
 * Comprehensive end-to-end tests for the complete agent system
 * including memory management, cleanup, and concurrent operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ListenerManager } from '../../../../shared/utils/listener-manager';
import { MessagePruner } from '../../services/message-pruner';
import { MemoryMonitor } from '../../../../shared/monitoring/memory-monitor';
import { EventEmitter } from '../../../../shared/event-emitter';
import type { AgentSession, AgentMessage } from '$shared/types';

describe('Wave 3 System Integration', () => {
  let listenerManager: ListenerManager;
  let messagePruner: MessagePruner;
  let memoryMonitor: MemoryMonitor;

  beforeEach(() => {
    listenerManager = new ListenerManager();
    messagePruner = new MessagePruner({
      maxMessagesPerSession: 100,
      maxMessageAge: 1000 * 60 * 60,
    });
    memoryMonitor = new MemoryMonitor({
      checkInterval: 100,
      warningThreshold: 100 * 1024 * 1024,
      enableGC: false,
    });
  });

  afterEach(() => {
    listenerManager.cleanup();
    messagePruner.stop();
    memoryMonitor.stop();
  });

  it('should manage listeners without memory leaks', () => {
    const emitter = new EventEmitter();
    const handlers = Array.from({ length: 10 }, () => vi.fn());

    handlers.forEach((handler) => {
      listenerManager.addListener(emitter, 'test', handler);
    });

    expect(listenerManager.getListenerCount()).toBe(10);

    listenerManager.cleanup();

    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should prune messages and maintain agent state', () => {
    const agent: AgentSession = {
      id: 'test-agent' as any,
      backendSessionId: null,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: 'ready' as any,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Add 150 messages
    for (let i = 0; i < 150; i++) {
      agent.messages.push({
        id: `msg-${i}` as any,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: new Date(),
      });
    }

    expect(agent.messages.length).toBe(150);

    messagePruner.pruneOldMessages(agent);

    expect(agent.messages.length).toBeLessThanOrEqual(100);
  });

  it('should monitor memory and emit events', async () => {
    let statsReceived = false;

    memoryMonitor.on('stats', () => {
      statsReceived = true;
    });

    memoryMonitor.start();

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(statsReceived).toBe(true);
        memoryMonitor.stop();
        resolve(undefined);
      }, 200);
    });
  });

  it('should handle concurrent listener operations', () => {
    const emitters = Array.from({ length: 5 }, () => new EventEmitter());
    const handlers = Array.from({ length: 5 }, () => vi.fn());

    // Add listeners concurrently
    emitters.forEach((emitter, i) => {
      handlers.forEach((handler) => {
        listenerManager.addListener(emitter, `event-${i}`, handler);
      });
    });

    expect(listenerManager.getListenerCount()).toBe(25);

    listenerManager.cleanup();

    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should estimate and track memory usage', () => {
    const agent: AgentSession = {
      id: 'test-agent' as any,
      backendSessionId: null,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: 'ready' as any,
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}` as any,
        role: 'user' as const,
        content: 'x'.repeat(1000),
        timestamp: new Date(),
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const usage = messagePruner.estimateMemoryUsage(agent.messages);

    expect(usage).toBeGreaterThan(50000); // At least 50KB
  });

  it('should clean up streaming metadata', () => {
    const message: AgentMessage = {
      id: 'msg-1' as any,
      role: 'assistant',
      content: 'Response',
      timestamp: new Date(),
      streamingComplete: true,
      metadata: {
        chunksReceived: 10,
        firstChunkTime: Date.now(),
        lastChunkTime: Date.now(),
      },
    };

    messagePruner.pruneStreamingMetadata(message);

    expect(message.metadata?.chunksReceived).toBeUndefined();
    expect(message.metadata?.firstChunkTime).toBeUndefined();
  });
});
