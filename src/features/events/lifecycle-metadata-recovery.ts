import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { RendererRecoveryHandle, RendererRecoveryScope } from './renderer-event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { Workspace } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import type { ContextItem } from '$features/context/types';
import { parseTokenUsage } from '$features/token-usage/token-usage-schema';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import { hydrateContextItems } from '$store/renderer/slices/context/context-slice';
import {
  clearWorkspaceTokenUsage,
  tokenUsageFetchFailed,
  tokenUsageReceived,
} from '$store/renderer/slices/token-usage/token-usage-slice';
import { hydrateTaskAgentAssociations } from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
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

/** A background consumer owns this demand only until its captured operation finishes. */
export function acquireLifecycleMetadataDemand(
  workspaceId: string,
  domain: MetadataDomain,
): () => void {
  const demand = { workspaceId, domain };
  demands.add(demand);
  for (const listener of demandListeners) listener();
  return () => {
    if (!demands.delete(demand)) return;
    for (const listener of demandListeners) listener();
  };
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
const lanes = new Map<string, ReadLane>();

/** A lease change invalidates its result, but cannot erase a physical read still in flight. */
function readInLane<T>(
  key: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
  recovery: boolean,
): Promise<T> {
  if (!(recovery ? receipt.isCurrent() : receipt.commit(() => undefined)))
    return Promise.reject(new Error('Lifecycle metadata read authority expired'));
  let lane = lanes.get(key);
  if (!lane) {
    lane = {};
    lanes.set(key, lane);
  }
  const owned = lane;
  if (!recovery && owned.ordinary?.receipt.commit(() => undefined))
    return owned.ordinary.result as Promise<T>;
  const start = () => {
    if (!(recovery ? receipt.isCurrent() : receipt.commit(() => undefined)))
      return Promise.reject(new Error('Lifecycle metadata read authority expired'));
    try {
      return read();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const result = owned.tail ? owned.tail.then(start, start) : start();
  owned.tail = result;
  if (!recovery) owned.ordinary = { receipt, result };
  const finish = () => {
    if (owned.ordinary?.result === result) owned.ordinary = undefined;
    if (owned.tail === result && lanes.get(key) === owned) lanes.delete(key);
  };
  void result.then(finish, finish);
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
): () => void {
  const context = getPrincipalActionContext(store.getState());
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
              store.dispatch(hydrateTaskAgentAssociations(workspaceId, {}));
            },
          }),
        ];
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
      for (const handle of handles) handle.dispose();
      store.dispatch(hydrateContextItems(workspaceId, []));
      store.dispatch(clearWorkspaceTokenUsage(workspaceId));
      store.dispatch(hydrateTaskAgentAssociations(workspaceId, {}));
    }
    owners.clear();
  };
}
