/**
 * Tests for evictIdleProcesses in agent-process-registry.
 *
 * Verifies LRU eviction order, protection of active/pending processes,
 * and count-limited eviction.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import {
  registerProcess,
  deregisterProcess,
  evictIdleProcesses,
  getRegistrySize,
  _resetForTesting,
  type ProcessEntry,
} from '../agent-process-registry';

// Mock the Logger to suppress output during tests
vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

function makeEntry(overrides: Partial<ProcessEntry> & { pid: number }): ProcessEntry {
  return {
    agentId: `agent-${overrides.pid}`,
    workspaceId: `ws-${overrides.pid}`,
    lastActiveTimestamp: Date.now(),
    isActive: false,
    kill: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('evictIdleProcesses', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('evicts idle processes in LRU order (oldest first)', async () => {
    const e1 = makeEntry({ pid: 1, lastActiveTimestamp: 1000 });
    const e2 = makeEntry({ pid: 2, lastActiveTimestamp: 3000 });
    const e3 = makeEntry({ pid: 3, lastActiveTimestamp: 2000 });
    registerProcess(e1);
    registerProcess(e2);
    registerProcess(e3);

    const evicted = await evictIdleProcesses(2);

    expect(evicted).toBe(2);
    // Oldest (1000) and second-oldest (2000) should be killed
    expect(e1.kill).toHaveBeenCalled();
    expect(e3.kill).toHaveBeenCalled();
    // Newest (3000) should NOT be killed
    expect(e2.kill).not.toHaveBeenCalled();
    expect(getRegistrySize()).toBe(1);
  });

  it('evicts ALL idle processes when count is omitted', async () => {
    registerProcess(makeEntry({ pid: 10, lastActiveTimestamp: 100 }));
    registerProcess(makeEntry({ pid: 20, lastActiveTimestamp: 200 }));
    registerProcess(makeEntry({ pid: 30, lastActiveTimestamp: 300 }));

    const evicted = await evictIdleProcesses();

    expect(evicted).toBe(3);
    expect(getRegistrySize()).toBe(0);
  });

  it('never evicts active processes', async () => {
    const active = makeEntry({ pid: 1, isActive: true, lastActiveTimestamp: 1 });
    const idle = makeEntry({ pid: 2, isActive: false, lastActiveTimestamp: 2 });
    registerProcess(active);
    registerProcess(idle);

    const evicted = await evictIdleProcesses();

    expect(evicted).toBe(1);
    expect(active.kill).not.toHaveBeenCalled();
    expect(idle.kill).toHaveBeenCalled();
    expect(getRegistrySize()).toBe(1);
  });

  it('never evicts processes with pending work', async () => {
    const pending = makeEntry({
      pid: 1,
      lastActiveTimestamp: 1,
      hasPendingWork: () => true,
    });
    const idle = makeEntry({ pid: 2, lastActiveTimestamp: 2 });
    registerProcess(pending);
    registerProcess(idle);

    const evicted = await evictIdleProcesses();

    expect(evicted).toBe(1);
    expect(pending.kill).not.toHaveBeenCalled();
    expect(idle.kill).toHaveBeenCalled();
    expect(getRegistrySize()).toBe(1);
  });

  it('returns 0 when no idle processes exist', async () => {
    registerProcess(makeEntry({ pid: 1, isActive: true }));
    registerProcess(makeEntry({ pid: 2, hasPendingWork: () => true }));

    const evicted = await evictIdleProcesses();

    expect(evicted).toBe(0);
    expect(getRegistrySize()).toBe(2);
  });

  it('returns 0 when registry is empty', async () => {
    const evicted = await evictIdleProcesses();
    expect(evicted).toBe(0);
  });

  it('handles kill() failures gracefully and still deregisters', async () => {
    const failing = makeEntry({
      pid: 1,
      lastActiveTimestamp: 1,
      kill: vi.fn().mockRejectedValue(new Error('process already dead')),
    });
    registerProcess(failing);

    const evicted = await evictIdleProcesses();

    expect(evicted).toBe(1);
    expect(getRegistrySize()).toBe(0);
  });

  it('respects count limit', async () => {
    for (let i = 1; i <= 5; i++) {
      registerProcess(makeEntry({ pid: i, lastActiveTimestamp: i * 1000 }));
    }

    const evicted = await evictIdleProcesses(3);

    expect(evicted).toBe(3);
    expect(getRegistrySize()).toBe(2);
  });

  it('skips a process that becomes active between candidate selection and kill()', async () => {
    // Simulate the race: process 1's kill() causes process 2 to become active
    // (e.g. a message arrives and marks it active while we await the first kill).
    const e2 = makeEntry({ pid: 2, lastActiveTimestamp: 2000 });
    const e1 = makeEntry({
      pid: 1,
      lastActiveTimestamp: 1000,
      kill: vi.fn().mockImplementation(async () => {
        // Side-effect: process 2 becomes active while we're awaiting this kill
        e2.isActive = true;
      }),
    });
    const e3 = makeEntry({ pid: 3, lastActiveTimestamp: 3000 });
    registerProcess(e1);
    registerProcess(e2);
    registerProcess(e3);

    const evicted = await evictIdleProcesses();

    // e1 should be killed (oldest), e2 should be SKIPPED (became active), e3 should be killed
    expect(e1.kill).toHaveBeenCalled();
    expect(e2.kill).not.toHaveBeenCalled();
    expect(e3.kill).toHaveBeenCalled();
    expect(evicted).toBe(2);
    // e2 remains (active), e1 and e3 were deregistered
    expect(getRegistrySize()).toBe(1);
  });

  it('skips a process that was concurrently deregistered during eviction', async () => {
    // Simulate: process 1's kill() triggers an exit handler that deregisters process 2
    // before evictIdleProcesses gets to it.
    const e1 = makeEntry({
      pid: 1,
      lastActiveTimestamp: 1000,
      kill: vi.fn().mockImplementation(async () => {
        // Side-effect: something deregisters process 2 concurrently
        deregisterProcess(2);
      }),
    });
    const e2 = makeEntry({ pid: 2, lastActiveTimestamp: 2000 });
    registerProcess(e1);
    registerProcess(e2);

    const evicted = await evictIdleProcesses();

    expect(e1.kill).toHaveBeenCalled();
    // e2 should NOT have kill() called — it was already deregistered
    expect(e2.kill).not.toHaveBeenCalled();
    expect(evicted).toBe(1);
    expect(getRegistrySize()).toBe(0);
  });
});

