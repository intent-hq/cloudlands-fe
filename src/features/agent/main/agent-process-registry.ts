/**
 * Global registry for auggie child processes.
 *
 * Enforces a hard cap on the number of concurrent OS processes across ALL
 * workspaces. When the cap is reached and a new process needs to spawn,
 * the least-recently-used idle process is evicted. If every process is
 * actively streaming, the spawn is queued until a slot opens.
 */

import * as os from 'os';

import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';

const logger = new Logger('AgentProcessRegistry');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GB = 1024 ** 3;

/**
 * Compute the maximum number of concurrent agent processes based on total
 * system RAM. Lower-memory machines get a tighter cap so the app doesn't
 * overwhelm the system.
 */
export function computeProcessCap(totalMemoryBytes: number): number {
  if (totalMemoryBytes <= 8 * GB) return 4;
  if (totalMemoryBytes <= 16 * GB) return 8;
  if (totalMemoryBytes <= 32 * GB) return 20;
  if (totalMemoryBytes <= 64 * GB) return 30;
  return 100;
}

const PROCESS_CAP_CONFIG = {
  /** Maximum number of concurrent auggie child processes (computed from system RAM). */
  MAX_CONCURRENT_PROCESSES: computeProcessCap(os.totalmem()),
};

logger.info('Process cap initialized', {
  totalMemoryGB: Math.round(os.totalmem() / GB),
  maxConcurrentProcesses: PROCESS_CAP_CONFIG.MAX_CONCURRENT_PROCESSES,
});

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

function notifyPendingWorkCleared(pid: number): void {
  const entry = registry.get(pid);
  if (entry && !entry.isActive && !entry.hasPendingWork?.() && waitQueue.length > 0) {
    const next = waitQueue.shift();
    if (next) {
      logger.info('Waking queued spawn request (pending work cleared)', {
        pid,
        queueLength: waitQueue.length,
      });
      next();
    }
  }
}

/** Find a process entry by agentId and notify that its pending work may have cleared. */
export function notifyPendingWorkClearedForAgent(agentId: string): void {
  for (const [pid, entry] of registry) {
    if (entry.agentId === agentId) {
      notifyPendingWorkCleared(pid);
    }
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
    .filter(
      (e) =>
        !e.isActive && !e.hasPendingWork?.() && !WorkspaceConfig.isVirtualWorkspace(e.workspaceId),
    )
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
