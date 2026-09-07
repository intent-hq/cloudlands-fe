/**
 * Bounded scheduler for the lifecycle saga's per-workspace daemon reads.
 *
 * Dispatch sites fan out one read per workspace they render (the HUD grid and
 * the workspace list each queue a `tasks` + `tokenUsage` refresh per card), so
 * on a profile with ~130 registered workspaces a single tick used to put ~130
 * reads on the wire at once and the daemon answered with a burst of
 * `Server overloaded` errors. Every read now takes a slot first: a large
 * workspace count degrades into a queue instead of a thundering herd.
 *
 * Reads for the active workspace queue ahead of background refreshes so making
 * a workspace visible still refreshes it promptly when the queue is long —
 * bounded, so a steady stream of active-workspace reads cannot starve the
 * background ones behind it.
 */

import type { PanelTabType } from '../../panel-layout/panel-layout-types';
import type { WorkspaceHydrationBranch } from '../workspace-lifecycle-slice';

/** Reads allowed on the wire at once. Sized to stay well under the daemon's overload threshold. */
export const MAX_CONCURRENT_WORKSPACE_READS = 6;

interface WorkspaceReadSlot {
  /** `true` once this slot is owned by the caller and the read may start. */
  readonly granted: boolean;
  /** Resolves when the slot is granted. Already resolved when `granted` is `true`. */
  readonly acquired: Promise<void>;
  /**
   * Idempotent. Releases an owned slot, or abandons the request while it is
   * still queued (a cancelled read must not hold the queue up).
   */
  release(): void;
}

export interface WorkspaceReadScheduler {
  /** Requests a slot; `priority` requests queue ahead of non-priority ones. */
  acquire(priority?: boolean): WorkspaceReadSlot;
  /** Reads currently holding a slot. */
  activeCount(): number;
  /** Reads waiting for a slot. */
  pendingCount(): number;
}

interface Waiter {
  readonly priority: boolean;
  grant(): void;
}

export function createWorkspaceReadScheduler(
  limit: number = MAX_CONCURRENT_WORKSPACE_READS,
): WorkspaceReadScheduler {
  // Arrival order. Priority is applied when a slot is granted, not on insert,
  // so the fairness fallback below can hand the queue back to arrival order.
  const queue: Waiter[] = [];
  let active = 0;
  let consecutivePriorityGrants = 0;

  /**
   * Index of the waiter to grant next: the oldest priority waiter, except once
   * `limit` priority grants have run back to back — then the oldest waiter of
   * either class goes first. That bounds how long a background read can be
   * jumped: a steady stream of active-workspace reads drops the queue into
   * arrival order rather than starving the reads behind it.
   */
  function nextIndex(): number {
    if (queue.length === 0) return -1;
    if (consecutivePriorityGrants >= limit) return 0;
    const priorityIndex = queue.findIndex((queued) => queued.priority);
    return priorityIndex === -1 ? 0 : priorityIndex;
  }

  function drain(): void {
    while (active < limit) {
      const index = nextIndex();
      if (index === -1) return;
      const [waiter] = queue.splice(index, 1);
      active += 1;
      consecutivePriorityGrants = waiter.priority ? consecutivePriorityGrants + 1 : 0;
      waiter.grant();
    }
  }

  function acquire(priority = false): WorkspaceReadSlot {
    let state: 'queued' | 'granted' | 'released' = 'queued';
    let resolveAcquired: () => void = () => {};
    const acquired = new Promise<void>((resolve) => {
      resolveAcquired = resolve;
    });
    const waiter: Waiter = {
      priority,
      grant() {
        state = 'granted';
        resolveAcquired();
      },
    };
    queue.push(waiter);
    drain();
    return {
      get granted() {
        return state === 'granted';
      },
      acquired,
      release() {
        if (state === 'released') return;
        if (state === 'granted') {
          state = 'released';
          active -= 1;
          drain();
          return;
        }
        state = 'released';
        const index = queue.indexOf(waiter);
        if (index !== -1) queue.splice(index, 1);
      },
    };
  }

  return {
    acquire,
    activeCount: () => active,
    pendingCount: () => queue.length,
  };
}

export const WORKSPACE_HYDRATION_BRANCHES = [
  'tasks',
  'events',
  'scripts',
  'skills',
  'prStatus',
  'changes',
  'agents',
  'terminals',
  'fileExplorer',
  'context',
  'taskAgentLinks',
  'notes',
] as const;

type WorkspaceHydrationOutcome = 'success' | 'failure' | 'cancelled';

export const WORKSPACE_HYDRATION_IDLE_FALLBACK_MS = 1_500;

export interface WorkspaceHydrationConsumers {
  activePanelTypes: readonly PanelTabType[];
  visibleSidebarTabs: readonly string[];
}

const alwaysVisibleBranches: readonly WorkspaceHydrationBranch[] = [
  'tasks',
  'agents',
  'terminals',
  'taskAgentLinks',
  'notes',
];

const panelBranches: Partial<Record<PanelTabType, readonly WorkspaceHydrationBranch[]>> = {
  activity: ['events'],
  agent: ['agents', 'tasks', 'taskAgentLinks'],
  'agent-overview': ['agents', 'tasks', 'taskAgentLinks'],
  'activity-changes': ['changes'],
  'chat-changes': ['changes'],
  changes: ['changes', 'prStatus'],
  'code-review': ['changes', 'prStatus'],
  diff: ['changes'],
  'hook-script': ['scripts'],
  note: ['notes'],
  overview: ['agents', 'tasks', 'notes', 'prStatus'],
  settings: ['skills', 'scripts', 'context'],
  terminal: ['terminals'],
};

