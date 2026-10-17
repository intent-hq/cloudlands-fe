import { trackAgentRecoveryRead } from '$features/agent/agent-recovery-read-lane';
import { agentRecoveryWorkspaceCurrent } from '$features/agent/agent-recovery-workspace-scope';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { AGENT_PERMISSIONS_RECOVERY_KEY } from '$features/agent/agent-recovery-keys';
import { withRecoveryLifetime } from '$store/renderer/middlewares/event-recovery';
import { call, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import {
  createChannelFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@themislib/themis/saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import {
  selectWorkspaceManagementDenied,
  selectWorkspacePermissionContext,
} from '../../workspace/workspace-selectors';
import {
  selectPermissionRecoveryAgents,
  selectPermissionRecoveryScope,
} from '../permission-selectors';
import { selectAgentSessionsById } from '../../agent-session/agent-session-selectors';
import {
  permissionRequestReceived,
  removePermissionRequest,
  setPendingRequests,
  type PermissionRequest,
} from '../permission-slice';

/** Recover once per admitted subscription; live events own subsequent updates. */
function* recoverPendingPermissions(): SagaGenerator<void> {
  const context = yield* selectPermissionRecoveryScope.effect();
  if (!context) return;
  const recovery = rendererEventRecovery.capture(AGENT_PERMISSIONS_RECOVERY_KEY);
  if (!recovery.commit(() => undefined)) return;
  const pending = new Map<string, PermissionRequest>();
  const changedDuringRead = new Set<string>();
  let reading = true;
  // Start before the snapshot. Late replies and late agent discovery must never
  // overwrite a newer live prompt or resurrect a resolved one.
  const invalidate = (id: string) => {
    if (reading) changedDuringRead.add(id);
    pending.delete(id);
  };
  yield* takeEvery(permissionRequestReceived, function* (action) {
    yield* call(invalidate, action.payload[0].requestId);
  });
  yield* takeEvery(removePermissionRequest, function* (action) {
    yield* call(invalidate, action.payload[0]);
  });
  try {
    // The aggregate is routed to this window's backend and filtered by the
    // server's current workspace management grants before returning any prompts.
    const result = yield* call(() =>
      trackAgentRecoveryRead(
        AGENT_PERMISSIONS_RECOVERY_KEY,
        () => {
          if (!recovery.commit(() => undefined))
            throw new Error('Permission read authority retired');
          return backendRequest<{ requests: PermissionRequest[] }>('agent.pendingPermissions', {});
        },
        rendererEventRecovery.hasOwner(AGENT_PERMISSIONS_RECOVERY_KEY) ? recovery : undefined,
      ),
    );
    if (
      !recovery.commit(() => undefined) ||
      context !== (yield* selectPermissionRecoveryScope.effect())
    )
      return;
    if (
      !Array.isArray(result.requests) ||
      result.requests.some(
        (r) =>
          !r ||
          typeof r.sessionId !== 'string' ||
          !r.sessionId ||
          typeof r.requestId !== 'string' ||
          !r.requestId ||
          typeof r.title !== 'string' ||
          !Array.isArray(r.options) ||
          r.options.some((o) => !o || typeof o.id !== 'string' || typeof o.label !== 'string') ||
          typeof r.timestamp !== 'number',
      )
    )
      return;
    for (const request of result.requests) {
      if (!changedDuringRead.has(request.requestId)) pending.set(request.requestId, request);
    }
  } catch {
    // Failed recovery leaves live prompts intact; retry on a new subscription.
    return;
  } finally {
    reading = false;
    changedDuringRead.clear();
  }

  const identities = yield* createChannelFromSelector(selectPermissionRecoveryAgents);
  try {
    while (true) {
      yield* take(identities);
      if (
        !recovery.commit(() => undefined) ||
        context !== (yield* selectPermissionRecoveryScope.effect())
      )
        return;
      const agents = yield* selectAgentSessionsById.effect();
      const recovered: PermissionRequest[] = [];
      for (const request of pending.values()) {
        const workspaceId = agents[request.sessionId]?.workspaceId;
        if (!workspaceId || !agentRecoveryWorkspaceCurrent(workspaceId)) continue;
        if (!(yield* selectWorkspacePermissionContext.effect(workspaceId))) {
          // Confirmed denial invalidates a snapshot. Unknown capabilities can
          // hydrate later, but a later grant must not revive an old prompt.
          if (yield* selectWorkspaceManagementDenied.effect(workspaceId))
            pending.delete(request.requestId);
          continue;
        }
        pending.delete(request.requestId);
        recovered.push({ ...request, workspaceId });
      }
      if (recovered.length)
        yield* put(withRecoveryLifetime(setPendingRequests(recovered), recovery));
    }
  } finally {
    identities.close();
  }
}

export function* permissionRecoverySaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(
    selectPermissionRecoveryScope,
    function* ({ payload }: SelectorChannelPayload<string | null>) {
      if (payload) yield* call(recoverPendingPermissions);
    },
  );
}
