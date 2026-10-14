import { store } from '../index';
import { getFileContentEntry } from '../../../../../src/store/renderer/slices/files/files-projections';

import { selectAgentSession } from '../agent-session/agent-session-selectors';
import { selectAdmittedWorkspaceReadContext } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';

export const selectFileContentEntry = store.createSelector(getFileContentEntry);

/** Shared by publication and presentation, so node reassignment retires cached previews too. */
export const selectFileReadContext = store.createSelector(
  (state, workspaceId: string, attachmentAgentId?: string): string | null => {
    const context = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
    if (attachmentAgentId === undefined) return context;
    const agent = selectAgentSession.select(state, attachmentAgentId);
    return agent && agent.workspaceId === workspaceId && !hasNodeOwnedAgentPath(agent)
      ? context
      : null;
  },
);
