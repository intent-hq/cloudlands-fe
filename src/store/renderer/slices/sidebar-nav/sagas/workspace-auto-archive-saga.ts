/**
 * Workspace auto-archive opt-out saga (PROTOCOL §5.1 "Auto-archive opt-out").
 *
 * `setWorkspaceAutoArchiveDisabled` writes the flag through `workspace.update`,
 * applying it to the store right away and rolling back with an error toast on
 * failure. Same write discipline as the label saga: the served value is
 * authoritative, a failed write rolls back only while it is the latest write
 * and the row still shows its optimistic value, and updates this saga did not
 * dispatch (another client's `workspace:updated`, a list refresh) become the
 * rollback target.
 */
import { call, put, take, type SagaGenerator } from 'typed-redux-saga';

import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { store } from '../../../store';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import {
  selectWorkspaceById,
  selectWorkspaceUpdateContext,
} from '../../workspace/workspace-selectors';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import {
  selectCanSetWorkspaceAutoArchive,
  selectWorkspaceAutoArchiveDisabled,
} from '../sidebar-nav-selectors';
import type { setWorkspaceAutoArchiveDisabled } from '../sidebar-nav-slice';

const logger = createLogger('WorkspaceAutoArchiveSaga');

/** Updates this saga dispatched itself (optimistic, rollback, served value). */
const ownUpdates = new WeakSet<object>();

/** The entity keeps the wire shape: the daemon omits the flag while it is off. */
function applyAutoArchiveDisabled(workspaceId: string, disabled: boolean) {
  const action = bulkUpdateWorkspaceEntities([
    updateWorkspaceEntity(workspaceId, { autoArchiveDisabled: disabled || undefined }),
  ]);
  ownUpdates.add(action);
  return action;
}

/**
 * In-flight writes per workspace: the latest token, the value it applied
 * optimistically, and the value to roll back to if it fails.
 */
interface AutoArchiveOwner {
  admission: string;
  dispatch: typeof store.dispatch;
  transport: ReturnType<typeof resolveBackendTransport>;
}

const pendingWrites = new Map<
  string,
  { owner: AutoArchiveOwner; token: number; optimistic: boolean; previous: boolean }
>();
let nextWriteToken = 0;

function sameOwner(
  a: AutoArchiveOwner | null | undefined,
  b: AutoArchiveOwner | null | undefined,
): boolean {
  return (
    !!a &&
    !!b &&
    a.admission === b.admission &&
    a.dispatch === b.dispatch &&
    a.transport === b.transport
  );
}

function* autoArchiveOwner(workspaceId: string): SagaGenerator<AutoArchiveOwner | null> {
  if (!(yield* selectCanSetWorkspaceAutoArchive.effect(workspaceId))) return null;
  const admission = yield* selectWorkspaceUpdateContext.effect(workspaceId, [
    'id',
    'autoArchiveDisabled',
  ]);
  if (admission === null) return null;
  try {
    return { admission, dispatch: store.dispatch, transport: resolveBackendTransport() };
  } catch {
    return null;
  }
}

function forgetOwnWrite(workspaceId: string, token: number): void {
  if (pendingWrites.get(workspaceId)?.token === token) pendingWrites.delete(workspaceId);
}

/** Test-only reset of the module-level pending-write bookkeeping. */
export function resetWorkspaceAutoArchiveWritesForTest(): void {
  pendingWrites.clear();
  nextWriteToken = 0;
}

/**
 * Rebase pending rollbacks on opt-out updates this saga did not dispatch: the
 * daemon (or a fresh list read) now holds that value, so a failed local write
 * must fall back to it.
 */
export function* watchAuthoritativeAutoArchiveDisabled(): SagaGenerator<void> {
  while (true) {
    const action = yield* take(bulkUpdateWorkspaceEntities);
    if (ownUpdates.has(action)) continue;
    for (const update of action.payload[0]) {
      const [workspaceId, changes] = update.payload;
      const pending = pendingWrites.get(workspaceId);
      if (
        pending &&
        'autoArchiveDisabled' in changes &&
        sameOwner(pending.owner, yield* call(autoArchiveOwner, workspaceId))
      ) {
        pending.previous = changes.autoArchiveDisabled === true;
      }
    }
  }
}

export function* setWorkspaceAutoArchiveDisabledWorker(
  action: ReturnType<typeof setWorkspaceAutoArchiveDisabled>,
): SagaGenerator<void> {
  const [workspaceId, disabled] = action.payload;
  const owner = yield* call(autoArchiveOwner, workspaceId);
  if (!owner) return;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;
  const current = workspace.autoArchiveDisabled === true;
  const candidate = pendingWrites.get(workspaceId);
  const pending = sameOwner(candidate?.owner, owner) ? candidate : undefined;
  if (!pending && current === disabled) return;

  const token = ++nextWriteToken;
  // Inherit the earlier write's rollback value only while the row still shows
  // that write's optimistic value; anything else is newer and authoritative.
  const previous = pending && current === pending.optimistic ? pending.previous : current;
  pendingWrites.set(workspaceId, { owner, token, optimistic: disabled, previous });
  try {
    if (!sameOwner(owner, yield* call(autoArchiveOwner, workspaceId))) return;
    yield* put(applyAutoArchiveDisabled(workspaceId, disabled));
    // An optimistic put can retire admission before the actual RPC starts.
    if (!sameOwner(owner, yield* call(autoArchiveOwner, workspaceId))) return;

    let error: string | undefined;
    let caught: unknown;
    let result: Awaited<ReturnType<typeof workspaceClient.update>> | undefined;
    try {
      result = yield* call([workspaceClient, workspaceClient.update], {
        id: workspaceId as WorkspaceId,
        autoArchiveDisabled: disabled,
      });
      if (!result.ok) error = result.error;
    } catch (failure) {
      caught = failure;
    }
    // A retired reply belongs to its original caller, including failures.
    if (!sameOwner(owner, yield* call(autoArchiveOwner, workspaceId))) return;
    const latest = pendingWrites.get(workspaceId);
    if (!sameOwner(latest?.owner, owner)) return;
    if (result?.ok) {
      const served = result.data.autoArchiveDisabled === true;
      if (latest?.token === token) {
        pendingWrites.delete(workspaceId);
        // Re-apply even when it equals the request: a stale row may have
        // landed on top of the optimistic value while the call was in flight.
        yield* put(applyAutoArchiveDisabled(workspaceId, served));
      } else if (latest) {
        // A newer write is in flight; if it fails it should fall back to this value.
        latest.previous = served;
      }
      return;
    }
    if (caught)
      logger.error('Failed to set workspace auto-archive opt-out', { workspaceId, error: caught });
    if (latest?.token !== token) return;
    pendingWrites.delete(workspaceId);
    if ((yield* selectWorkspaceAutoArchiveDisabled.effect(workspaceId)) === disabled) {
      yield* put(applyAutoArchiveDisabled(workspaceId, latest.previous));
    }
    if (sameOwner(owner, yield* call(autoArchiveOwner, workspaceId))) {
      notify.error(error?.trim() || m.workspace_client_updateFailed_error());
    }
  } finally {
    forgetOwnWrite(workspaceId, token);
  }
}
