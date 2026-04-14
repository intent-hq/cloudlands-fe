import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeProcessCap,
  registerProcess,
  evictIdleProcesses,
  getRegistrySize,
  _resetForTesting,
} from '../agent-process-registry';

const GB = 1024 ** 3;

describe('computeProcessCap', () => {
  it.each([
    // ≤8 GB → 4
    { ram: 4 * GB, expected: 4, label: '4 GB' },
    { ram: 8 * GB, expected: 4, label: '8 GB (boundary)' },

    // ≤16 GB → 8
    { ram: 12 * GB, expected: 8, label: '12 GB' },
    { ram: 16 * GB, expected: 8, label: '16 GB (boundary)' },

    // ≤32 GB → 20
    { ram: 24 * GB, expected: 20, label: '24 GB' },
    { ram: 32 * GB, expected: 20, label: '32 GB (boundary)' },

    // ≤64 GB → 30
    { ram: 48 * GB, expected: 30, label: '48 GB' },
    { ram: 64 * GB, expected: 30, label: '64 GB (boundary)' },

    // >64 GB → 100
    { ram: 128 * GB, expected: 100, label: '128 GB' },
  ])('returns $expected for $label RAM', ({ ram, expected }) => {
    expect(computeProcessCap(ram)).toBe(expected);
  });
});

describe('evictIdleProcesses', () => {
  let nextPid = 1000;

  beforeEach(() => {
    _resetForTesting();
    nextPid = 1000;
  });

  afterEach(() => {
    _resetForTesting();
  });

  function createMockProcess(overrides: {
    isActive?: boolean;
    hasPendingWork?: () => boolean;
    agentId?: string;
    workspaceId?: string;
    lastActiveOffset?: number; // ms ago
  } = {}) {
    const pid = nextPid++;
    const killFn = vi.fn().mockResolvedValue(undefined);
    const now = Date.now();

    registerProcess({
      pid,
      agentId: overrides.agentId ?? `agent-${pid}`,
      workspaceId: overrides.workspaceId ?? `ws-${pid}`,
      isActive: overrides.isActive ?? false,
      lastActiveTimestamp: now - (overrides.lastActiveOffset ?? 60000),
      kill: killFn,
      hasPendingWork: overrides.hasPendingWork,
    });

    return { pid, kill: killFn };
  }

  it('does not evict active processes (isActive = true)', async () => {
    // Create an actively streaming process
    const active = createMockProcess({ isActive: true, lastActiveOffset: 120000 });
    // Create an idle process (should be evicted)
    const idle = createMockProcess({ isActive: false, lastActiveOffset: 120000 });

    const evicted = await evictIdleProcesses(1);

    // Only the idle one should be evicted
    expect(evicted).toBe(1);
    expect(idle.kill).toHaveBeenCalled();
    expect(active.kill).not.toHaveBeenCalled();
    expect(getRegistrySize()).toBe(1);
  });

  it('does not evict processes with hasPendingWork returning true', async () => {
    // Create a process with active subscriptions (hasPendingWork returns true)
    const withPendingWork = createMockProcess({
      isActive: false,
      hasPendingWork: () => true,
      lastActiveOffset: 120000,
    });
    // Create an idle process with no pending work
    const idle = createMockProcess({
      isActive: false,
      hasPendingWork: () => false,
      lastActiveOffset: 120000,
    });

    const evicted = await evictIdleProcesses(2);

    // Only the truly idle one should be evicted
    expect(evicted).toBe(1);
    expect(idle.kill).toHaveBeenCalled();
    expect(withPendingWork.kill).not.toHaveBeenCalled();
    expect(getRegistrySize()).toBe(1);
  });

  it('does not evict processes with undefined hasPendingWork if they are active', async () => {
    // Active process without hasPendingWork callback
    const active = createMockProcess({
      isActive: true,
      hasPendingWork: undefined,
      lastActiveOffset: 120000,
    });

    const evicted = await evictIdleProcesses(1);

    expect(evicted).toBe(0);
    expect(active.kill).not.toHaveBeenCalled();
    expect(getRegistrySize()).toBe(1);
  });

  it('treats undefined hasPendingWork as no pending work when process is idle', async () => {
    // Idle process without hasPendingWork callback — should be evictable
    const idle = createMockProcess({
      isActive: false,
      hasPendingWork: undefined,
      lastActiveOffset: 120000,
    });

    const evicted = await evictIdleProcesses(1);

    expect(evicted).toBe(1);
    expect(idle.kill).toHaveBeenCalled();
    expect(getRegistrySize()).toBe(0);
  });

  it('evicts oldest idle processes first (LRU order)', async () => {
    // Create 3 idle processes with different last-active times
    const oldest = createMockProcess({ agentId: 'oldest', lastActiveOffset: 300000 });
    const middle = createMockProcess({ agentId: 'middle', lastActiveOffset: 200000 });
    const newest = createMockProcess({ agentId: 'newest', lastActiveOffset: 100000 });

    const evicted = await evictIdleProcesses(2);

    expect(evicted).toBe(2);
    // Oldest and middle should be evicted
    expect(oldest.kill).toHaveBeenCalled();
    expect(middle.kill).toHaveBeenCalled();
    // Newest should remain
    expect(newest.kill).not.toHaveBeenCalled();
    expect(getRegistrySize()).toBe(1);
  });

  it('respects maxToEvict limit', async () => {
    // Create 3 idle processes
    createMockProcess({ lastActiveOffset: 300000 });
    createMockProcess({ lastActiveOffset: 200000 });
    createMockProcess({ lastActiveOffset: 100000 });

    const evicted = await evictIdleProcesses(1);

    expect(evicted).toBe(1);
    expect(getRegistrySize()).toBe(2);
  });

  it('returns 0 when all processes are active or have pending work', async () => {
    createMockProcess({ isActive: true });
    createMockProcess({ isActive: false, hasPendingWork: () => true });

    const evicted = await evictIdleProcesses(5);

    expect(evicted).toBe(0);
    expect(getRegistrySize()).toBe(2);
  });

  it('returns 0 when registry is empty', async () => {
    const evicted = await evictIdleProcesses(5);
    expect(evicted).toBe(0);
  });

  it('handles concurrent eviction and state changes gracefully', async () => {
    // Process that becomes active during eviction
    let dynamicIsActive = false;
    const pid = nextPid++;
    const killFn = vi.fn().mockImplementation(async () => {
      // Simulate the process becoming active during kill
      dynamicIsActive = true;
    });

    registerProcess({
      pid,
      agentId: `agent-${pid}`,
      workspaceId: `ws-${pid}`,
      get isActive() {
        return dynamicIsActive;
      },
      lastActiveTimestamp: Date.now() - 120000,
      kill: killFn,
      hasPendingWork: undefined,
    });

    // Also create a truly idle process
    const idle = createMockProcess({ lastActiveOffset: 130000 });

    // Should still successfully evict the other idle process
    const evicted = await evictIdleProcesses(2);

    // At least 1 eviction should succeed (the truly idle one)
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(idle.kill).toHaveBeenCalled();
  });
});

