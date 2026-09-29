import { call, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { selectWorkspacePermissionContext } from '../../workspace/workspace-selectors';
import {
  selectPermissionRequestsCollection,
  selectPermissionRecoveryScope,
} from '../permission-selectors';
import { selectAgentSessionsById } from '../../agent-session/agent-session-selectors';
import {
  permissionRequestReceived,
  removePermissionRequest,
  setPendingRequests,
  type PermissionRequest,
} from '../permission-slice';

/** A late list may not resurrect a prompt resolved by a live event during that read. */
export function* recoverPendingPermissions(): SagaGenerator<void> {
  const agents = Object.values(yield* selectAgentSessionsById.effect());
  for (const agent of agents) {
    if (!agent.workspaceId) continue;
    const context = yield* selectWorkspacePermissionContext.effect(agent.workspaceId);
    if (!context) continue;
    const before = yield* selectPermissionRequestsCollection.effect();
    try {
      const { result } = yield* race({
        result: call(
          backendRequest<{ requests: PermissionRequest[] }>,
          'agent.pendingPermissions',
          { agentId: agent.id },
        ),
        changed: take([permissionRequestReceived, removePermissionRequest]),
      });
      if (!result) continue;
      if (context !== (yield* selectWorkspacePermissionContext.effect(agent.workspaceId))) return;
      if (before !== (yield* selectPermissionRequestsCollection.effect())) continue;
      if (
        !Array.isArray(result.requests) ||
        result.requests.some(
          (r) =>
            r.sessionId !== agent.id ||
            !r.requestId ||
            typeof r.title !== 'string' ||
            !Array.isArray(r.options) ||
            r.options.some((o) => typeof o.id !== 'string' || typeof o.label !== 'string') ||
            typeof r.timestamp !== 'number',
        )
      )
        continue;
      yield* put(
        setPendingRequests(result.requests.map((r) => ({ ...r, workspaceId: agent.workspaceId }))),
      );
    } catch {
      // Failed recovery leaves live prompts intact; no invented empty success.
    }
  }
}

export function* permissionRecoverySaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(
    selectPermissionRecoveryScope,
    function* ({ payload }: SelectorChannelPayload<string>) {
      if (payload !== '[]') yield* call(recoverPendingPermissions);
    },
  );
}