const sidebarBranches: Record<string, readonly WorkspaceHydrationBranch[]> = {
  overview: ['agents', 'notes', 'terminals'],
  agents: ['agents', 'tasks', 'taskAgentLinks'],
  context: ['notes', 'context'],
  changes: ['changes', 'prStatus'],
  files: ['fileExplorer'],
  shell: ['terminals', 'scripts'],
};

export function deriveCriticalHydrationBranches(
  consumers: WorkspaceHydrationConsumers,
): Set<WorkspaceHydrationBranch> {
  const critical = new Set(alwaysVisibleBranches);
  for (const type of consumers.activePanelTypes) {
    for (const branch of panelBranches[type] ?? []) critical.add(branch);
  }
  for (const tab of consumers.visibleSidebarTabs) {
    for (const branch of sidebarBranches[tab] ?? []) critical.add(branch);
  }
  return critical;
}

interface HydrationGeneration {
  id: number;
  force: boolean;
  pending: Set<WorkspaceHydrationBranch>;
  dispatched: Set<WorkspaceHydrationBranch>;
  inFlight: Set<WorkspaceHydrationBranch>;
}

export interface WorkspaceHydrationTierScheduler {
  start(
    workspaceId: string,
    consumers: WorkspaceHydrationConsumers,
    force?: boolean,
  ): { generation: number; branches: WorkspaceHydrationBranch[] };
  promote(
    workspaceId: string,
    consumers: WorkspaceHydrationConsumers,
  ): { generation: number; force: boolean; branches: WorkspaceHydrationBranch[] } | null;
  flush(
    workspaceId: string,
    generation: number,
  ): { generation: number; force: boolean; branches: WorkspaceHydrationBranch[] } | null;
  settle(
    workspaceId: string,
    branch: WorkspaceHydrationBranch,
    outcome: WorkspaceHydrationOutcome,
  ): void;
  hasPending(workspaceId: string): boolean;
  cancel(workspaceId: string): void;
  reset(): void;
}

function markDispatched(workspaceId: string, generation: number, branch: WorkspaceHydrationBranch) {
  if (typeof performance === 'undefined') return;
  performance.mark(`intent:workspace-hydration:${workspaceId}:${generation}:${branch}:dispatch`);
}

function markSettled(
  workspaceId: string,
  generation: number,
  branch: WorkspaceHydrationBranch,
  outcome: WorkspaceHydrationOutcome,
) {
  if (typeof performance === 'undefined') return;
  const start = `intent:workspace-hydration:${workspaceId}:${generation}:${branch}:dispatch`;
  const end = `intent:workspace-hydration:${workspaceId}:${generation}:${branch}:settle`;
  const measure = `intent:workspace-hydration:${branch}:dispatch-to-settle`;
  if (performance.getEntriesByName(start).length === 0) return;
  performance.mark(end, { detail: { outcome } });
  performance.measure(measure, start, end);
  performance.clearMarks(start);
  performance.clearMarks(end);
}

export function createWorkspaceHydrationTierScheduler(): WorkspaceHydrationTierScheduler {
  let nextGeneration = 0;
  const generations = new Map<string, HydrationGeneration>();

  function dispatch(
    workspaceId: string,
    generation: HydrationGeneration,
    branches: Iterable<WorkspaceHydrationBranch>,
  ) {
    const newlyDispatched: WorkspaceHydrationBranch[] = [];
    for (const branch of branches) {
      if (generation.dispatched.has(branch)) continue;
      generation.pending.delete(branch);
      generation.dispatched.add(branch);
      generation.inFlight.add(branch);
      newlyDispatched.push(branch);
      markDispatched(workspaceId, generation.id, branch);
    }
    return newlyDispatched;
  }

  function cancel(workspaceId: string) {
    const generation = generations.get(workspaceId);
    if (!generation) return;
    for (const branch of generation.inFlight) {
      markSettled(workspaceId, generation.id, branch, 'cancelled');
    }
    generations.delete(workspaceId);
  }

  return {
    start(workspaceId, consumers, force = false) {
      cancel(workspaceId);
      const critical = deriveCriticalHydrationBranches(consumers);
      const generation: HydrationGeneration = {
        id: ++nextGeneration,
        force,
        pending: new Set(WORKSPACE_HYDRATION_BRANCHES),
        dispatched: new Set(),
        inFlight: new Set(),
      };
      generations.set(workspaceId, generation);
      return {
        generation: generation.id,
        branches: dispatch(workspaceId, generation, critical),
      };
    },
    promote(workspaceId, consumers) {
      const generation = generations.get(workspaceId);
      if (!generation) return null;
      return {
        generation: generation.id,
        force: generation.force,
        branches: dispatch(workspaceId, generation, deriveCriticalHydrationBranches(consumers)),
      };
    },
    flush(workspaceId, generationId) {
      const generation = generations.get(workspaceId);
      if (!generation || generation.id !== generationId) return null;
      return {
        generation: generation.id,
        force: generation.force,
        branches: dispatch(workspaceId, generation, [...generation.pending]),
      };
    },
    settle(workspaceId, branch, outcome) {
      const generation = generations.get(workspaceId);
      if (!generation || !generation.inFlight.delete(branch)) return;
      markSettled(workspaceId, generation.id, branch, outcome);
    },
    hasPending(workspaceId) {
      return (generations.get(workspaceId)?.pending.size ?? 0) > 0;
    },
    cancel,
    reset() {
      for (const workspaceId of [...generations.keys()]) cancel(workspaceId);
    },
  };
}
