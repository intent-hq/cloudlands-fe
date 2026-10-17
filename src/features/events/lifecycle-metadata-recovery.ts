import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  rendererEventRecovery,
  type RendererRecoveryHandle,
  type RendererRecoveryScope,
} from './renderer-event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { Workspace } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import type { ContextItem } from '$features/context/types';
import { parseTokenUsage } from '$features/token-usage/token-usage-schema';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import {
  addContextItem,
  removeContextItem,
  updateContextItem,
  hydrateContextItems,
} from '$store/renderer/slices/context/context-slice';
import {
  clearWorkspaceTokenUsage,
  tokenUsageFetchFailed,
  tokenUsageReceived,
} from '$store/renderer/slices/token-usage/token-usage-slice';
import {
  addTaskAgentAssociation,
  removeTaskAgentAssociation,
  pruneTaskAgentAssociationsForNote,
  hydrateTaskAgentAssociations,
} from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import type { TaskAgentAssociationsByTaskKey } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';

export const contextRecoveryKey = (workspaceId: string) =>
  `context:${JSON.stringify([workspaceId])}`;
export const tokenUsageRecoveryKey = (workspaceId: string) =>
  `token-usage:${JSON.stringify([workspaceId])}`;
export const taskAgentLinksRecoveryKey = (workspaceId: string) =>
  `task-agent-links:${JSON.stringify([workspaceId])}`;
type MetadataDomain = 'context' | 'tokenUsage' | 'taskAgentLinks';
const domains: MetadataDomain[] = ['context', 'tokenUsage', 'taskAgentLinks'];
const demands = new Set<{ workspaceId: string; domain: MetadataDomain }>();
const demandListeners = new Set<() => void>();

/** A background consumer also retains any recovery its demand admits through settlement. */
export function acquireLifecycleMetadataDemand(
  workspaceId: string,
  domain: MetadataDomain,
): () => void {
  const demand = { workspaceId, domain };
  demands.add(demand);
  for (const listener of demandListeners) listener();
  const key = {
    context: contextRecoveryKey,
    tokenUsage: tokenUsageRecoveryKey,
    taskAgentLinks: taskAgentLinksRecoveryKey,
  }[domain](workspaceId);
  const handle = mutationOwners.get(key)?.handle;
  let released = false;
  const remove = () => {
    if (!demands.delete(demand)) return;
    for (const listener of demandListeners) listener();
  };
  return () => {
    if (released) return;
    released = true;
    // A stale ordinary receipt cannot commit, but its recovery still needs demand
    // through the final fence. Keep the original handle across authority changes.
    if (handle && (handle.status.stale || handle.status.running))
      void handle.whenSettled().then(remove);
    else remove();
  };
}

/** Local commands only: snapshots and daemon echoes must never replay a mutation. */
export function lifecycleMetadataMutationKey(action: object): string | undefined {
  const { type, payload } = action as { type?: unknown; payload?: unknown };
  if (!Array.isArray(payload) || typeof payload[0] !== 'string' || !payload[0]) return;
  if (
    [addContextItem.type, removeContextItem.type, updateContextItem.type].includes(type as string)
  )
    return contextRecoveryKey(payload[0]);
  if (
    [
      addTaskAgentAssociation.type,
      removeTaskAgentAssociation.type,
      pruneTaskAgentAssociationsForNote.type,
    ].includes(type as string)
  )
    return taskAgentLinksRecoveryKey(payload[0]);
}
export interface LifecycleMetadataMutation {
  readonly key: string;
  /** Reserve buffered child work before releasing its parent action. */
  retain(): () => void;
  /** Release action processing; already-sent requests retain their own barrier. */
  finish(): void;
  run<T>(mutate: () => Promise<T>): Promise<T>;
}
interface MutationOwner {
  generation: object;
  physicalIdentity: object;
  retire(error: unknown): boolean;
  isCurrent(): boolean;
  handle: RendererRecoveryHandle;
}
interface PendingMutation {
  physicalIdentity: object;
  owner: MutationOwner | undefined;
  drained: Promise<void>;
  cancel(): void;
}
const mutationOwners = new Map<string, MutationOwner>();
const pendingMutations = new Map<string, Set<PendingMutation>>();
const actionMutations = new WeakMap<object, LifecycleMetadataMutation>();

export function getLifecycleMetadataMutation(
  action: object,
): LifecycleMetadataMutation | undefined {
  return actionMutations.get(action);
}

