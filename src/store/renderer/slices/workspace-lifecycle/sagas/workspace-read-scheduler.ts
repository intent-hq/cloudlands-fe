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

/** Reads allowed on the wire at once. Sized to stay well under the daemon's overload threshold. */
export const MAX_CONCURRENT_WORKSPACE_READS = 6;

export interface WorkspaceReadSlot {
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
