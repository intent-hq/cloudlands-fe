/**
 * Workspaces & layout seeder.
 *
 * Pulls the workspace list and recency data from the `AppClient` seam and
 * dispatches existing slice actions to populate the store so the home view,
 * sidebar, and workspace tabs render. The workspaces domain is now backed by the
 * live intentd daemon (the mock workspace fixtures were removed), so this seeder
 * hydrates the store from live data rather than from a mock.
 *
 * Also registers the renderer→main IPC mock handler for `workspace:open` (the
 * route loader entry point in `use-workspace-loader.svelte.ts`). With no real
 * Electron main process driving this build, that channel would otherwise fall
 * through to the mock router's `undefined` default and surface as
 * "No response received" → "Failed to open workspace". The handler resolves
 * the workspace via the live AppClient seam and returns it in the
 * CommandResponse shape the legacy main-process handler produced, so
 * `workspace.client.ts` `normalizeResponse` folds it into `{ ok: true, data }`.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";
import { appClient } from "$lib/client";
import { registerMockSeeder } from "../mock-bootstrap";
import {
  loadRecencyData,
  replaceWorkspaceList,
  setActiveWorkspaceId,
  setWorkspaceHasLoaded,
} from "../slices/workspace/workspace-slice";
import { openWorkspaceTab } from "../slices/tab-state/tab-state-slice";

/** Read the `id` (preferred) or `workspaceId` field off the route loader's open payload. */
function readWorkspaceOpenId(arg: unknown): string {
  const raw = (arg as { id?: unknown; workspaceId?: unknown } | undefined) ?? {};
  if (typeof raw.id === "string") return raw.id;
  if (typeof raw.workspaceId === "string") return raw.workspaceId;
  return "";
}

// Registered at import time (not inside the async seeder) so the route loader's
// `workspaceClient.open()` call resolves through the mock router before any
// component mounts, mirroring the same idiom agents-seeder uses for the
// AuggieSetupGate bootstrap probes.
registerMockIpcHandler(WORKSPACE_CHANNELS.OPEN, async (arg) => {
  const id = readWorkspaceOpenId(arg);
  if (!id) {
    return { success: false, error: "Workspace not found" };
  }
  const workspace = await appClient.workspaces.open(id);
  if (!workspace) {
    return { success: false, error: "Workspace not found" };
  }
  return { success: true, data: workspace };
});

registerMockSeeder("workspaces", async ({ store, client }) => {
  const workspaces = await client.workspaces.list();

  store.dispatch(replaceWorkspaceList(workspaces));
  store.dispatch(setWorkspaceHasLoaded(true));

  const recentViews = await client.workspaces.recentViews();
  store.dispatch(loadRecencyData({ lastViewedAt: recentViews }));

  const firstWorkspace = workspaces[0];
  if (firstWorkspace) {
    store.dispatch(setActiveWorkspaceId(firstWorkspace.id));
    store.dispatch(openWorkspaceTab(firstWorkspace.id));
  }
});
