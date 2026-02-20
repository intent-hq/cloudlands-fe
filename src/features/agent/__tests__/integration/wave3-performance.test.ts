/**
 * Wave 3 Performance Integration Tests
 *
 * Tests for performance characteristics and memory efficiency
 * of the refactored agent system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ListenerManager } from '../../../../shared/utils/listener-manager';
import { MessagePruner } from '../../services/message-pruner';
import { MemoryMonitor } from '../../../../shared/monitoring/memory-monitor';
import { EventEmitter } from '../../../../shared/event-emitter';
import type { AgentSession } from '$shared/types';

describe('Wave 3 Performance Integration', () => {
  let listenerManager: ListenerManager;
  let messagePruner: MessagePruner;
  let memoryMonitor: MemoryMonitor;

  beforeEach(() => {
    listenerManager = new ListenerManager();
    messagePruner = new MessagePruner({
      maxMessagesPerSession: 500,
      maxMessageAge: 1000 * 60 * 60,
    });
    memoryMonitor = new MemoryMonitor({
      checkInterval: 100,
      warningThreshold: 500 * 1024 * 1024,
      enableGC: false,
    });
  });

  afterEach(() => {
    listenerManager.cleanup();
    messagePruner.stop();
    memoryMonitor.stop();
  });

  it('should handle large message histories efficiently', () => {
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

    // Add 1000 messages
    const startTime = Date.now();
    for (let i = 0; i < 1000; i++) {
      agent.messages.push({
        id: `msg-${i}` as any,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: new Date(Date.now() - i * 1000),
      });
    }
    const addTime = Date.now() - startTime;

    expect(addTime).toBeLessThan(1000); // Should add 1000 messages in < 1 second

    // Prune messages
    const pruneStart = Date.now();
    messagePruner.pruneOldMessages(agent);
    const pruneTime = Date.now() - pruneStart;

    expect(pruneTime).toBeLessThan(100); // Should prune in < 100ms
    expect(agent.messages.length).toBeLessThanOrEqual(500);
  });

  it('should manage many listeners efficiently', () => {
    const emitter = new EventEmitter();
    const startTime = Date.now();

    // Add 100 listeners
    for (let i = 0; i < 100; i++) {
      listenerManager.addListener(emitter, `event-${i}`, () => {});
    }

    const addTime = Date.now() - startTime;
    expect(addTime).toBeLessThan(500); // Should add 100 listeners in < 500ms

    // Cleanup
    const cleanupStart = Date.now();
    listenerManager.cleanup();
    const cleanupTime = Date.now() - cleanupStart;

    expect(cleanupTime).toBeLessThan(100); // Should cleanup in < 100ms
    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should track memory stats efficiently', async () => {
    const stats: any[] = [];

    memoryMonitor.on('stats', (stat: any) => {
      stats.push(stat);
    });

    memoryMonitor.start();

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(stats.length).toBeGreaterThan(0);

        const history = memoryMonitor.getHistory();
        expect(history.length).toBeGreaterThan(0);

        const avg = memoryMonitor.getAverageUsage();
        expect(avg).toBeGreaterThan(0);

        memoryMonitor.stop();
        resolve(undefined);
      }, 300);
    });
  });

  it('should estimate memory usage accurately', () => {
    const agent: AgentSession = {
      id: 'test-agent' as any,
      backendSessionId: null,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: 'ready' as any,
      messages: Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i}` as any,
        role: 'user' as const,
        contentBlocks: [{ type: 'text' as const, text: 'x'.repeat(100) }],
        timestamp: new Date(),
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const usage = messagePruner.estimateMemoryUsage(agent.messages);

    // 100 messages * 100 chars = 10KB minimum
    expect(usage).toBeGreaterThan(10000);
    expect(usage).toBeLessThan(1000000); // Less than 1MB
  });

  it('should handle rapid listener add/remove cycles', () => {
    const emitter = new EventEmitter();
    const startTime = Date.now();

    // Rapid add/remove cycles
    for (let i = 0; i < 50; i++) {
      const cleanup = listenerManager.addListener(emitter, 'test', () => {});
      cleanup();
    }

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(500); // Should complete in < 500ms
    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should maintain performance with concurrent operations', () => {
    const emitters = Array.from({ length: 10 }, () => new EventEmitter());
    const agent: AgentSession = {
      id: 'test-agent' as any,
      backendSessionId: null,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      status: 'ready' as any,
      messages: Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i}` as any,
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: new Date(),
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const startTime = Date.now();

    // Concurrent operations
    emitters.forEach((emitter) => {
      listenerManager.addListener(emitter, 'test', () => {});
    });

    messagePruner.pruneOldMessages(agent);
    const usage = messagePruner.estimateMemoryUsage(agent.messages);

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(500); // All operations in < 500ms
    expect(usage).toBeGreaterThan(0);
  });
});
