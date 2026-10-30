/**
 * Workspace auto-archive opt-out saga (PROTOCOL §5.1 "Auto-archive opt-out").
 *
 * `setWorkspaceAutoArchiveDisabled` writes the flag through `workspace.update`,
 * applying it to the store right away and rolling back with an error toast on
 * failure. Overlapping writes for one workspace share one rollback value: a
 * failed write only rolls back while it is still the latest, and falls back to
 * the last value the daemon accepted.
 */
import { call, put, type SagaGenerator } from 'typed-redux-saga';

import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { selectWorkspaceAutoArchiveDisabled } from '../sidebar-nav-selectors';
import type { setWorkspaceAutoArchiveDisabled } from '../sidebar-nav-slice';

const logger = createLogger('WorkspaceAutoArchiveSaga');

/** The entity keeps the wire shape: the daemon omits the flag while it is off. */
function applyAutoArchiveDisabled(workspaceId: string, disabled: boolean) {
  return bulkUpdateWorkspaceEntities([
    updateWorkspaceEntity(workspaceId, { autoArchiveDisabled: disabled || undefined }),
  ]);
}

/** In-flight writes per workspace: the latest token and the value to roll back to. */
const pendingWrites = new Map<string, { token: number; previous: boolean }>();
let nextWriteToken = 0;

/** Test-only reset of the module-level pending-write bookkeeping. */
export function resetWorkspaceAutoArchiveWritesForTest(): void {
  pendingWrites.clear();
  nextWriteToken = 0;
}

export function* setWorkspaceAutoArchiveDisabledWorker(
  action: ReturnType<typeof setWorkspaceAutoArchiveDisabled>,
): SagaGenerator<void> {
  const [workspaceId, disabled] = action.payload;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;
  const current = workspace.autoArchiveDisabled === true;
  const pending = pendingWrites.get(workspaceId);
  if (!pending && current === disabled) return;

  const token = ++nextWriteToken;
  pendingWrites.set(workspaceId, { token, previous: pending ? pending.previous : current });
  yield* put(applyAutoArchiveDisabled(workspaceId, disabled));

  let error: string | undefined;
  try {
    const result = yield* call([workspaceClient, workspaceClient.update], {
      id: workspaceId as WorkspaceId,
      autoArchiveDisabled: disabled,
    });
    if (result.ok) {
      const latest = pendingWrites.get(workspaceId);
      if (latest?.token === token) {
        pendingWrites.delete(workspaceId);
        const served = result.data.autoArchiveDisabled === true;
        if (served !== disabled) yield* put(applyAutoArchiveDisabled(workspaceId, served));
      } else if (latest) {
        // A newer write is in flight; if it fails it should fall back to this value.
        latest.previous = disabled;
      }
      return;
    }
    error = result.error;
  } catch (caught) {
    logger.error('Failed to set workspace auto-archive opt-out', { workspaceId, error: caught });
  }

  const latest = pendingWrites.get(workspaceId);
  if (latest?.token !== token) return;
  pendingWrites.delete(workspaceId);
  if ((yield* selectWorkspaceAutoArchiveDisabled.effect(workspaceId)) === disabled) {
    yield* put(applyAutoArchiveDisabled(workspaceId, latest.previous));
  }
  notify.error(error?.trim() || m.workspace_client_updateFailed_error());
}
