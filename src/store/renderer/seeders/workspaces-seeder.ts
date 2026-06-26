/**
 * Workspaces & layout seeder.
 *
 * Pulls the workspace list and recency data from the `AppClient` seam and
 * dispatches existing slice actions to populate the store so the home view,
 * sidebar, and workspace tabs render. The workspaces domain is now backed by the
 * live intentd daemon (the mock workspace fixtures were removed), so this seeder
 * hydrates the store from live data rather than from a mock.
 */
import { registerMockSeeder } from "../mock-bootstrap";
import {
  loadRecencyData,
  replaceWorkspaceList,
  setActiveWorkspaceId,
  setWorkspaceHasLoaded,
} from "../slices/workspace/workspace-slice";
import { openWorkspaceTab } from "../slices/tab-state/tab-state-slice";

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
