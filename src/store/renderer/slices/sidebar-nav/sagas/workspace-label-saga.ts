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

function applyLabel(workspaceId: string, label: string | null) {
  return bulkUpdateWorkspaceEntities([
    updateWorkspaceEntity(workspaceId, { label: label ?? undefined }),
  ]);
}

/**
 * In-flight label writes per workspace: the latest token, the value it applied
 * optimistically, and the value to roll back to if it fails.
 */
const pendingLabelWrites = new Map<
  string,
  { token: number; optimistic: string | null; previous: string | null }
>();
let nextLabelWriteToken = 0;

/** Test-only reset of the module-level pending-write bookkeeping. */
export function resetWorkspaceLabelWritesForTest(): void {
  pendingLabelWrites.clear();
  nextLabelWriteToken = 0;
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
  const label = normalizeLabel(requested);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return false;
  const current = workspace.label ?? null;
  const pending = pendingLabelWrites.get(workspaceId);
  if (!pending && current === label) return true;

  const token = ++nextLabelWriteToken;
  // Inherit the earlier write's rollback value only while the row still shows
  // that write's optimistic value; an authoritative update in between (e.g.
  // another client's workspace:updated) becomes the new rollback target.
  const previous = pending && current === pending.optimistic ? pending.previous : current;
  pendingLabelWrites.set(workspaceId, { token, optimistic: label, previous });
  yield* put(applyLabel(workspaceId, label));

  let error: string | undefined;
  try {
    const result = yield* call([workspaceClient, workspaceClient.update], {
      id: workspaceId as WorkspaceId,
      label,
    });
    if (result.ok) {
      const latest = pendingLabelWrites.get(workspaceId);
      if (latest?.token === token) {
        pendingLabelWrites.delete(workspaceId);
        const served = result.data.label ?? null;
        if (served !== label) {
          yield* put(applyLabel(workspaceId, served));
        }
      } else if (latest) {
        // A newer write is in flight; if it fails it should fall back to this value.
        latest.previous = label;
      }
      return true;
    }
    error = result.error;
  } catch (caught) {
    logger.error('Failed to set workspace label', { workspaceId, error: caught });
  }

  const latest = pendingLabelWrites.get(workspaceId);
  if (latest?.token !== token) return false;
  pendingLabelWrites.delete(workspaceId);
  if ((yield* selectWorkspaceLabel.effect(workspaceId)) === label) {
    yield* put(applyLabel(workspaceId, latest.previous));
  }
  if (!options.silent) notify.error(error?.trim() || m.workspace_client_updateFailed_error());
  return false;
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
function* migrateLocalPinsToLabels(attempted: Set<string>): SagaGenerator<void> {
  if (!(yield* selectLabelsSupported.effect())) return;
  const backendId = yield* selectActiveBackendId();
  if (attempted.has(backendId)) return;
  if (!(yield* selectWorkspaceListLoadedForBackend.effect(backendId))) return;
  attempted.add(backendId);

  const doneKey = namespaceBackendKey(PINNED_WORKSPACES_LABEL_MIGRATION_KEY, backendId);
  if ((yield* call(getLocalStorageJSON<unknown>, doneKey)) === true) return;

  const pinned = stringArray(
    yield* call(
      getLocalStorageJSON<unknown>,
      namespaceBackendKey(PINNED_WORKSPACES_KEY, backendId),
    ),
  );
  let allSucceeded = true;
  for (const workspaceId of pinned) {
    const workspace = yield* selectWorkspaceById.effect(workspaceId);
    if (!workspace || workspace.label) continue;
    if (!(yield* selectCanSetWorkspaceLabel.effect(workspaceId))) continue;
    const ok = yield* call(writeWorkspaceLabel, workspaceId, PINNED_WORKSPACE_LABEL, {
      silent: true,
    });
    if (!ok) allSucceeded = false;
  }
  if (allSucceeded) yield* call(setLocalStorageJSON, doneKey, true);
}

export function* watchPinLabelMigration(): SagaGenerator<void> {
  const attempted = new Set<string>();
  while (true) {
    try {
      yield* call(migrateLocalPinsToLabels, attempted);
    } catch (error) {
      logger.error('Pin label migration failed', { error });
    }
    yield* take([setWorkspaceHasLoaded, principalReceived, connectionsListReceived]);
  }
}