/** Call at command ingress before reducers, then finish in the command saga's finally. */
export function beginLifecycleMetadataMutation(
  action: object,
): LifecycleMetadataMutation | undefined {
  const existing = actionMutations.get(action);
  if (existing) return existing;
  const key = lifecycleMetadataMutationKey(action);
  if (!key) return;
  const owner = mutationOwners.get(key);
  const reservations = new Set<object>();
  let ingress = true,
    physical = 0,
    cancelled = false,
    done = false;
  let resolve!: () => void;
  const drained = new Promise<void>((r) => {
    resolve = r;
  });
  let pending = pendingMutations.get(key);
  if (!pending) {
    pending = new Set();
    pendingMutations.set(key, pending);
  }
  const owned = pending;
  const current = () =>
    !cancelled && !done && mutationOwners.get(key) === owner && (!owner || owner.isCurrent());
  const settle = () => {
    if (done || ingress || physical || reservations.size) return;
    done = true;
    owned.delete(entry);
    if (!owned.size && pendingMutations.get(key) === owned) pendingMutations.delete(key);
    // Ingress already invalidated older reads. Recovery waits on this barrier
    // before sending, so settlement must not invalidate that waiting snapshot again.
    resolve();
  };
  const entry: PendingMutation = {
    physicalIdentity:
      owner?.physicalIdentity ?? rendererEventRecovery.capturePhysicalSessionIdentity(),
    owner,
    drained,
    cancel: () => {
      cancelled = true;
      ingress = false;
      reservations.clear();
      settle();
    },
  };
  pending.add(entry);
  const lease: LifecycleMetadataMutation = {
    key,
    retain: () => {
      if (!current()) return () => {};
      const token = {};
      reservations.add(token);
      return () => {
        reservations.delete(token);
        settle();
      };
    },
    finish: () => {
      ingress = false;
      settle();
    },
    run: <T>(mutate: () => Promise<T>): Promise<T> => {
      if (!current())
        return Promise.reject(new Error('Lifecycle metadata mutation authority expired'));
      physical++;
      let result: Promise<T>;
      try {
        result = mutate();
      } catch (error) {
        result = Promise.reject(error);
      }
      return result.then(
        (value) => {
          const authorized = current();
          physical--;
          settle();
          if (!authorized) throw new Error('Lifecycle metadata mutation authority expired');
          return value;
        },
        (error) => {
          // The caller deadline does not release an already-sent mutation.
          // Task-link errors can concern the referenced agent or note instead of
          // the target workspace; only its authoritative read may retire that owner.
          void drainMetadataFailure(key, owner, error, !key.startsWith('task-agent-links:')).then(
            () => {
              physical--;
              settle();
            },
          );
          throw error;
        },
      );
    },
  };
  actionMutations.set(action, lease);
  return lease;
}
function retireMutations(key: string, generation: object): void {
  for (const pending of pendingMutations.get(key) ?? [])
    if (pending.owner?.generation === generation) pending.cancel();
  if (mutationOwners.get(key)?.generation === generation) mutationOwners.delete(key);
}
async function waitForMutations(key: string, physicalIdentity: object): Promise<void> {
  for (;;) {
    const pending = [...(pendingMutations.get(key) ?? [])].filter(
      (mutation) => mutation.physicalIdentity === physicalIdentity,
    );
    if (!pending.length) return;
    await Promise.all(pending.map((mutation) => mutation.drained));
  }
}

interface MetadataStore {
  getState(): StoreState;
  dispatch(action: { type: string; payload?: unknown }): unknown;
  subscribe(listener: () => void): () => void;
}
interface PendingRead {
  receipt: RecoveryLifetime;
  result: Promise<unknown>;
}
interface ReadLane {
  tail?: Promise<unknown>;
  ordinary?: PendingRead;
}
const sessions = new WeakMap<object, Map<string, ReadLane>>();

