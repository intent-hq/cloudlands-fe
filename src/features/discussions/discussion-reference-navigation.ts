import { handleLink } from '$features/navigation/link-handler';
import { store } from '$store/renderer/store';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { parseDiscussionReference, type DiscussionReference } from './discussion-references';

export async function openDiscussionReference(
  reference: DiscussionReference,
  workspaceId: string,
  sourcePanelId?: string,
  event?: MouseEvent,
) {
  const target = parseDiscussionReference(reference.url, reference.label, workspaceId);
  if (!target) return;
  if (target.kind === 'agent') {
    const agent = selectAllWorkspaceAgents
      .select(store.state, workspaceId)
      .find((item) => item.id === target.agentId && !item.retiredAt);
    if (!agent) {
      notify.error(m.workspace_discussion_reference_missing());
      return;
    }
    store.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId: agent.id,
        sourcePanelId,
        openInAdjacentPanel: true,
      }),
    );
    return;
  }
  await handleLink(target.url, {
    workspaceId: WorkspaceId(workspaceId),
    sourcePanelId,
    openInAdjacentPanel: true,
    event,
  });
}
