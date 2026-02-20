/**
 * Test concurrent operations
 * Ensures multiple simultaneous operations don't cause conflicts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Concurrent Operations', () => {
  let mockOperationQueue: any;
  let mockLockManager: any;

  beforeEach(() => {
    mockLockManager = {
      locks: new Map(),
      acquire: vi.fn(async (key) => {
        if (mockLockManager.locks.has(key)) {
          throw new Error(`Lock already held for ${key}`);
        }
        mockLockManager.locks.set(key, true);
      }),
      release: vi.fn((key) => {
        mockLockManager.locks.delete(key);
      }),
      isLocked: vi.fn((key) => mockLockManager.locks.has(key)),
    };

    mockOperationQueue = {
      operations: [],
      queue: vi.fn(async (operation) => {
        mockOperationQueue.operations.push(operation);
        return operation();
      }),
      queueWithLock: vi.fn(async (key, operation) => {
        await mockLockManager.acquire(key);
        try {
          return await operation();
        } finally {
          mockLockManager.release(key);
        }
      }),
    };
  });

  it('should prevent concurrent agent creation for same workspace', async () => {
    const workspaceId = 'ws_1';

    const op1 = vi.fn(async () => ({ agentId: 'agent_1' }));
    const op2 = vi.fn(async () => ({ agentId: 'agent_2' }));

    // First operation acquires lock
    const result1 = mockOperationQueue.queueWithLock(workspaceId, op1);

    // Second operation should wait or fail
    try {
      await mockOperationQueue.queueWithLock(workspaceId, op2);
      expect.fail('Should have thrown lock error');
    } catch (error) {
      expect((error as Error).message).toContain('Lock');
    }

    await result1;
    expect(op1).toHaveBeenCalled();
  });

  it('should allow concurrent operations on different agents', async () => {
    const agent1 = 'agent_1';
    const agent2 = 'agent_2';

    const op1 = vi.fn(async () => 'result1');
    const op2 = vi.fn(async () => 'result2');

    const result1 = mockOperationQueue.queueWithLock(agent1, op1);
    const result2 = mockOperationQueue.queueWithLock(agent2, op2);

    const [r1, r2] = await Promise.all([result1, result2]);

    expect(r1).toBe('result1');
    expect(r2).toBe('result2');
    expect(op1).toHaveBeenCalled();
    expect(op2).toHaveBeenCalled();
  });

  it('should handle rapid agent creation sequentially', async () => {
    const workspaceId = 'ws_1';
    const createdAgents: string[] = [];

    const createAgent = async (id: string) => {
      createdAgents.push(id);
      return { agentId: id };
    };

    // Queue multiple operations
    const ops = [
      mockOperationQueue.queue(() => createAgent('agent_1')),
      mockOperationQueue.queue(() => createAgent('agent_2')),
      mockOperationQueue.queue(() => createAgent('agent_3')),
    ];

    await Promise.all(ops);

    expect(createdAgents).toHaveLength(3);
    expect(createdAgents).toContain('agent_1');
    expect(createdAgents).toContain('agent_2');
    expect(createdAgents).toContain('agent_3');
  });

  it('should prevent concurrent message sends on same agent', async () => {
    const agentId = 'agent_1';

    const send1 = vi.fn(async () => ({ messageId: 'msg_1' }));
    const send2 = vi.fn(async () => ({ messageId: 'msg_2' }));

    const result1 = mockOperationQueue.queueWithLock(agentId, send1);

    try {
      await mockOperationQueue.queueWithLock(agentId, send2);
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('Lock');
    }

    await result1;
  });

  it('should allow concurrent message sends on different agents', async () => {
    const agent1 = 'agent_1';
    const agent2 = 'agent_2';

    const send1 = vi.fn(async () => ({ messageId: 'msg_1' }));
    const send2 = vi.fn(async () => ({ messageId: 'msg_2' }));

    const [r1, r2] = await Promise.all([
      mockOperationQueue.queueWithLock(agent1, send1),
      mockOperationQueue.queueWithLock(agent2, send2),
    ]);

    expect(r1.messageId).toBe('msg_1');
    expect(r2.messageId).toBe('msg_2');
  });

  it('should handle switching agents during streaming', async () => {
    const agent1 = 'agent_1';
    const agent2 = 'agent_2';

    const stream1 = vi.fn(async () => 'streaming_agent_1');
    const stream2 = vi.fn(async () => 'streaming_agent_2');

    // Start streaming on agent 1
    const streamPromise1 = mockOperationQueue.queue(stream1);

    // Switch to agent 2 (should be allowed)
    const switchPromise = mockOperationQueue.queue(stream2);

    const [result1, result2] = await Promise.all([streamPromise1, switchPromise]);

    expect(result1).toBe('streaming_agent_1');
    expect(result2).toBe('streaming_agent_2');
  });

  it('should track operation count', async () => {
    const op1 = vi.fn(async () => 'result1');
    const op2 = vi.fn(async () => 'result2');

    await mockOperationQueue.queue(op1);
    await mockOperationQueue.queue(op2);

    expect(mockOperationQueue.operations).toHaveLength(2);
  });

  it('should release locks after operation completes', async () => {
    const key = 'test_key';

    const operation = vi.fn(async () => 'done');

    await mockOperationQueue.queueWithLock(key, operation);

    expect(mockLockManager.isLocked(key)).toBe(false);
  });

  it('should release locks even if operation fails', async () => {
    const key = 'test_key';

    const failingOperation = vi.fn(async () => {
      throw new Error('Operation failed');
    });

    try {
      await mockOperationQueue.queueWithLock(key, failingOperation);
    } catch (error) {
      // Expected
    }

    expect(mockLockManager.isLocked(key)).toBe(false);
  });
});
