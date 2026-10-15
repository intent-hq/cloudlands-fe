import { workspaceRelativeFilePath } from '../../../../../src/features/file/utils/workspace-file-path';
import {
  selectWorkspaceActionContext,
  selectWorkspaceById,
} from '../workspace/workspace-selectors';
import { store } from '../index';
import {
  getFileContentEntry,
  getFileSaveOperations,
} from '../../../../../src/store/renderer/slices/files/files-projections';

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

export const selectFileSaveState = store.createSelector(
  (state, workspaceId: string, path: string) => {
    const operations = getFileSaveOperations(state, workspaceId, path);
    const context = selectWorkspaceActionContext.select(state, workspaceId);
    const pending = operations.some(
      (operation) => operation.status === 'queued' || operation.status === 'running',
    );
    const uncertain = operations.some((operation) => operation.status === 'uncertain');
    const latest = operations.filter((operation) => operation.authority === context).at(-1);
    return {
      pending,
      uncertain,
      error: latest?.status === 'failed' ? latest.error : undefined,
      saved: latest?.status === 'succeeded',
    };
  },
);

export const selectFileAbsolutePath = store.createSelector(
  (state, workspaceId: string, path: string | undefined) => {
    const workspace = selectWorkspaceById.select(state, workspaceId);
    const root = workspace?.worktreePath || workspace?.repositoryPath;
    const relative = workspaceRelativeFilePath(path, root);
    return root && relative ? `${root.replace(/\/+$/, '')}/${relative}` : '';
  },
);
