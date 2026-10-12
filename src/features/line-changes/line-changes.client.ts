/**
 * Line-change metrics client — daemon-backed reads (PROTOCOL §5.20).
 *
 * Agent totals are read through `backendRequest`. Transport errors propagate
 * to the lifecycle read service, which folds them into request-state actions.
 */

import { createBackendLineChangesClient } from '$lib/client/live/backend-line-changes-client';
import { backendRequest } from '$lib/client/live/backend-transport';
// Public compatibility for line-stat consumers until the Svelte renderer retires.
import type { Metrics } from '../../lib/client/lifecycle-read-client-types';
export type { Metrics } from '../../lib/client/lifecycle-read-client-types';

// Compatibility facade for existing Svelte consumers; remove when that renderer retires.
const lineChangesClient = createBackendLineChangesClient({
  // Resolve the legacy export at call time, matching the original client.
  backendRequest: <T>(...args: Parameters<typeof backendRequest>): Promise<T> =>
    backendRequest<T>(...args),
});

/** `metrics.getAgentStats` — one agent's line-change totals, or null when untracked. */
export function getAgentLineStats(agentId: string, workspaceId?: string): Promise<Metrics | null> {
  return lineChangesClient.getAgentLineStats(agentId, workspaceId);
}