async function drainMetadataFailure(
  key: string,
  owner: MutationOwner | undefined,
  error: unknown,
  workspaceAuthority = true,
): Promise<void> {
  const observe = (failure: unknown) => {
    const e = failure as { rpcCode?: number; data?: { code?: string } } | undefined;
    if (
      workspaceAuthority &&
      owner &&
      mutationOwners.get(key) === owner &&
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

/** A lease change invalidates its result, but cannot erase a physical read still in flight. */
function readInLane<T>(
  key: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
  recovery: boolean,
): Promise<T> {
  if (!(recovery ? receipt.isCurrent() : receipt.commit(() => undefined)))
    return Promise.reject(new Error('Lifecycle metadata read authority expired'));
  const owner = mutationOwners.get(key);
  const physicalIdentity =
    owner?.physicalIdentity ?? rendererEventRecovery.capturePhysicalSessionIdentity();
  const lanes = sessions.get(physicalIdentity) ?? new Map<string, ReadLane>();
  sessions.set(physicalIdentity, lanes);
  let lane = lanes.get(key);
  if (!lane) {
    lane = {};
    lanes.set(key, lane);
  }
  const owned = lane;
  if (!recovery && owned.ordinary?.receipt.commit(() => undefined))
    return owned.ordinary.result as Promise<T>;
  const start = (): Promise<T> => {
    if (
      [...(pendingMutations.get(key) ?? [])].some(
        (mutation) => mutation.physicalIdentity === physicalIdentity,
      )
    )
      return waitForMutations(key, physicalIdentity).then(start);
    if (!(recovery ? receipt.isCurrent() : receipt.commit(() => undefined)))
      return Promise.reject(new Error('Lifecycle metadata read authority expired'));
    try {
      return read();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const result = owned.tail ? owned.tail.then(start, start) : start();
  const drained = result.then(
    () => undefined,
    (error) => drainMetadataFailure(key, owner, error),
  );
  owned.tail = drained;
  if (!recovery) owned.ordinary = { receipt, result };
  const finish = () => {
    if (owned.ordinary?.result === result) owned.ordinary = undefined;
  };
  void result.then(finish, finish);
  void drained.then(() => {
    if (owned.tail === drained && lanes.get(key) === owned) lanes.delete(key);
  });
  return result;
}

/** Capture before calling this thunk; commit the result with that same receipt. */
export function runLifecycleMetadataRead<T>(
  key: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
): Promise<T> {
  return readInLane(key, receipt, read, false);
}

function contextItems(raw: unknown): ContextItem[] {
  if (!Array.isArray(raw)) throw new Error('Invalid recovered context');
  return raw.filter(
    (item): item is ContextItem =>
      !!item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      !!item.id &&
      typeof item.type === 'string' &&
      !!item.type,
  );
}
function agentLinks(raw: unknown): Record<string, TaskAgentAssociationsByTaskKey> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid recovered task links');
  const result: Record<string, TaskAgentAssociationsByTaskKey> = {};
  for (const [noteId, rows] of Object.entries(raw)) {
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) continue;
    const links: TaskAgentAssociationsByTaskKey = {};
    for (const [key, row] of Object.entries(rows)) {
      if (!row || typeof row !== 'object') continue;
      const { noteId, taskKey, taskText, agentId, createdAt } = row as Record<string, unknown>;
      if (
        typeof noteId !== 'string' ||
        typeof taskKey !== 'string' ||
        typeof taskText !== 'string' ||
        typeof agentId !== 'string' ||
        typeof createdAt !== 'number'
      )
        continue;
      links[key] = { noteId, taskKey, taskText, agentId, createdAt };
    }
    if (Object.keys(links).length) result[noteId] = links;
  }
  return result;
}

/** One owner per projection, installed before ordinary lifecycle hydration starts. */
export function installLifecycleMetadataRecovery(
  scope: RendererRecoveryScope,
  store: MetadataStore,
  registry: Pick<
    typeof rendererEventRecovery,
    'captureRetirement' | 'capturePhysicalSessionIdentity'
  > = rendererEventRecovery,
): () => void {
  const context = getPrincipalActionContext(store.getState());
  const physicalIdentity = registry.capturePhysicalSessionIdentity();
  const owners = new Map<string, RendererRecoveryHandle[]>();
  const capturedDemands = new Set<{ workspaceId: string; domain: MetadataDomain }>();
  let disposed = false,
    syncing = false,
    retired = false;
  const authority = () =>
    !disposed &&
    !retired &&
    scope.isCurrent() &&
    context !== null &&
    getPrincipalActionContext(store.getState()) === context;
  const workspaceCurrent = (workspaceId: string) => {
    const state = store.getState();
    return (
      authority() &&
      state.workspace.capabilityContext === context &&
      !!getItem(state.workspace.workspaces, workspaceId as Workspace['id'])
    );
  };
  const sync = () => {
    if (disposed || syncing) return;
    syncing = true;
    try {
      if (!authority()) {
        retired = true;
        for (const handles of owners.values())
          for (const handle of handles) handle.captureLifetime().isCurrent();
        return;
      }
      for (const demand of demands) capturedDemands.add(demand);
      const state = store.getState();
      const mounted = new Set(
        Object.entries(state.workspaceLifecycle.sessionPhaseByWorkspaceId)
          .filter(([, phase]) => phase === 'live' || phase === 'hydrated')
          .map(([id]) => id),
      );
      const active = (workspaceId: string, domain: MetadataDomain) =>
        mounted.has(workspaceId) ||
        [...demands].some((d) => d.workspaceId === workspaceId && d.domain === domain);
      const workspaces = new Set([
        ...[...demands].map((d) => d.workspaceId),
        ...mounted,
        ...Object.keys(state.context.byWorkspaceId),
        ...Object.keys(state.tokenUsage.byWorkspaceId),
        ...Object.keys(state.taskAgentAssociations.byWorkspaceId),
      ]);
      for (const [workspaceId, handles] of owners) {
        if (!workspaceCurrent(workspaceId)) {
          for (const handle of handles) handle.captureLifetime().isCurrent();
          owners.delete(workspaceId);
          continue;
        }
        handles.forEach((handle, index) => handle.setActive(active(workspaceId, domains[index])));
      }
      for (const workspaceId of workspaces) {
        if (owners.has(workspaceId) || !workspaceCurrent(workspaceId)) continue;
        const common = {
          workspaceId,
          active: mounted.has(workspaceId),
          isCurrent: () => workspaceCurrent(workspaceId),
        };
        const contextKey = contextRecoveryKey(workspaceId),
          tokenKey = tokenUsageRecoveryKey(workspaceId),
          linksKey = taskAgentLinksRecoveryKey(workspaceId);
        const generation = {};
        const handles = [
          scope.registerResource({
            ...common,
            key: contextKey,
            active: active(workspaceId, 'context'),
            eventTypes: ['workspace:context-changed'],
            read: (reader) =>
              readInLane(
                contextKey,
                reader.lifetime,
                async () => {
                  const result = await reader.request<{ items: unknown }>('workspace.getContext', {
                    workspaceId,
                  });
                  return contextItems(result.items);
                },
                true,
              ),
            apply: (items) => {
              store.dispatch(hydrateContextItems(workspaceId, items));
            },
            invalidate: () => {},
            retire: () => {
              retireMutations(contextKey, generation);
              store.dispatch(hydrateContextItems(workspaceId, []));
            },
          }),
          scope.registerResource({
            ...common,
            key: tokenKey,
            active: active(workspaceId, 'tokenUsage'),
            eventTypes: ['workspace:tokenUsage-changed'],
            read: (reader) =>
              readInLane(
                tokenKey,
                reader.lifetime,
                async () => {
                  const result = await reader.request<{ tokenUsage: unknown }>(
                    'workspace.getTokenUsage',
                    { workspaceId },
                  );
                  return parseTokenUsage(result.tokenUsage);
                },
                true,
              ),
            apply: (value) => {
              store.dispatch(tokenUsageReceived(workspaceId, value));
            },
            invalidate: () => {
              store.dispatch(tokenUsageFetchFailed(workspaceId));
            },
            retire: () => {
              retireMutations(tokenKey, generation);
              store.dispatch(clearWorkspaceTokenUsage(workspaceId));
            },
          }),
          scope.registerResource({
            ...common,
            key: linksKey,
            active: active(workspaceId, 'taskAgentLinks'),
            eventTypes: [
              'task:agent-linked',
              'task:agent-unlinked',
              'note:deleted',
              'agent:deleted',
            ],
            read: (reader) =>
              readInLane(
                linksKey,
                reader.lifetime,
                async () => {
                  const result = await reader.request<{ linksByNoteId: unknown }>(
                    'task.listAgentLinks',
                    { workspaceId },
                  );
                  return agentLinks(result.linksByNoteId);
                },
                true,
              ),
            apply: (value) => {
              store.dispatch(hydrateTaskAgentAssociations(workspaceId, value));
            },
            invalidate: () => {},
            retire: () => {
              retireMutations(linksKey, generation);
              store.dispatch(hydrateTaskAgentAssociations(workspaceId, {}));
            },
          }),
        ];
        [contextKey, tokenKey, linksKey].forEach((key, index) => {
          mutationOwners.set(key, {
            generation,
            physicalIdentity,
            handle: handles[index],
            isCurrent: common.isCurrent,
            retire: registry.captureRetirement(key),
          });
        });
        owners.set(workspaceId, handles);
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
    for (const [workspaceId, handles] of owners) {
      for (const key of [
        contextRecoveryKey(workspaceId),
        tokenUsageRecoveryKey(workspaceId),
        taskAgentLinksRecoveryKey(workspaceId),
      ]) {
        const owner = mutationOwners.get(key);
        if (owner && handles.includes(owner.handle)) retireMutations(key, owner.generation);
      }
      for (const handle of handles) handle.dispose();
      store.dispatch(hydrateContextItems(workspaceId, []));
      store.dispatch(clearWorkspaceTokenUsage(workspaceId));
      store.dispatch(hydrateTaskAgentAssociations(workspaceId, {}));
    }
    owners.clear();
  };
}
