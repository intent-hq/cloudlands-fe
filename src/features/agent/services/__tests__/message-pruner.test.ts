import { describe, it, expect, beforeEach } from 'vitest';
import { MessagePruner } from '../message-pruner';
import type { AgentSession, AgentMessage } from '$shared/types';

describe('MessagePruner', () => {
  let pruner: MessagePruner;
  let agent: AgentSession;

  beforeEach(() => {
    pruner = new MessagePruner({
      maxMessagesPerSession: 10,
      maxMessageAge: 1000 * 60 * 60, // 1 hour
    });

    agent = {
      id: 'test-agent' as any,
      workspaceId: 'test-workspace' as any,
      name: 'Test Agent',
      messages: [],
      backendSessionId: null,
      status: 'active' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it('should prune messages exceeding max count', () => {
    // Add 15 messages
    for (let i = 0; i < 15; i++) {
      agent.messages.push({
        id: `msg-${i}` as any,
        role: 'user',
        content: `Message ${i}`,
        timestamp: new Date().toISOString(),
      });
    }

    expect(agent.messages.length).toBe(15);

    const pruned = pruner.pruneOldMessages(agent);

    expect(pruned).toBe(5);
    expect(agent.messages.length).toBe(10);
  });

  it('should prune messages older than maxMessageAge', () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 1000 * 60 * 60);

    agent.messages = [
      {
        id: 'msg-1' as any,
        role: 'user',
        content: 'Old message',
        timestamp: twoHoursAgo.toISOString(),
      },
      {
        id: 'msg-2' as any,
        role: 'assistant',
        content: 'Recent message',
        timestamp: now.toISOString(),
      },
    ];

    const pruned = pruner.pruneOldMessages(agent);

    expect(pruned).toBe(1);
    expect(agent.messages.length).toBe(1);
    expect(agent.messages[0].id).toBe('msg-2');
  });

  it('should prune streaming metadata from completed messages', () => {
    const message: AgentMessage = {
      id: 'msg-1' as any,
      role: 'assistant',
      content: 'Response',
      timestamp: new Date().toISOString(),
      streamingComplete: true,
      metadata: {
        chunksReceived: 10,
        firstChunkTime: Date.now(),
        lastChunkTime: Date.now(),
        totalChunkSize: 1000,
      },
    };

    pruner.pruneStreamingMetadata(message);

    expect(message.metadata?.chunksReceived).toBeUndefined();
    expect(message.metadata?.firstChunkTime).toBeUndefined();
    expect(message.metadata?.lastChunkTime).toBeUndefined();
    expect(message.metadata?.totalChunkSize).toBeUndefined();
  });

  it('should not prune metadata from incomplete messages', () => {
    const message: AgentMessage = {
      id: 'msg-1' as any,
      role: 'assistant',
      content: 'Response',
      timestamp: new Date().toISOString(),
      streamingComplete: false,
      metadata: {
        chunksReceived: 5,
        firstChunkTime: Date.now(),
      },
    };

    pruner.pruneStreamingMetadata(message);

    expect(message.metadata?.chunksReceived).toBe(5);
    expect(message.metadata?.firstChunkTime).toBeDefined();
  });

  it('should estimate memory usage of messages', () => {
    agent.messages = [
      {
        id: 'msg-1' as any,
        role: 'user',
        content: 'Hello world',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'msg-2' as any,
        role: 'assistant',
        content: 'Hi there!',
        timestamp: new Date().toISOString(),
      },
    ];

    const usage = pruner.estimateMemoryUsage(agent.messages);

    expect(usage).toBeGreaterThan(0);
  });

  it('should get pruning statistics', () => {
    const stats = pruner.getStats();

    expect(stats.maxMessages).toBe(10);
    expect(stats.maxAge).toBe(1000 * 60 * 60);
    expect(stats.interval).toBeGreaterThan(0);
  });

  it('should start and stop pruning', () => {
    pruner.start();
    expect(pruner).toBeDefined();

    pruner.stop();
    expect(pruner).toBeDefined();
  });
});
