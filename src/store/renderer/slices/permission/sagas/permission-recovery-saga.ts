import { channel, type Channel, type Task } from 'redux-saga';
import { call, cancel, fork, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { createChannelFromSelector } from '@themislib/themis/saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import {
  selectWorkspaceManagementDenied,
  selectWorkspacePermissionContext,
} from '../../workspace/workspace-selectors';
import {
  selectPermissionRecoveryAdmission,
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
function* recoverPendingPermissions(
  readSettled: Channel<number>,
  generation: number,
): SagaGenerator<void> {
  const context = yield* selectPermissionRecoveryAdmission.effect();
  if (!context) {
    yield* put(readSettled, generation);
    return;
  }
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
    const result = yield* call(
      backendRequest<{ requests: PermissionRequest[] }>,
      'agent.pendingPermissions',
      {},
    );
    if (context !== (yield* selectPermissionRecoveryAdmission.effect())) return;
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
    yield* put(readSettled, generation);
  }

  const identities = yield* createChannelFromSelector(selectPermissionRecoveryAgents);
  try {
    while (true) {
      yield* take(identities);
      if (context !== (yield* selectPermissionRecoveryAdmission.effect())) return;
      const agents = yield* selectAgentSessionsById.effect();
      const recovered: PermissionRequest[] = [];
      for (const request of pending.values()) {
        const workspaceId = agents[request.sessionId]?.workspaceId;
        if (!workspaceId) continue;
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
      if (recovered.length) yield* put(setPendingRequests(recovered));
    }
  } finally {
    identities.close();
  }
}

type RecoveryScope = { context: string; workspaceIds: Set<string> };

function parseScope(payload: string | null): RecoveryScope | null {
  if (!payload) return null;
  const [context, workspaceIds] = JSON.parse(payload) as [string, string[]];
  return { context, workspaceIds: new Set(workspaceIds) };
}

/**
 * One snapshot per admission. A later management grant needs a fresh read, but
 * a cancelled read is already on the wire, so grants that land while a read is
 * in flight coalesce into a single trailing read instead of one RPC per row.
 * Revocations need no read: confirmed denial drops cached prompts locally.
 */
export function* permissionRecoverySaga(): SagaGenerator<void> {
  const scopes = yield* createChannelFromSelector(selectPermissionRecoveryScope);
  const readSettled = channel<number>();
  let task: Task | null = null;
  let generation = 0;
  let reading = false;
  let trailing = false;
  let covered: RecoveryScope | null = null;
  function* start(scope: RecoveryScope): SagaGenerator<void> {
    if (task) yield* cancel(task);
    covered = scope;
    reading = true;
    trailing = false;
    task = yield* fork(recoverPendingPermissions, readSettled, ++generation);
  }
  try {
    while (true) {
      const { scope, settled } = yield* race({
        scope: take(scopes),
        settled: take(readSettled),
      });
      if (settled !== undefined) {
        if (settled !== generation) continue;
        reading = false;
        if (trailing && covered) yield* start(covered);
        continue;
      }
      const next = parseScope(scope!.payload);
      if (!next) {
        if (task) yield* cancel(task);
        task = null;
        covered = null;
        reading = trailing = false;
        continue;
      }
      if (!covered || covered.context !== next.context) {
        yield* start(next);
        continue;
      }
      const gained = [...next.workspaceIds].some((id) => !covered!.workspaceIds.has(id));
      covered = next;
      if (!gained) continue;
      if (reading) trailing = true;
      else yield* start(next);
    }
  } finally {
    scopes.close();
    readSettled.close();
  }
}
