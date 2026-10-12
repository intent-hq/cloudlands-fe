import { createWorkspaceMembershipSaga } from './workspace-membership-saga-factory';
import { workspaceAuthoritySaga } from './workspace-authority-saga';
import { selectAllWorkspaceScriptEntries } from '../../scripts/scripts-selectors';
import {
  beginScriptRead,
  isScriptReadCurrent,
  reconcileScriptRead,
} from '../../scripts/utils/script-read-context';
import { refreshIntegrationAuthAfterReconnect } from '../../workspace-share/sagas/workspace-share-saga';
import { selectAgentSessionWorkspaceId } from '$store/renderer/slices/agent-session/agent-session-selectors';
import type { StoreState } from '../../../types';
import { getAgentLineStats } from '$features/line-changes/line-changes.client';
import { appClient } from '$lib/client';
import { selectHostRole, selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import {
  selectAgentSession,
  selectAgentSessionsById,
} from '../../agent-session/agent-session-selectors';
import { selectShouldRequestAgentLineStats } from '../../changes/changes-selectors';
import { selectPRStatusLastRefreshTime } from '../../pr-status/pr-status-selectors';
import { selectTerminalsForWorkspace } from '../../terminals/terminals-selectors';
import {
  selectActiveAgentId,
  selectAllWorkspaceAgents,
  selectBackgroundAgentsLoaded,
  selectDelegatedAgentsLoaded,
  selectDelegatedCounts,
  selectDelegatedParentLoaded,
  selectIsLoadingBackgroundAgents,
  selectIsLoadingDelegatedAgents,
  selectIsLoadingDelegatedParent,
  selectIsLoadingOrphanedDelegatedAgents,
  selectIsLoadingRetiredAgents,
  selectLoadedDelegatedParentIds,
  selectOrphanedDelegatedAgentsLoaded,
  selectRetiredAgentsLoaded,
  selectScopeCounts,
  selectScopeCountsGeneration,
  selectWorkspaceAgentIds,
} from '../../workspace-agents/workspace-agents-selectors';
import { selectOlderEventsNextToken } from '../../workspace-events/workspace-events-selectors';
import {
  selectDemandedTaskWorkspaceIds,
  selectWorkspaceTasksShouldLoad,
} from '../../workspace-tasks/workspace-tasks-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '../../workspace/workspace-selectors';
import type { ScriptReadContext } from '../../scripts/utils/script-read-context';
import { createLifecycleReadSaga } from './lifecycle-read-saga-factory';

// Compatibility binding for the existing Svelte root in renderer/sagas.ts.
// Keep its single registration; remove this binding at the Svelte renderer cutover.
export const lifecycleReadSaga = createLifecycleReadSaga<StoreState, ScriptReadContext>({
  appClient,
  getAgentLineStats,
  beginScriptRead,
  isScriptReadCurrent,
  reconcileScriptRead,
  refreshIntegrationAuthAfterReconnect,
  workspaceAuthoritySaga,
  createMembershipSaga: (runRead) =>
    createWorkspaceMembershipSaga({
      principalContextEffect: selectPrincipalActionContext.effect,
      workspaceByIdEffect: selectWorkspaceById.effect,
      getWorkspace: (id) => appClient.workspaces.get(id),
      runRead,
    }),
  selectors: {
    selectAllWorkspaceScriptEntries,
    selectAgentSessionWorkspaceId,
    selectHostRole,
    selectPrincipalActionContext,
    selectCurrentWorkspaceTabId,
    selectAgentSession,
    selectAgentSessionsById,
    selectShouldRequestAgentLineStats,
    selectPRStatusLastRefreshTime,
    selectTerminalsForWorkspace,
    selectActiveAgentId,
    selectAllWorkspaceAgents,
    selectBackgroundAgentsLoaded,
    selectDelegatedAgentsLoaded,
    selectDelegatedCounts,
    selectDelegatedParentLoaded,
    selectIsLoadingBackgroundAgents,
    selectIsLoadingDelegatedAgents,
    selectIsLoadingDelegatedParent,
    selectIsLoadingOrphanedDelegatedAgents,
    selectIsLoadingRetiredAgents,
    selectLoadedDelegatedParentIds,
    selectOrphanedDelegatedAgentsLoaded,
    selectRetiredAgentsLoaded,
    selectScopeCounts,
    selectScopeCountsGeneration,
    selectWorkspaceAgentIds,
    selectOlderEventsNextToken,
    selectDemandedTaskWorkspaceIds,
    selectWorkspaceTasksShouldLoad,
    selectWorkspaceById,
    selectWorkspaceListLoadedForBackend,
  },
});
