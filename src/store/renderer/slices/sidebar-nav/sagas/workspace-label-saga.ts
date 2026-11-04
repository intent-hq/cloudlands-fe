/**
 * Workspace label sagas (PROTOCOL §5.1 "Workspace labels").
 *
 * - `setWorkspaceLabel` writes the label through `workspace.update`, applying
 *   it to the store right away and rolling back with an error toast on failure.
 * - `togglePinWorkspace` becomes a `"pinned"` label write when the daemon
 *   advertises `workspaceLabels: 1`; older daemons keep the local pin list.
 * - A one-time migration per backend copies the local pins onto unlabelled
 *   workspaces as `"pinned"`. The local pin key is never removed, so rolling
 *   the client back keeps the pins.
 */
import { call, put, take, type SagaGenerator } from 'typed-redux-saga';

import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types/branded-ids';
import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { principalReceived } from '../../principal/principal-slice';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { store } from '../../../store';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectWorkspaceUpdateContext } from '../../workspace/workspace-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '../../workspace/workspace-selectors';
import {
  bulkUpdateWorkspaceEntities,
  setWorkspaceHasLoaded,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import {
  selectCanSetWorkspaceLabel,
  selectLabelsSupported,
  selectLocalPinnedWorkspaceIds,
  selectWorkspaceLabel,
} from '../sidebar-nav-selectors';
import {
  hydrateSidebarNav,
  PINNED_WORKSPACES_KEY,
  PINNED_WORKSPACES_LABEL_MIGRATION_KEY,
  setWorkspaceLabel,
  type togglePinWorkspace,
} from '../sidebar-nav-slice';
import { isPinnedWorkspaceLabel, PINNED_WORKSPACE_LABEL } from '../workspace-labels';

const logger = createLogger('WorkspaceLabelSaga');

/** Label updates this saga dispatched itself (optimistic, rollback, served value). */
const ownLabelUpdates = new WeakSet<object>();

function applyLabel(workspaceId: string, label: string | null) {
  const action = bulkUpdateWorkspaceEntities([
    updateWorkspaceEntity(workspaceId, { label: label ?? undefined }),
  ]);
  ownLabelUpdates.add(action);
  return action;
}

/**
 * In-flight label writes per workspace: the latest token, the value it applied
 * optimistically, and the value to roll back to if it fails.
 */
const pendingLabelWrites = new Map<
  string,
  { owner: LabelOwner; token: number; optimistic: string | null; previous: string | null }
>();
let nextLabelWriteToken = 0;

type LabelOwner = { admission: string; dispatch: typeof store.dispatch };

function sameOwner(a: LabelOwner | null | undefined, b: LabelOwner | null | undefined): boolean {
  return !!a && !!b && a.admission === b.admission && a.dispatch === b.dispatch;
}

function* labelOwner(workspaceId?: string): SagaGenerator<LabelOwner | null> {
  if (!(yield* selectLabelsSupported.effect())) return null;
  const admission =
    workspaceId === undefined
      ? yield* selectPrincipalActionContext.effect()
      : yield* selectWorkspaceUpdateContext.effect(workspaceId, ['id', 'label']);
  if (admission === null) return null;
  try {
    return { admission, dispatch: store.dispatch };
  } catch {
    return null;
  }
}

function forgetOwnWrite(workspaceId: string, token: number): void {
  if (pendingLabelWrites.get(workspaceId)?.token === token) pendingLabelWrites.delete(workspaceId);
}

/** Test-only reset of the module-level pending-write bookkeeping. */
export function resetWorkspaceLabelWritesForTest(): void {
  pendingLabelWrites.clear();
  nextLabelWriteToken = 0;
}

/**
 * Rebase pending rollbacks on label updates this saga did not dispatch (e.g.
 * another client's `workspace:updated`): the daemon now holds that value, so a
 * failed local write must fall back to it, even when it equals the optimistic
 * value the row already shows.
 */
export function* watchAuthoritativeWorkspaceLabels(): SagaGenerator<void> {
  while (true) {
    const action = yield* take(bulkUpdateWorkspaceEntities);
    if (ownLabelUpdates.has(action)) continue;
    for (const update of action.payload[0]) {
      const [workspaceId, changes] = update.payload;
      const pending = pendingLabelWrites.get(workspaceId);
      if (
        pending &&
        'label' in changes &&
        sameOwner(pending.owner, yield* call(labelOwner, workspaceId))
      ) {
        pending.previous = normalizeLabel(changes.label ?? null);
      }
    }
  }
}

function normalizeLabel(label: string | null): string | null {
  if (label === null) return null;
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Write one workspace's label. Returns whether the daemon accepted it. On a
 * failure the optimistic value is rolled back (unless a newer write owns the
 * row) and, unless `silent`, an error toast is shown.
 */
function* writeWorkspaceLabel(
  workspaceId: string,
  requested: string | null,
  options: { silent?: boolean } = {},
): SagaGenerator<boolean> {
  const owner = yield* call(labelOwner, workspaceId);
  if (!owner) return false;
  const label = normalizeLabel(requested);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return false;
  const current = workspace.label ?? null;
  const candidate = pendingLabelWrites.get(workspaceId);
  const pending = sameOwner(candidate?.owner, owner) ? candidate : undefined;
  if (!pending && current === label) return true;

  const token = ++nextLabelWriteToken;
  const previous = pending && current === pending.optimistic ? pending.previous : current;
  pendingLabelWrites.set(workspaceId, { owner, token, optimistic: label, previous });
  try {
    yield* put(applyLabel(workspaceId, label));
    if (!sameOwner(owner, yield* call(labelOwner, workspaceId))) {
      forgetOwnWrite(workspaceId, token);
      return false;
    }

    let error: string | undefined;
    let result: Awaited<ReturnType<typeof workspaceClient.update>> | undefined;
    try {
      result = yield* call([workspaceClient, workspaceClient.update], {
        id: workspaceId as WorkspaceId,
        label,
      });
      if (!result.ok) error = result.error;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      logger.error('Workspace label update failed', { error: caught });
    }
    // A retired mutation is not a failed write belonging to the newly admitted row.
    if (!sameOwner(owner, yield* call(labelOwner, workspaceId))) {
      forgetOwnWrite(workspaceId, token);
      return false;
    }
    const latest = pendingLabelWrites.get(workspaceId);
    if (!sameOwner(latest?.owner, owner)) return false;
    if (result?.ok) {
      if (latest?.token === token) {
        pendingLabelWrites.delete(workspaceId);
        const served = result.data.label ?? null;
        if (served !== label) yield* put(applyLabel(workspaceId, served));
      } else if (latest) {
        latest.previous = label;
      }
      return true;
    }
    if (latest?.token !== token) return false;
    pendingLabelWrites.delete(workspaceId);
    const row = yield* selectWorkspaceById.effect(workspaceId);
    if ((row?.label ?? null) === latest.optimistic) {
      yield* put(applyLabel(workspaceId, latest.previous));
    }
    if (!options.silent && sameOwner(owner, yield* call(labelOwner, workspaceId))) {
      notify.error(error?.trim() || m.workspace_client_updateFailed_error());
    }
    return false;
  } finally {
    forgetOwnWrite(workspaceId, token);
  }
}

export function* setWorkspaceLabelWorker(
  action: ReturnType<typeof setWorkspaceLabel>,
): SagaGenerator<void> {
  const [workspaceId, label] = action.payload;
  yield* call(writeWorkspaceLabel, workspaceId, label);
}

/**
 * Label-backed pin toggle. Returns `false` on an older daemon so the caller
 * keeps the local-only behaviour. The local list (already toggled by the
 * reducer) is mirrored to the label decision so a client rollback shows the
 * same pins.
 */
export function* togglePinWithLabel(
  action: ReturnType<typeof togglePinWorkspace>,
): SagaGenerator<boolean> {
  if (!(yield* selectLabelsSupported.effect())) return false;
  const [workspaceId] = action.payload;
  const pin = !isPinnedWorkspaceLabel(yield* selectWorkspaceLabel.effect(workspaceId));
  const local = yield* selectLocalPinnedWorkspaceIds.effect();
  const mirrored = pin
    ? local.includes(workspaceId)
      ? local
      : [...local, workspaceId]
    : local.filter((id) => id !== workspaceId);
  if (mirrored !== local && mirrored.join('\n') !== local.join('\n')) {
    yield* put(hydrateSidebarNav({ pinnedWorkspaceIds: mirrored }));
  }
  yield* put(setWorkspaceLabel(workspaceId, pin ? PINNED_WORKSPACE_LABEL : null));
  return true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Copy this backend's local pins onto unlabelled workspaces once the daemon
 * supports labels and the workspace list has loaded. Marked done only when
 * every write succeeded, so a failure retries on the next app start.
 */
function* migrateLocalPinsToLabels(attempted: Map<string, LabelOwner>): SagaGenerator<void> {
  const owner = yield* call(labelOwner);
  if (!owner) return;
  const backendId = yield* selectActiveBackendId();
  if (sameOwner(attempted.get(backendId), owner)) return;
  if (!(yield* selectWorkspaceListLoadedForBackend.effect(backendId))) return;
  attempted.set(backendId, owner);
  try {
    const doneKey = namespaceBackendKey(PINNED_WORKSPACES_LABEL_MIGRATION_KEY, backendId);
    const done = yield* call(getLocalStorageJSON<unknown>, doneKey);
    if (!sameOwner(owner, yield* call(labelOwner))) return;
    if (done === true) return;
    const saved = yield* call(
      getLocalStorageJSON<unknown>,
      namespaceBackendKey(PINNED_WORKSPACES_KEY, backendId),
    );
    if (!sameOwner(owner, yield* call(labelOwner))) return;
    let allSucceeded = true;
    for (const workspaceId of stringArray(saved)) {
      if (!sameOwner(owner, yield* call(labelOwner))) return;
      const workspace = yield* selectWorkspaceById.effect(workspaceId);
      if (!workspace || workspace.label) continue;
      if (!(yield* selectCanSetWorkspaceLabel.effect(workspaceId))) continue;
      const ok = yield* call(writeWorkspaceLabel, workspaceId, PINNED_WORKSPACE_LABEL, {
        silent: true,
      });
      if (!sameOwner(owner, yield* call(labelOwner))) return;
      if (!ok) allSucceeded = false;
    }
    if (allSucceeded && sameOwner(owner, yield* call(labelOwner))) {
      yield* call(setLocalStorageJSON, doneKey, true);
    }
  } finally {
    if (!sameOwner(owner, yield* call(labelOwner)) && attempted.get(backendId) === owner) {
      attempted.delete(backendId);
    }
  }
}

export function* watchPinLabelMigration(): SagaGenerator<void> {
  const attempted = new Map<string, LabelOwner>();
  while (true) {
    const startedWith = yield* call(labelOwner);
    try {
      yield* call(migrateLocalPinsToLabels, attempted);
    } catch (error) {
      logger.error('Pin label migration failed', { error });
    }
    const current = yield* call(labelOwner);
    if (current && !sameOwner(startedWith, current)) continue;
    yield* take([setWorkspaceHasLoaded, principalReceived, connectionsListReceived]);
  }
}
