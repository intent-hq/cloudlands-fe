import { actionChannel, call, flush, put, type SagaGenerator } from 'typed-redux-saga';
import { buffers } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { selectWorkspacePermissionContext } from '../../workspace/workspace-selectors';
import { selectPermissionRecoveryScope } from '../permission-selectors';
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
    const changes = yield* actionChannel(
      [permissionRequestReceived, removePermissionRequest],
      buffers.expanding(),
    );
    try {
      const result = yield* call(
        backendRequest<{ requests: PermissionRequest[] }>,
        'agent.pendingPermissions',
        { agentId: agent.id },
      );
      if (context !== (yield* selectWorkspacePermissionContext.effect(agent.workspaceId))) return;
      const live = yield* flush(changes);
      const changedIds = new Set(
        live.map((action) =>
          action.type === removePermissionRequest.type
            ? (action as ReturnType<typeof removePermissionRequest>).payload[0]
            : (action as ReturnType<typeof permissionRequestReceived>).payload[0].requestId,
        ),
      );
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
      const pending = result.requests.filter((r) => !changedIds.has(r.requestId));
      if (pending.length)
        yield* put(
          setPendingRequests(pending.map((r) => ({ ...r, workspaceId: agent.workspaceId }))),
        );
    } catch {
      // Failed recovery leaves live prompts intact; no invented empty success.
    } finally {
      changes.close();
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
