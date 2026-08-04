/**
 * On-demand disk-usage poll for the checkout-mode pill tooltip.
 *
 * Wraps the `workspace.diskUsage` seam call (PROTOCOL §5.1) so the Svelte
 * component never talks to the AppClient directly (the
 * `intent/no-component-async-data-fetch` rule) — the same component-adjacent
 * action-module pattern as `shrink-workspace-action`. One call per invocation;
 * the component owns the open/refresh polling loop.
 */
import { appClient } from '$lib/client';
import type { WorkspaceDiskUsageResult } from '$lib/client';

/**
 * One `workspace.diskUsage` round-trip for the given workspace. `null` when
 * the daemon predates the method (-32601 METHOD_NOT_FOUND); other errors
 * propagate to the caller.
 */
export async function pollWorkspaceDiskUsage(
  workspaceId: string,
): Promise<WorkspaceDiskUsageResult | null> {
  return appClient.workspaces.diskUsage(workspaceId);
}
