import { store } from '@/store';
import { backend } from '@/features/backend/backend-transport';
import { agentReadOwnership } from '@/features/agent/agent-read-service';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectCurrentWorkspaceTabId } from '@/store/tab-state/tab-state-selectors';
import { selectAgentMessages } from '@/store/agent-session/agent-session-selectors';
import {
  selectCurrentlyViewedAgentId,
  selectDividerBoundaryStateSnapshot,
  selectAgentSessionHasStreamingTailMessage,
} from '@/store/unread-tracking/unread-tracking-selectors';
import { createMarkAgentSeen } from '../../../../../src/features/agent/mark-agent-seen-factory';
import { createUnreadTrackingSaga } from '../../../../../src/store/renderer/slices/unread-tracking/sagas/unread-tracking-saga-factory';
import { getPrincipalConnectionContext } from '../../../../../src/store/renderer/slices/principal/principal-context';
import { getPrincipalSnapshot } from '../../../../../src/store/renderer/slices/principal/principal-projections';
import { getWorkspaceParticipationContext } from '../../../../../src/store/renderer/slices/workspace/workspace-authority-projections';
import { createBackendAgentSeen } from '$lib/client/live/backend-agent-seen';
import type { BackendRequestOptions } from '$lib/client/live/backend-transport-types';
import { clearCachedChatScroll } from '$lib/components/chat/chat-scroll-cache';
import { m } from '$shared/paraglide/messages.js';

/** Started once by the desktop root; cancellation disposes its sole marker/timer owner. */
export function* desktopUnreadTrackingSaga() {
  const marker = createMarkAgentSeen({
    captureOwnership(agentId) {
      const state = store.state;
      const workspaceId = state.agentSessions.byAgentId[agentId]?.workspaceId;
      if (!workspaceId) return null;
      const admission = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
      const participation = getWorkspaceParticipationContext(state, workspaceId);
      const connection = getPrincipalConnectionContext(state);
      const principal = getPrincipalSnapshot(state)?.principal.id;
      if (!admission || !participation || !connection || !principal) return null;
      const ownership = agentReadOwnership.captureAgentMutationOwnership(agentId, workspaceId);
      return {
        key: JSON.stringify([
          admission,
          participation,
          connection,
          principal,
          workspaceId,
          ownership.key,
        ]),
        isCurrent: () => {
          const current = store.state;
          return (
            selectAdmittedWorkspaceReadContext.select(current, workspaceId) === admission &&
            getWorkspaceParticipationContext(current, workspaceId) === participation &&
            getPrincipalConnectionContext(current) === connection &&
            getPrincipalSnapshot(current)?.principal.id === principal &&
            current.agentSessions.byAgentId[agentId]?.workspaceId === workspaceId &&
            ownership.isCurrent(workspaceId)
          );
        },
      };
    },
    loadSeams: async () => ({
      getState: () => store.state,
      markSeen: (params, isCurrent) =>
        createBackendAgentSeen(
          async <T>(method: string, payload?: unknown, options?: BackendRequestOptions) => {
            const assertCurrent = () => {
              if (!isCurrent()) throw new Error(m.workspace_client_accessChanged_error());
            };
            assertCurrent();
            const result = await backend.backendRequest<T>(method, payload, {
              ...options,
              onDispatch: assertCurrent,
            });
            assertCurrent();
            return result;
          },
        )(params),
    }),
  });
  yield* createUnreadTrackingSaga({
    marker,
    dispose: marker.dispose,
    clearCachedChatScroll,
    selectCurrentWorkspaceTabId,
    selectCurrentlyViewedAgentId,
    selectDividerBoundaryStateSnapshot,
    selectAgentMessages,
    selectAgentSessionHasStreamingTailMessage,
  })();
}
