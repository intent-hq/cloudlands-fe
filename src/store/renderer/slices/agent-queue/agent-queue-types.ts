import type { QueuedMessage } from "$shared/types";
import type { Collection } from "ag-redux-toolkit/utils/collections/collection-utils";

/** Queue metadata and messages for a single agent. */
export interface AgentQueueEntryState {
  messages: Collection<QueuedMessage, "id">;
  isHydrating: boolean;
  error: string | null;
}

/** Renderer-visible queued message state keyed by agent ID. */
export interface AgentQueueState {
  byAgentId: Record<string, AgentQueueEntryState>;
}
