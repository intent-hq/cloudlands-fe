/**
 * Global registry for auggie child processes.
 *
 * Enforces a hard cap on the number of concurrent OS processes across ALL
 * workspaces. When the cap is reached and a new process needs to spawn,
 * the least-recently-used idle process is evicted. If every process is
 * actively streaming, the spawn is queued until a slot opens.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger('AgentProcessRegistry');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const PROCESS_CAP_CONFIG = {
  /** Maximum number of concurrent auggie child processes. */
  MAX_CONCURRENT_PROCESSES: 30,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessEntry {
  pid: number;
  agentId: string;
  workspaceId: string;
  /** Epoch ms — updated when streaming starts/completes. */
  lastActiveTimestamp: number;
  /** True while the process is actively streaming a response. */
  isActive: boolean;
  /** Callback to kill this process (calls stopAgentProcess on its provider). */
  kill: () => Promise<void>;
  /** Optional callback — returns true if the process has in-flight work (e.g. pending RPC requests). */
  hasPendingWork?: () => boolean;
}

// ---------------------------------------------------------------------------
// Singleton registry
// ---------------------------------------------------------------------------

/** PID → ProcessEntry */
const registry = new Map<number, ProcessEntry>();

/** Queued spawn resolvers waiting for a free slot. */
const waitQueue: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function registerProcess(entry: ProcessEntry): void {
  registry.set(entry.pid, entry);
  logger.info('Process registered', {
    pid: entry.pid,
    agentId: entry.agentId,
    workspaceId: entry.workspaceId,
    totalProcesses: registry.size,
  });
}

export function deregisterProcess(pid: number): void {
  const had = registry.delete(pid);
  if (had) {
    logger.info('Process deregistered', { pid, totalProcesses: registry.size });
    // Wake the next queued spawn, if any
    const next = waitQueue.shift();
    if (next) {
      logger.info('Waking queued spawn request', { queueLength: waitQueue.length });
      next();
    }
  }
}

export function markProcessActive(pid: number): void {
  const entry = registry.get(pid);
  if (entry) {
    entry.isActive = true;
    entry.lastActiveTimestamp = Date.now();
  }
}

export function markProcessIdle(pid: number): void {
  const entry = registry.get(pid);
  if (entry) {
    entry.isActive = false;
    entry.lastActiveTimestamp = Date.now();

    // An idle process is now available for eviction — wake the next queued
    // spawn so it can acquire the slot immediately instead of waiting for
    // the idle-timeout to kill the process.
    if (waitQueue.length > 0) {
      const next = waitQueue.shift()!;
      logger.info('Waking queued spawn request (process became idle)', {
        pid,
        queueLength: waitQueue.length,
      });
      next();
    }
  }
}

/**
 * Ensure a slot is available before spawning. Returns immediately if under
 * the cap. Otherwise evicts the LRU idle process or, if all are active,
 * waits for a slot to open.
 */
export async function acquireProcessSlot(): Promise<void> {
  while (true) {
    if (registry.size < PROCESS_CAP_CONFIG.MAX_CONCURRENT_PROCESSES) {
      return; // Slot available
    }

    // Try to evict the least-recently-used IDLE process
    let lru: ProcessEntry | undefined;
    for (const entry of registry.values()) {
      if (!entry.isActive && !entry.hasPendingWork?.()) {
        if (!lru || entry.lastActiveTimestamp < lru.lastActiveTimestamp) {
          lru = entry;
        }
      }
    }

    if (lru) {
      logger.info('Evicting LRU idle process to make room', {
        pid: lru.pid,
        agentId: lru.agentId,
        workspaceId: lru.workspaceId,
        lastActive: new Date(lru.lastActiveTimestamp).toISOString(),
        totalProcesses: registry.size,
      });
      try {
        await lru.kill();
      } catch (err) {
        logger.warn('Failed to evict idle process — deregistering anyway', {
          pid: lru.pid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // kill() should trigger deregisterProcess via exit handler, but ensure it
      deregisterProcess(lru.pid);
      // Loop back to re-check — another waiter may have taken the slot
      continue;
    }

    // All processes are active — wait for one to finish
    logger.info('All processes active, queuing spawn request', {
      totalProcesses: registry.size,
      queueLength: waitQueue.length,
    });
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve);
    });
    // Loop back to re-check cap and attempt eviction
  }
}

export function notifyPendingWorkCleared(pid: number): void {
  const entry = registry.get(pid);
  if (entry && !entry.isActive && !entry.hasPendingWork?.() && waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    logger.info('Waking queued spawn request (pending work cleared)', {
      pid,
      queueLength: waitQueue.length,
    });
    next();
  }
}

/**
 * Evict idle processes in LRU order to reclaim memory.
 *
 * Called by the memory pressure handler when heap usage crosses warning/critical
 * thresholds. Active processes and processes with pending work are never evicted.
 *
 * @param count — maximum number of idle processes to evict. If omitted or
 *   Infinity, evicts ALL idle processes.
 * @returns the number of processes actually evicted.
 */
export async function evictIdleProcesses(count?: number): Promise<number> {
  const maxToEvict = count ?? Infinity;
  let evicted = 0;

  // Collect idle processes sorted by lastActiveTimestamp ascending (oldest first = LRU)
  const idleEntries = Array.from(registry.values())
    .filter((e) => !e.isActive && !e.hasPendingWork?.())
    .sort((a, b) => a.lastActiveTimestamp - b.lastActiveTimestamp);

  for (const entry of idleEntries) {
    if (evicted >= maxToEvict) break;
    // Re-check — the entry may have become active while we were awaiting a previous kill
    if (entry.isActive || entry.hasPendingWork?.()) continue;
    // Verify it's still in the registry (may have been deregistered by a concurrent kill)
    if (!registry.has(entry.pid)) continue;

    logger.info('Evicting idle process due to memory pressure', {
      pid: entry.pid,
      agentId: entry.agentId,
      workspaceId: entry.workspaceId,
      lastActive: new Date(entry.lastActiveTimestamp).toISOString(),
      totalProcesses: registry.size,
    });

    try {
      await entry.kill();
    } catch (err) {
      logger.warn('Failed to evict idle process during memory pressure — deregistering anyway', {
        pid: entry.pid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // kill() should trigger deregisterProcess via exit handler, but ensure it
    deregisterProcess(entry.pid);
    evicted++;
  }

  if (evicted > 0) {
    logger.info('Memory pressure eviction complete', {
      evicted,
      remaining: registry.size,
    });
  }

  return evicted;
}

/** For testing / diagnostics only. */
export function getRegistrySize(): number {
  return registry.size;
}

/** For testing only — clears the registry and wait queue. */
export function _resetForTesting(): void {
  registry.clear();
  waitQueue.length = 0;
}

