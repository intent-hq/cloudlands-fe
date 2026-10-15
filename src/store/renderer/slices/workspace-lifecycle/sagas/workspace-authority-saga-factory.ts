import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  delay,
  flush,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, Result } from '$shared/types';
import {
  bulkUpdateWorkspaceEntities,
  loadRecencyData,
  loadWorkspacesRequested,
  workspaceListReadStatusChanged,
  replaceWorkspaceList,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { backendReconnected, workspaceDeleted } from '../workspace-lifecycle-slice';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
const logger = createLogger('WorkspaceAuthoritySaga');
const WORKSPACE_LIST_RETRY_DELAYS_MS = [1_000, 2_000, 5_000];
const WORKSPACE_LIST_RETRY_CAP_MS = 15_000;
const FORBIDDEN_ERROR_MESSAGE = 'Forbidden';
export interface WorkspaceAuthorityDependencies {
  dispatchIdentity: () => unknown;
  backendIdEffect: () => SagaGenerator<string>;
  principalContextEffect: () => SagaGenerator<string | null>;
  deletionTokensEffect: () => SagaGenerator<Record<string, string>>;
  listLoadedEffect: (backendId: string) => SagaGenerator<boolean>;
  listWorkspaces: () => Promise<Result<Workspace[], string> & { complete?: boolean }>;
  recentViews?: () => Promise<Record<string, number>>;
}
export function createWorkspaceAuthoritySaga({
  dispatchIdentity,
  backendIdEffect,
  principalContextEffect,
  deletionTokensEffect,
  listLoadedEffect,
  listWorkspaces,
  recentViews,
}: WorkspaceAuthorityDependencies) {
  type WorkspaceProjectionAction = ReturnType<
    | typeof setWorkspaceEntity
    | typeof updateWorkspaceEntity
    | typeof bulkUpdateWorkspaceEntities
    | typeof removeWorkspaceEntity
    | typeof workspaceDeleted
  >;

  function* refreshWorkspaces(): SagaGenerator<void> {
    const dispatch = dispatchIdentity();
    const backendId = yield* backendIdEffect();
    const context = yield* principalContextEffect();
    if (!context) return;
    const changes = yield* actionChannel(
      [
        setWorkspaceEntity,
        updateWorkspaceEntity,
        bulkUpdateWorkspaceEntities,
        removeWorkspaceEntity,
        workspaceDeleted,
      ],
      buffers.expanding<WorkspaceProjectionAction>(),
    );
    try {
      yield* put(workspaceListReadStatusChanged(context, 'loading'));
      const deletionTokens = yield* deletionTokensEffect();
      const result = yield* call(listWorkspaces);
      if (
        dispatchIdentity() !== dispatch ||
        backendId !== (yield* backendIdEffect()) ||
        context !== (yield* principalContextEffect())
      )
        return;
      if (!result.ok) throw new Error(result.error);
      // Replay only fields carried by current events. A title-only event must not
      // copy a prior admission's capability fields over the fresh list projection.
      const rows = new Map(result.data.map((row) => [row.id as string, row]));
      const record = (action: WorkspaceProjectionAction) => {
        if (action.type === bulkUpdateWorkspaceEntities.type) {
          for (const nested of action.payload[0] as ReturnType<typeof updateWorkspaceEntity>[])
            record(nested);
        } else if (action.type === setWorkspaceEntity.type) {
          const row = action.payload[0] as Workspace;
          rows.set(row.id, row);
        } else if (action.type === updateWorkspaceEntity.type) {
          const [id, patch] = action.payload as [string, Partial<Workspace>];
          const row = rows.get(id);
          if (row) rows.set(id, { ...row, ...patch });
        } else rows.delete(action.payload[0] as string);
      };
      for (const action of yield* flush(changes)) record(action);
      yield* put(
        replaceWorkspaceList([...rows.values()], {
          complete: result.complete === true,
          deletionTokens,
        }),
      );
      yield* put(setWorkspaceHasLoaded(true, backendId, context));
      yield* put(workspaceListReadStatusChanged(context, 'ready'));
      if (!recentViews) return;
      const views = yield* call(recentViews);
      if (
        dispatchIdentity() !== dispatch ||
        backendId !== (yield* backendIdEffect()) ||
        context !== (yield* principalContextEffect())
      )
        return;
      yield* put(loadRecencyData({ lastViewedAt: views }));
    } catch (error) {
      if (
        dispatchIdentity() === dispatch &&
        backendId === (yield* backendIdEffect()) &&
        context === (yield* principalContextEffect())
      )
        yield* put(workspaceListReadStatusChanged(context, 'error'));
      throw error;
    } finally {
      changes.close();
    }
  }

  /**
   * A `-32003 Forbidden` refusal is a stable answer: retrying gets the same
   * response until the client reconnects under a different credential.
   */
  function isStableWorkspaceListFailure(error: unknown): boolean {
    if (isForbiddenErrorResponse(error)) return true;
    return error instanceof Error && error.message === FORBIDDEN_ERROR_MESSAGE;
  }

  /**
   * Until the list has loaded for the active backend, a failed `workspace.list`
   * is retried with bounded backoff from inside the single-flight worker, so
   * the trailing-coalesce guarantee holds and reads never fan out. A
   * `backendReconnected` during the wait ends the loop early: the reconnect
   * watcher re-puts `loadWorkspacesRequested`, which either queues as this
   * worker's trailing rerun or starts a fresh one — one immediate read either
   * way. Once loaded, a later failure is logged only.
   */
  function* loadWorkspacesWorker() {
    for (let attempt = 0; ; attempt++) {
      try {
        yield* refreshWorkspaces();
        return;
      } catch (error) {
        const backendId = yield* backendIdEffect();
        const loaded = yield* listLoadedEffect(backendId);
        if (loaded || isStableWorkspaceListFailure(error)) {
          logger.error('Refresh failed for workspaces', error);
          return;
        }
        const delayMs = WORKSPACE_LIST_RETRY_DELAYS_MS[attempt] ?? WORKSPACE_LIST_RETRY_CAP_MS;
        logger.warn('Refresh failed for workspaces; retrying', { attempt, delayMs, error });
        const { reconnected } = yield* race({
          timeout: delay(delayMs),
          reconnected: take(backendReconnected),
        });
        if (reconnected) return;
      }
    }
  }

  return function* workspaceAuthoritySaga() {
    yield* takeSingleFlightInContext(
      loadWorkspacesRequested,
      () => 'workspaces',
      loadWorkspacesWorker,
    );
  };
}
