/**
 * Live events domain backed by the intentd daemon.
 *
 * Historical reads resolve via `event.query` (PROTOCOL §5.10) over the
 * JSON-RPC bridge. Without opting into pagination the daemon returns a bare
 * newest→oldest array; `list()` reverses it into the chronological
 * (oldest→newest) order the workspace-events reducer buffers (its cap trims
 * from the front), while `query()` preserves the wire order for callers that
 * want most-recent-first (e.g. agent file-edit badges).
 *
 * Live streaming deliberately does NOT flow through this client: the
 * `daemon-events-bridge` middleware owns the `events.subscribe` firehose, so
 * `subscribe()` here only emits an initial snapshot (mock parity) and returns
 * an idle disposer.
 */
import type { WorkspaceEvent } from "$features/events/types";
import type {
  EventQueryOptions,
  EventsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";

/** Boot snapshot size — matches the renderer event buffer cap (MAX_EVENTS). */
const BOOT_SNAPSHOT_LIMIT = 100;

export class LiveEventsClient implements EventsClient {
  async list(workspaceId: string): Promise<WorkspaceEvent[]> {
    const events = await this.query(workspaceId, { limit: BOOT_SNAPSHOT_LIMIT });
    return [...events].reverse();
  }

  async query(
    workspaceId: string,
    options: EventQueryOptions = {},
  ): Promise<WorkspaceEvent[]> {
    const result = await backendRequest<unknown>("event.query", {
      workspaceId,
      ...options,
    });
    return Array.isArray(result) ? (result as WorkspaceEvent[]) : [];
  }

  subscribe(
    workspaceId: string,
    handler: SubscriptionHandler<WorkspaceEvent[]>,
  ): Unsubscribe {
    void this.list(workspaceId)
      .then((events) => handler(events))
      .catch(() => handler([]));
    return () => {};
  }
}
