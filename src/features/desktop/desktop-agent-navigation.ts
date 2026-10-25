import { navigateToRoute } from '$lib/utils/navigation.client';
import { store } from '$store/renderer/store';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

/** Works on cold window opens as well as an existing window's navigation event. */
export async function navigateToDesktopAgent(workspaceId: string, agentId: string): Promise<void> {
  if (!workspaceId || !agentId) return;
  if (workspaceId === CHIEF_WORKSPACE_ID) {
    await navigateToRoute('/');
    store.dispatch(setChiefActiveAgentId(agentId));
    store.dispatch(openPanel('chief'));
    return;
  }
  await navigateToRoute(`/workspace/${encodeURIComponent(workspaceId)}`);
  store.dispatch(openAgentTabRequested(workspaceId, { agentId }));
}
