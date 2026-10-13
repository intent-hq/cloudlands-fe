import { trackRuntimeRead } from '$features/events/runtime-read-lane';
import {
  rendererEventRecovery,
  type RendererRecoveryScope,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import type { StoreState } from '$store/renderer/types';
import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectMountedWorkspaceIds } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  scriptsRecoveryApplied,
  scriptRecoveryPageRecorded,
  scriptsRecoveryRetired,
} from '$store/renderer/slices/scripts/scripts-slice';
import type { ScriptListPage } from './types';

interface RecoveryStore {
  getState(): StoreState;
  dispatch(action: { type: string }): unknown;
  subscribe(listener: () => void): () => void;
}
let activeStore: RecoveryStore | undefined;
const owners = new Map<string, RendererRecoveryHandle>();
export const scriptsRecoveryKey = (workspaceId: string) =>
  'scripts:' + JSON.stringify([workspaceId]);

function serial<T>(workspaceId: string, read: () => Promise<T>): Promise<T> {
  return trackRuntimeRead(scriptsRecoveryKey(workspaceId), read, true);
}

/** Take a thunk: an already-started request cannot be serialized with recovery. */
export function trackScriptsRecoveryRead<T>(
  workspaceId: string,
  read: () => Promise<T>,
): Promise<T> {
  const lifetime = rendererEventRecovery.capture(scriptsRecoveryKey(workspaceId));
  return serial(workspaceId, () => {
    if (!lifetime.commit(() => {})) throw new Error('Script read superseded');
    return read();
  });
}

/** Called only inside the ordinary read's accepted commit. Never reuse old cursors. */
export function recordScriptsRecoveryPage(workspaceId: string, append: boolean): void {
  activeStore?.dispatch(scriptRecoveryPageRecorded(workspaceId, append));
  const owner = owners.get(workspaceId);
  if (owner?.status.stale) owner.invalidate();
}

/** Current active-list projections only. Output, command drafts and monitors own separate lifetimes. */
export function installScriptsRecovery(
  scope: RendererRecoveryScope,
  store: RecoveryStore,
): () => void {
  activeStore = store;
  const registered = new Map<string, { authority: string; handle: RendererRecoveryHandle }>();
  let disposed = false;
  let syncing = false;
  const sync = () => {
    if (disposed || syncing || !scope.isCurrent()) return;
    syncing = true;
    try {
      const state = store.getState();
      const mounted = new Set(
        state.workspaceLifecycle ? selectMountedWorkspaceIds.select(state) : [],
      );

      for (const [workspaceId, entry] of registered) {
        if (entry.authority !== selectWorkspaceActionContext.select(state, workspaceId)) {
          entry.handle.captureLifetime().isCurrent();
          continue;
        }
        entry.handle.setActive(mounted.has(workspaceId));
      }
      for (const workspaceId of Object.keys(store.getState().scripts.byWorkspaceId)) {
        if (registered.has(workspaceId)) continue;
        const authority = selectWorkspaceActionContext.select(state, workspaceId);
        if (!authority) continue;
        const handle = scope.registerResource({
          key: scriptsRecoveryKey(workspaceId),
          workspaceId,
          eventTypes: ['script:changed', 'script:state', 'script:removed'],
          active: mounted.has(workspaceId),
          isCurrent: () =>
            !disposed &&
            scope.isCurrent() &&
            authority === selectWorkspaceActionContext.select(store.getState(), workspaceId),
          read: (reader) =>
            serial(workspaceId, async () => {
              const rows: ScriptListPage['scripts'] = [];
              let nextCursor: string | undefined;
              const count =
                store.getState().scripts.byWorkspaceId[workspaceId]?.loadedPageCount ?? 1;
              const cursors = new Set<string>();
              for (let page = 0; page < count; page++) {
                const result = await reader.request<ScriptListPage>('script.list', {
                  workspaceId,
                  archive: 'active',
                  view: 'summary',
                  limit: 100,
                  ...(nextCursor ? { cursor: nextCursor } : {}),
                });
                if (result?.view !== 'summary' || !Array.isArray(result.scripts))
                  throw new Error('Invalid script summary page');
                rows.push(
                  ...result.scripts.filter(
                    (row) => row.workspaceId === workspaceId && !row.archivedAt,
                  ),
                );
                nextCursor = result.nextCursor;
                if (!nextCursor) break;
                if (cursors.has(nextCursor)) throw new Error('Repeated script page cursor');
                cursors.add(nextCursor);
              }
              return {
                scripts: [...new Map(rows.map((row) => [row.id, row])).values()],
                nextCursor,
              };
            }),
          apply: (value) => {
            store.dispatch(scriptsRecoveryApplied(workspaceId, value.scripts, value.nextCursor));
          },
          invalidate: () => {},
          retire: () => {
            registered.delete(workspaceId);
            owners.delete(workspaceId);
            store.dispatch(scriptsRecoveryRetired(workspaceId));
          },
        });
        owners.set(workspaceId, handle);
        registered.set(workspaceId, { authority, handle });
      }
    } finally {
      syncing = false;
    }
  };
  const off = store.subscribe(sync);
  sync();
  return () => {
    disposed = true;
    off();
    for (const [id, entry] of registered) {
      entry.handle.dispose();
      if (owners.get(id) === entry.handle) owners.delete(id);
    }
    registered.clear();
    if (activeStore === store) activeStore = undefined;
  };
}
