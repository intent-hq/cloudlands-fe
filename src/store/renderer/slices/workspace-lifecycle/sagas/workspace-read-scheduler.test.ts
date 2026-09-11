import { describe, expect, it } from 'vitest';

import {
  createWorkspaceHydrationTierScheduler,
  createWorkspaceReadScheduler,
  deriveCriticalHydrationBranches,
  MAX_CONCURRENT_WORKSPACE_READS,
  WORKSPACE_HYDRATION_BRANCHES,
} from './workspace-read-scheduler';

describe('createWorkspaceReadScheduler', () => {
  it('grants up to the limit synchronously and queues the rest', () => {
    const scheduler = createWorkspaceReadScheduler(2);
    const slots = [scheduler.acquire(), scheduler.acquire(), scheduler.acquire()];

    expect(slots.map((slot) => slot.granted)).toEqual([true, true, false]);
    expect(scheduler.activeCount()).toBe(2);
    expect(scheduler.pendingCount()).toBe(1);

    slots[0].release();
    expect(slots[2].granted).toBe(true);
    expect(scheduler.activeCount()).toBe(2);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('resolves the acquired promise when a queued slot is granted', async () => {
    const scheduler = createWorkspaceReadScheduler(1);
    const held = scheduler.acquire();
    const queued = scheduler.acquire();
    let resolved = false;
    const waiting = queued.acquired.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    held.release();
    await waiting;
    expect(resolved).toBe(true);
  });

  it('grants priority requests ahead of background ones, FIFO within each class', () => {
    const scheduler = createWorkspaceReadScheduler(3);
    const held = [scheduler.acquire(), scheduler.acquire(), scheduler.acquire()];
    const background = scheduler.acquire();
    const firstPriority = scheduler.acquire(true);
    const secondPriority = scheduler.acquire(true);

    held[0].release();
    expect([firstPriority.granted, secondPriority.granted, background.granted]).toEqual([
      true,
      false,
      false,
    ]);

    held[1].release();
    expect([secondPriority.granted, background.granted]).toEqual([true, false]);

    held[2].release();
    expect(background.granted).toBe(true);
  });

  it('falls back to arrival order so a priority stream cannot starve a background read', () => {
    const scheduler = createWorkspaceReadScheduler(1);
    const held = scheduler.acquire();
    const background = scheduler.acquire();
    const firstPriority = scheduler.acquire(true);

    // One priority grant is the whole quota at limit 1.
    held.release();
    expect([firstPriority.granted, background.granted]).toEqual([true, false]);

    // A continuous stream of active-workspace reads keeps arriving...
    const secondPriority = scheduler.acquire(true);
    const thirdPriority = scheduler.acquire(true);

    // ...but the quota is spent, so the oldest waiter goes next.
    firstPriority.release();
    expect([background.granted, secondPriority.granted, thirdPriority.granted]).toEqual([
      true,
      false,
      false,
    ]);

    // Serving a background read re-arms the priority lane.
    background.release();
    expect(secondPriority.granted).toBe(true);
  });

  it('abandons a still-queued request on release without consuming a slot', () => {
    const scheduler = createWorkspaceReadScheduler(1);
    const held = scheduler.acquire();
    const abandoned = scheduler.acquire();
    const next = scheduler.acquire();

    abandoned.release();
    expect(scheduler.pendingCount()).toBe(1);

    held.release();
    expect(next.granted).toBe(true);
    expect(abandoned.granted).toBe(false);
    expect(scheduler.activeCount()).toBe(1);
  });

  it('is idempotent: releasing twice does not leak an extra slot', () => {
    const scheduler = createWorkspaceReadScheduler(1);
    const held = scheduler.acquire();
    const queued = scheduler.acquire();

    held.release();
    held.release();

    expect(queued.granted).toBe(true);
    expect(scheduler.activeCount()).toBe(1);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('defaults to the shared read limit', () => {
    const scheduler = createWorkspaceReadScheduler();
    const slots = Array.from({ length: MAX_CONCURRENT_WORKSPACE_READS + 1 }, () =>
      scheduler.acquire(),
    );

    expect(scheduler.activeCount()).toBe(MAX_CONCURRENT_WORKSPACE_READS);
    expect(slots[MAX_CONCURRENT_WORKSPACE_READS].granted).toBe(false);
  });
});

describe('createWorkspaceHydrationTierScheduler', () => {
  const hiddenConsumers = { activePanelTypes: [], visibleSidebarTabs: [] } as const;

  it('returns visible-panel and sidebar reads for first reveal without flushing deferred work', () => {
    const critical = deriveCriticalHydrationBranches({
      activePanelTypes: ['activity'],
      visibleSidebarTabs: ['context'],
    });

    expect([...critical]).toEqual([
      'tasks',
      'agents',
      'terminals',
      'taskAgentLinks',
      'notes',
      'events',
      'context',
    ]);
    expect(critical.has('scripts')).toBe(false);
  });

  it('promotes a deferred branch when its panel becomes visible', () => {
    const scheduler = createWorkspaceHydrationTierScheduler();
    scheduler.start('ws', hiddenConsumers);

    const promoted = scheduler.promote('ws', {
      activePanelTypes: ['hook-script'],
      visibleSidebarTabs: [],
    });

    expect(promoted?.branches).toEqual(['scripts']);
  });

  it('invalidates deferred work when its workspace generation is cancelled', () => {
    const scheduler = createWorkspaceHydrationTierScheduler();
    const started = scheduler.start('ws', hiddenConsumers);

    scheduler.cancel('ws');

    expect(scheduler.flush('ws', started.generation)).toBeNull();
  });

  it('resets freshness on reconnect and rejects the stale fallback generation', () => {
    const scheduler = createWorkspaceHydrationTierScheduler();
    const stale = scheduler.start('ws', hiddenConsumers);
    const fresh = scheduler.start('ws', hiddenConsumers, true);

    expect(fresh.generation).not.toBe(stale.generation);
    expect(scheduler.flush('ws', stale.generation)).toBeNull();
    const flushed = scheduler.flush('ws', fresh.generation);
    expect(flushed?.force).toBe(true);
    expect(flushed?.branches).toEqual(
      WORKSPACE_HYDRATION_BRANCHES.filter((branch) => !fresh.branches.includes(branch)),
    );
  });

  it('settles a failed branch without retrying it or blocking the remaining fallback', () => {
    const scheduler = createWorkspaceHydrationTierScheduler();
    const started = scheduler.start('ws', hiddenConsumers);

    scheduler.settle('ws', 'notes', 'failure');
    expect(
      scheduler.promote('ws', { activePanelTypes: ['note'], visibleSidebarTabs: [] })?.branches,
    ).toEqual([]);
    expect(scheduler.flush('ws', started.generation)?.branches).not.toContain('notes');
  });

  it('records a stable per-branch dispatch-to-settle performance measure', () => {
    const name = 'intent:workspace-hydration:notes:dispatch-to-settle';
    performance.clearMeasures(name);
    const scheduler = createWorkspaceHydrationTierScheduler();

    scheduler.start('ws', hiddenConsumers);
    scheduler.settle('ws', 'notes', 'success');

    expect(performance.getEntriesByName(name)).toHaveLength(1);
    performance.clearMeasures(name);
  });
});
