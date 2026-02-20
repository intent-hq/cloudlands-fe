/**
 * Tests for the git worktree lock mechanism.
 *
 * This tests the promise-chaining lock pattern used by withGitWorktreeLock
 * to serialize git worktree operations per repository.
 */

import { describe, it, expect } from 'vitest';

/**
 * Standalone implementation of the lock mechanism for testing.
 * This mirrors the implementation in workspace.service.ts.
 */
function createLockManager() {
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    // Capture the current lock (if any) that we need to wait for
    const existingLock = locks.get(key);

    // Create our lock promise that will resolve when our operation completes
    let resolve: () => void;
    const newLock = new Promise<void>((r) => {
      resolve = r;
    });

    // IMPORTANT: Set our lock synchronously BEFORE any await.
    // This ensures that any concurrent callers will see our lock and chain after us.
    locks.set(key, newLock);

    // Now wait for the previous operation if there was one
    if (existingLock) {
      try {
        await existingLock;
      } catch {
        // Ignore errors from previous operation
      }
    }

    try {
      return await operation();
    } finally {
      resolve!();
      // Clean up the lock only if no one else has chained after us
      if (locks.get(key) === newLock) {
        locks.delete(key);
      }
    }
  }

  return { withLock, locks };
}

describe('git worktree lock mechanism', () => {
  it('should serialize concurrent operations on the same key', async () => {
    const { withLock } = createLockManager();
    const executionOrder: number[] = [];

    // Start 3 operations concurrently
    const op1 = withLock('repo', async () => {
      executionOrder.push(1);
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push(-1);
      return 'op1';
    });

    const op2 = withLock('repo', async () => {
      executionOrder.push(2);
      await new Promise((r) => setTimeout(r, 30));
      executionOrder.push(-2);
      return 'op2';
    });

    const op3 = withLock('repo', async () => {
      executionOrder.push(3);
      await new Promise((r) => setTimeout(r, 10));
      executionOrder.push(-3);
      return 'op3';
    });

    const results = await Promise.all([op1, op2, op3]);

    // All operations should complete with correct results
    expect(results).toEqual(['op1', 'op2', 'op3']);

    // Operations should be serialized: each starts after the previous ends
    // Expected order: 1, -1, 2, -2, 3, -3
    expect(executionOrder).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it('should allow parallel operations on different keys', async () => {
    const { withLock } = createLockManager();
    const executionOrder: string[] = [];

    const op1 = withLock('repo-a', async () => {
      executionOrder.push('a-start');
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push('a-end');
      return 'a';
    });

    const op2 = withLock('repo-b', async () => {
      executionOrder.push('b-start');
      await new Promise((r) => setTimeout(r, 30));
      executionOrder.push('b-end');
      return 'b';
    });

    const results = await Promise.all([op1, op2]);

    expect(results).toEqual(['a', 'b']);

    // Both should start before either ends (parallel execution)
    const aStartIdx = executionOrder.indexOf('a-start');
    const bStartIdx = executionOrder.indexOf('b-start');
    const aEndIdx = executionOrder.indexOf('a-end');
    const bEndIdx = executionOrder.indexOf('b-end');

    expect(aStartIdx).toBeLessThan(aEndIdx);
    expect(bStartIdx).toBeLessThan(bEndIdx);
    // b should end before a (since b is shorter)
    expect(bEndIdx).toBeLessThan(aEndIdx);
  });

  it('should release lock even if operation throws', async () => {
    const { withLock } = createLockManager();
    const executionOrder: number[] = [];

    // First operation throws
    const op1 = withLock('repo', async () => {
      executionOrder.push(1);
      throw new Error('op1 failed');
    }).catch(() => 'op1-caught');

    // Second operation should still run after first fails
    const op2 = withLock('repo', async () => {
      executionOrder.push(2);
      return 'op2';
    });

    const results = await Promise.all([op1, op2]);

    expect(results).toEqual(['op1-caught', 'op2']);
    expect(executionOrder).toEqual([1, 2]);
  });

  it('should handle many concurrent operations without deadlock', async () => {
    const { withLock } = createLockManager();
    const count = 20;
    const executionOrder: number[] = [];

    const operations = Array.from({ length: count }, (_, i) =>
      withLock('repo', async () => {
        executionOrder.push(i);
        await new Promise((r) => setTimeout(r, 2));
        return i;
      }),
    );

    const results = await Promise.all(operations);

    // All operations should complete
    expect(results).toHaveLength(count);
    expect(executionOrder).toHaveLength(count);

    // Each number should appear exactly once
    const sorted = [...executionOrder].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: count }, (_, i) => i));
  });

  it('should clean up lock after last operation', async () => {
    const { withLock, locks } = createLockManager();

    await withLock('cleanup-test', async () => {
      return 'done';
    });

    // Lock should be cleaned up
    expect(locks.has('cleanup-test')).toBe(false);
  });

  it('should not clean up lock if another operation is waiting', async () => {
    const { withLock, locks } = createLockManager();
    let op1Resolve: () => void;

    const op1 = withLock('repo', async () => {
      await new Promise<void>((r) => {
        op1Resolve = r;
      });
      return 'op1';
    });

    // Wait a tick for op1 to start
    await new Promise((r) => setTimeout(r, 0));

    // Start op2 while op1 is running
    const op2 = withLock('repo', async () => {
      return 'op2';
    });

    // Lock should exist (op2's lock)
    expect(locks.has('repo')).toBe(true);

    // Complete op1
    op1Resolve!();
    await op1;

    // Lock should still exist (op2 is now running or about to run)
    // Wait for op2 to complete
    await op2;

    // Now lock should be cleaned up
    expect(locks.has('repo')).toBe(false);
  });
});
