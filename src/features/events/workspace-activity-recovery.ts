import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import {
  getPhysicalRequestCompletion,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import type { StoreState } from '$store/renderer/types';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import {
  eventsCleared,
  eventsLoaded,
  olderEventsLoaded,
} from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { sanitizeWorkspaceEventsList } from '$store/renderer/slices/workspace-events/workspace-events-sanitizer';
import type { EventQueryPage } from '$lib/client/app-client';
import {
  rendererEventRecovery,
  type RendererRecoveryHandle,
  type RendererRecoveryScope,
} from './renderer-event-recovery';
import type { RecoveryReader } from './event-recovery-coordinator';

export const workspaceActivityRecoveryKey = (workspaceId: string) =>
  `workspace-activity:${JSON.stringify([workspaceId])}`;
const PAGE_SIZE = 100;
const demands = new Set<{ workspaceId: string }>();
const demandListeners = new Set<() => void>();
const sessions = new WeakMap<object, Map<string, Promise<void>>>();
interface ActivityOwner {
  handle: RendererRecoveryHandle;
  physicalIdentity: object;
  isCurrent(): boolean;
  retire(error: unknown): boolean;
}
const readOwners = new Map<string, ActivityOwner>();

async function drainActivityFailure(
  key: string,
  owner: ActivityOwner | undefined,
  error: unknown,
): Promise<void> {
  const observe = (failure: unknown) => {
    const e = failure as { rpcCode?: number; data?: { code?: string } } | undefined;
    if (
      owner &&
      readOwners.get(key) === owner &&
      owner.isCurrent() &&
      (e?.rpcCode === -32003 ||
        e?.rpcCode === -32001 ||
        (e?.rpcCode === -32602 && e.data?.code === 'not-found'))
    )
      owner.retire(failure);
  };
  observe(error);
  const completion = await getPhysicalRequestCompletion(error);
  if (completion && !completion.retired) for (const failure of completion.errors) observe(failure);
}

// These publishers use intentd's broadcast-only path, never event.query.
// Keep wildcard loss coverage; only omit known transient *pushes*. Unknown
// families, persisted stream status/end, and agent-attributed files stay covered.
const transientTypes = new Set([
  'chat:stream:delta',
  'agent:stream:activity',
  'terminal:data',
  'script:output',
  'presence:changed',
  'note:presence',
  'line-attribution:updated',
  'note:delete-operation',
  'client:updated',
  'host:exec:stdout',
  'host:exec:stderr',
]);
function acceptsDurableEvent(notification: RecoveryNotification): boolean {
  const event = (
    notification.params as { event?: { type?: string; actor?: { type?: string } } } | undefined
  )?.event;
  if (!event?.type || transientTypes.has(event.type)) return false;
  return !(event.type.startsWith('file:') && event.actor?.type && event.actor.type !== 'agent');
}

/** A page read retains any admitted recovery until its original resource settles. */
export function acquireWorkspaceActivityDemand(workspaceId: string): () => void {
  const demand = { workspaceId };
  demands.add(demand);
  for (const listener of demandListeners) listener();
  const handle = readOwners.get(workspaceActivityRecoveryKey(workspaceId))?.handle;
  let released = false;
  const remove = () => {
    if (!demands.delete(demand)) return;
    for (const listener of demandListeners) listener();
  };
  return () => {
    if (released) return;
    released = true;
    if (handle && (handle.status.stale || handle.status.running))
      void handle.whenSettled().then(remove);
    else remove();
  };
}

function inReadLane<T>(
  key: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
  recovery = false,
): Promise<T> {
  const current = () => (recovery ? receipt.isCurrent() : receipt.commit(() => undefined));
  if (!current()) return Promise.reject(new Error('Activity read authority expired'));
  const start = () => {
    if (!current()) throw new Error('Activity read authority expired');
    return read();
  };
  const owner = readOwners.get(key);
  const identity =
    owner?.physicalIdentity ?? rendererEventRecovery.capturePhysicalSessionIdentity();
  const lanes = sessions.get(identity) ?? new Map<string, Promise<void>>();
  sessions.set(identity, lanes);
  // Cursors distinguish requests. Never coalesce a newest-page read with an older page.
  const preceding = lanes.get(key);
  let result: Promise<T>;
  try {
    result = preceding ? preceding.then(start) : start();
  } catch (error) {
    result = Promise.reject(error);
  }
  const drained = result.then(
    () => undefined,
    (error) => drainActivityFailure(key, owner, error),
  );
  lanes.set(key, drained);
  void drained.then(() => {
    if (lanes.get(key) === drained) lanes.delete(key);
  });
  return result;
}

/** The caller captures before enqueue and commits all page state with that same receipt. */
export function runWorkspaceActivityRead<T>(
  key: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
): Promise<T> {
  return inReadLane(key, receipt, read);
}

interface ActivityStore {
  getState(): StoreState;
  dispatch(action: { type: string; payload?: unknown }): unknown;
  subscribe(listener: () => void): () => void;
}
interface ActivitySnapshot extends EventQueryPage {
  expanded: boolean;
}
async function readWindow(
  reader: RecoveryReader,
  workspaceId: string,
  size: number,
  expanded: boolean,
): Promise<ActivitySnapshot> {
  const items: EventQueryPage['items'] = [];
  const ids = new Set<string>(),
    cursors = new Set<string>();
  let nextToken: string | null = null;
  // Offset pages expose no source revision. Rebuild the loaded depth under one
  // begin/end fence; a concurrent admitted event invalidates the whole snapshot.
  const pageBudget = Math.ceil(size / PAGE_SIZE);
  for (let pageIndex = 0; pageIndex < pageBudget; pageIndex++) {
    const limit = Math.min(PAGE_SIZE, size - pageIndex * PAGE_SIZE);
    const page: EventQueryPage = await reader.request<EventQueryPage>('event.query', {
      workspaceId,
      paginate: true,
      limit,
      ...(nextToken === null ? {} : { nextToken }),
    });
    if (
      !page ||
      !Array.isArray(page.items) ||
      !(page.nextToken === null || typeof page.nextToken === 'string')
    )
      throw new Error('Invalid activity page');
    const safe = sanitizeWorkspaceEventsList(page.items, workspaceId);
    if (safe.length !== page.items.length) throw new Error('Invalid activity rows');
    for (const item of safe)
      if (!ids.has(item.id)) {
        ids.add(item.id);
        items.push(item);
      }
    nextToken = page.nextToken;
    if (nextToken === null) break;
    if (!nextToken || cursors.has(nextToken)) throw new Error('Repeated activity cursor');
    cursors.add(nextToken);
  }
  return { items: items.reverse(), nextToken, expanded };
}

/** Durable event.query history only; snapshots never replay live-event side effects. */
export function installWorkspaceActivityRecovery(
  scope: RendererRecoveryScope,
  store: ActivityStore,
  registry: Pick<
    typeof rendererEventRecovery,
    'captureRetirement' | 'capturePhysicalSessionIdentity'
  > = rendererEventRecovery,
): () => void {
  const context = getPrincipalActionContext(store.getState());
  const physicalIdentity = registry.capturePhysicalSessionIdentity();
  const bound = new Map<string, ActivityOwner>();
  const owners = new Map<string, RendererRecoveryHandle>();
  const capturedDemands = new Set<{ workspaceId: string }>();
  let disposed = false,
    retired = false,
    syncing = false;
  const authority = () =>
    !disposed &&
    !retired &&
    scope.isCurrent() &&
    context !== null &&
    getPrincipalActionContext(store.getState()) === context;
  const workspaceCurrent = (workspaceId: string) =>
    authority() &&
    store.getState().workspace.capabilityContext === context &&
    !!getItem(store.getState().workspace.workspaces, workspaceId as Workspace['id']);
  const sync = () => {
    if (disposed || syncing) return;
    syncing = true;
    try {
      if (!authority()) {
        retired = true;
        for (const handle of owners.values()) handle.captureLifetime().isCurrent();
        return;
      }
      for (const demand of demands) capturedDemands.add(demand);
      const state = store.getState();
      const mounted = new Set(
        Object.entries(state.workspaceLifecycle.sessionPhaseByWorkspaceId)
          .filter(([, phase]) => phase === 'live' || phase === 'hydrated')
          .map(([id]) => id),
      );
      const active = (id: string) =>
        mounted.has(id) || [...demands].some((d) => d.workspaceId === id);
      const workspaces = new Set([
        ...mounted,
        ...Object.keys(state.workspaceEvents.byWorkspaceId),
        ...[...demands].map((d) => d.workspaceId),
      ]);
      for (const [id, handle] of owners) {
        if (!workspaceCurrent(id)) {
          handle.captureLifetime().isCurrent();
          owners.delete(id);
          continue;
        }
        handle.setActive(active(id));
      }
      for (const workspaceId of workspaces) {
        if (owners.has(workspaceId) || !workspaceCurrent(workspaceId)) continue;
        const key = workspaceActivityRecoveryKey(workspaceId);
        const retire = (): undefined => {
          if (readOwners.get(key) === bound.get(key)) readOwners.delete(key);
          store.dispatch(eventsCleared(workspaceId));
        };
        const handle = scope.registerResource<ActivitySnapshot>({
          key,
          workspaceId,
          eventTypes: ['*'],
          acceptsEvent: acceptsDurableEvent,
          active: active(workspaceId),
          isCurrent: () => workspaceCurrent(workspaceId),
          read: (reader) =>
            inReadLane(
              key,
              reader.lifetime,
              () => {
                const state = store.getState().workspaceEvents.byWorkspaceId[workspaceId];
                return readWindow(
                  reader,
                  workspaceId,
                  Math.max(PAGE_SIZE, state?.events.length ?? 0),
                  state?.historyExpanded ?? false,
                );
              },
              true,
            ),
          apply: (snapshot) => {
            // Drop obsolete pending-live bookkeeping from a superseded ordinary read.
            store.dispatch(eventsCleared(workspaceId));
            store.dispatch(eventsLoaded(workspaceId, snapshot.items, snapshot.nextToken));
            if (snapshot.expanded)
              store.dispatch(olderEventsLoaded(workspaceId, [], snapshot.nextToken));
          },
          invalidate: () => {},
          retire,
        });
        const owner: ActivityOwner = {
          handle,
          physicalIdentity,
          isCurrent: () => workspaceCurrent(workspaceId),
          retire: registry.captureRetirement(key),
        };
        readOwners.set(key, owner);
        bound.set(key, owner);
        owners.set(workspaceId, handle);
      }
    } finally {
      syncing = false;
    }
  };
  demandListeners.add(sync);
  const off = store.subscribe(sync);
  sync();
  return () => {
    disposed = true;
    off();
    demandListeners.delete(sync);
    for (const demand of capturedDemands) demands.delete(demand);
    for (const [id, handle] of owners) {
      handle.dispose();
      store.dispatch(eventsCleared(id));
    }
    owners.clear();
    for (const [key, owner] of bound) if (readOwners.get(key) === owner) readOwners.delete(key);
    bound.clear();
  };
}
