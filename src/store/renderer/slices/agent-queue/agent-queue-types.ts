import type { QueuedMessage } from "$shared/types";
import type { Collection } from "$lib/store-shim/utils/collections/collection-utils";

/** Queue metadata and messages for a single agent. */
export interface AgentQueueEntryState {
  messages: Collection<QueuedMessage, "id">;
  /** Bounded tombstone list for locally removed queued messages. */
  recentlyRemovedMessageIds: string[];
  /**
   * Raw entry count of the most recent `replaceAgentQueue` payload BEFORE
   * tombstone suppression — the daemon's last-published queue size (the
   * FE seed paths also pass through here). The bridge's clear-queue
   * detection (#1032) reads this instead of the visible `messages` count
   * so an optimistic local removal cannot undercount the mirror and let a
   * multi-entry clear masquerade as a single-entry drain.
   */
  lastSnapshotCount: number;
  isHydrating: boolean;
  error: string | null;
}

/** Renderer-visible queued message state keyed by agent ID. */
export interface AgentQueueState {
  byAgentId: Record<string, AgentQueueEntryState>;
}
