import { eventChannel, buffers } from 'redux-saga';
import { createChannelFromSelector } from '@themislib/themis/saga';
import { call, fork, put, race, take, takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { backendRequest, onBackendReconnected } from '$lib/client/live/backend-transport';
import { getProviderAuthVerdicts } from '$features/providers/provider-auth-status.client';
import { createLogger } from '$lib/utils/client-logger';
import { takeSingleFlightInContext } from '../../utils/context-saga-effects';
import { selectMountedWorkspaceIds } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import {
  workspaceMounted,
  workspaceUnmounted,
  workspaceDeleted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  workspaceCatalogRequested,
  workspaceCatalogReadStarted,
  workspaceCatalogReadFailed,
  ensureWorkspaceCatalogRequested,
  workspaceCatalogReceived,
  workspaceCatalogInvalidated,
  workspaceCatalogUpdated,
  workspaceCatalogEventReceived,
} from './provider-catalog-slice';
import {
  selectWorkspaceCatalogEpoch,
  selectWorkspaceCatalog,
  selectWorkspaceCatalogIds,
  selectSettledProviderReadiness,
  selectWorkspaceCatalogFresh,
} from './workspace-catalog-selectors';
import type {
  WorkspaceCatalogResource,
  WorkspaceCatalogSnapshot,
  WorkspaceCatalogUpdate,
} from './provider-catalog-types';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { applyWorkspaceCatalogUpdate } from './workspace-catalog-updates';
import { selectProviderStatusMap } from '../agent-availability/agent-availability-selectors';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import { copyServerForState, mapDaemonMcpState } from '../mcp-settings/mcp-settings-normalization';
import {
  setWorkspaceDisabledMcpServers,
  setWorkspaceMcpServerDisabled,
} from '../mcp-settings/mcp-settings-slice';
import { getMcpServerKey } from '$lib/components/settings/mcp/types';

const logger = createLogger('WorkspaceCatalog');
const ALL_RESOURCES: WorkspaceCatalogResource[] = [
  'catalog',
  'settings',
  'specialists',
  'readiness',
  'mcp',
];
type Reads = {
  queued: Map<string, Set<WorkspaceCatalogResource>>;
  pending: Map<string, WorkspaceCatalogUpdate[]>;
};
type CatalogAction =
  | ReturnType<typeof workspaceCatalogRequested>
  | ReturnType<typeof workspaceUnmounted>
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof removeWorkspaceEntity>;

function* publishDisabled(workspaceId: string, snapshot: WorkspaceCatalogSnapshot) {
  yield* put(
    setWorkspaceDisabledMcpServers(
      workspaceId,
      Object.fromEntries(
        (snapshot.mcpServers ?? []).flatMap((server) =>
          server.workspaceDisabled ? [[getMcpServerKey(server), true as const]] : [],
        ),
      ),
    ),
  );
}

function* readCatalog(reads: Reads, action: CatalogAction) {
  if (action.type !== workspaceCatalogRequested.type) return;
  const [workspaceId] = action.payload;
  const epoch = yield* selectWorkspaceCatalogEpoch.effect();
  const previous = yield* selectWorkspaceCatalog.effect(workspaceId);
  const resources = previous
    ? (reads.queued.get(workspaceId) ?? new Set(ALL_RESOURCES))
    : new Set(ALL_RESOURCES);
  reads.queued.delete(workspaceId);
  const updates: WorkspaceCatalogUpdate[] = [];
  reads.pending.set(workspaceId, updates);
  let active = true;
  try {
    yield* put(workspaceCatalogReadStarted(workspaceId));
    const { patch } = yield* race({
      invalidated: take([workspaceCatalogInvalidated, hostExecutionConnectionChanged]),
      patch: call(async (): Promise<Partial<WorkspaceCatalogSnapshot>> => {
        const result: Partial<WorkspaceCatalogSnapshot> = {};
        await Promise.all([
          resources.has('catalog') &&
            appClient.providers.catalog(workspaceId).then((catalog) => {
              result.catalog = catalog;
            }),
          resources.has('settings') &&
            appClient.settings.list(workspaceId).then((settings) => {
              result.settings = settings;
            }),
          resources.has('specialists') &&
            (appClient.specialists.listCatalog
              ? appClient.specialists.listCatalog(undefined, workspaceId, { includeProject: true })
              : appClient.specialists
                  .list(undefined, workspaceId)
                  .then((specialists) => ({ specialists, importDiagnostics: undefined }))
            ).then(({ specialists, importDiagnostics }) => {
              result.specialists = specialists;
              result.importDiagnostics = importDiagnostics;
            }),
          resources.has('readiness') &&
            Promise.all([
              backendRequest<{
                providers: Array<{
                  id: string;
                  installed: boolean;
                  gatedOff?: string | null;
                  hasNpxFallback?: boolean;
                }>;
              }>('host.providerDiscovery', { workspaceId }),
              getProviderAuthVerdicts({ workspaceId }),
            ]).then(([discovery, auth]) => {
              result.readiness = Object.fromEntries(
                discovery.providers.map((p) => [
                  p.id,
                  {
                    available: p.installed && !p.gatedOff,
                    ...auth[p.id],
                    hasNpxFallback: p.hasNpxFallback,
                  },
                ]),
              );
            }),
          resources.has('mcp') &&
            appClient.settings.getMcpServers(workspaceId).then(async (servers) => {
              if (!active) return;
              result.mcpServers = servers.map(copyServerForState);
              const known = new Set([
                ...(resources.has('catalog') ? [] : (previous?.mcpStatuses ?? [])).map(
                  (status) => status.serverId,
                ),
                ...updates.flatMap((update) =>
                  update.kind === 'status' ? [update.status.serverId] : [],
                ),
              ]);
              const ids = servers.flatMap((server) =>
                server.id && !known.has(server.id) ? [server.id] : [],
              );
              const statuses = ids.length
                ? await appClient.settings.getMcpServerStatuses(ids, workspaceId)
                : [];
              result.mcpStatuses = [
                ...(previous?.mcpStatuses ?? []).filter(
                  (status) =>
                    servers.some((server) => server.id === status.serverId) &&
                    !statuses.some((fresh) => fresh.serverId === status.serverId),
                ),
                ...statuses,
              ];
            }),
        ]);
        return result;
      }),
    });
    if (!patch) return;
    // A push is newer than every point read already in flight. Replay it even on
    // first hydration, where there was no cached snapshot to update immediately.
    const current = yield* selectWorkspaceCatalog.effect(workspaceId);
    let snapshot = { ...current, ...patch } as WorkspaceCatalogSnapshot;
    for (const update of updates) snapshot = applyWorkspaceCatalogUpdate(snapshot, update);
    yield* put(workspaceCatalogReceived(workspaceId, snapshot, epoch));
    if (epoch === (yield* selectWorkspaceCatalogEpoch.effect()) && resources.has('mcp')) {
      yield* publishDisabled(workspaceId, snapshot);
    }
  } catch (error) {
    const queued = reads.queued.get(workspaceId) ?? new Set<WorkspaceCatalogResource>();
    for (const resource of resources) queued.add(resource);
    reads.queued.set(workspaceId, queued);
    logger.warn('Workspace catalog read failed', { workspaceId, error });
    yield* put(workspaceCatalogReadFailed(workspaceId));
  } finally {
    active = false;
    reads.pending.delete(workspaceId);
  }
}

function* onMount(action: ReturnType<typeof workspaceMounted>) {
  yield* put(ensureWorkspaceCatalogRequested(action.payload[0]));
}
function* ensureCatalog(reads: Reads, action: ReturnType<typeof ensureWorkspaceCatalogRequested>) {
  const [workspaceId] = action.payload;
  if (!workspaceId || reads.pending.has(workspaceId)) return;
  if (yield* selectWorkspaceCatalogFresh.effect(workspaceId)) return;
  yield* put(workspaceCatalogRequested(workspaceId));
}
function* refreshMountedCatalogs(resources?: WorkspaceCatalogResource[]) {
  const mounted = [
    ...new Set([
      ...(yield* selectMountedWorkspaceIds.effect()),
      ...(yield* selectWorkspaceCatalogIds.effect()),
    ]),
  ];
  for (const workspaceId of mounted) yield* put(workspaceCatalogRequested(workspaceId, resources));
}

/** Settings rechecks can observe external CLI installation without a daemon event. */
function* watchProviderReadiness() {
  const channel = yield* createChannelFromSelector(selectSettledProviderReadiness);
  let previous = yield* selectProviderStatusMap.effect();
  try {
    while (true) {
      const { payload } = yield* take(channel);
      if (payload === null || payload === previous) continue;
      previous = payload;
      yield* refreshMountedCatalogs(['readiness']);
    }
  } finally {
    channel.close();
  }
}

function* applyPush(reads: Reads, workspaceId: string, update: WorkspaceCatalogUpdate) {
  reads.pending.get(workspaceId)?.push(update);
  yield* put(workspaceCatalogUpdated(workspaceId, update));
  if (update.kind === 'toggle') {
    const snapshot = yield* selectWorkspaceCatalog.effect(workspaceId);
    if (snapshot) yield* publishDisabled(workspaceId, snapshot);
  }
}

function* onEvent(
  reads: Reads,
  seen: Set<string>,
  action: ReturnType<typeof workspaceCatalogEventReceived>,
) {
  const [event] = action.payload;
  if (event.id) {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 2048) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }
  const data = event.data as Record<string, unknown> | undefined;
  const mounted = [
    ...new Set([
      ...(yield* selectMountedWorkspaceIds.effect()),
      ...(yield* selectWorkspaceCatalogIds.effect()),
      ...reads.pending.keys(),
    ]),
  ];
  const scope =
    event.workspaceId || (typeof data?.workspaceId === 'string' ? data.workspaceId : undefined);
  const targets = scope ? mounted.filter((id) => id === scope) : mounted;
  for (const workspaceId of targets) {
    // WorkspaceEventType covers timeline events; daemon catalog events have additional names.
    switch (event.type as string) {
      case 'settings:changed': {
        const changes = Array.isArray(data?.changes)
          ? data.changes.filter(
              (change): change is AppliedSettingChange =>
                !!change &&
                typeof change === 'object' &&
                typeof change.path === 'string' &&
                'value' in change,
            )
          : [];
        if (!changes.length) {
          // Missing deltas cannot update definitions, but do not invalidate unrelated resources.
          yield* put(workspaceCatalogRequested(workspaceId, ['settings']));
          break;
        }
        const snapshot = yield* selectWorkspaceCatalog.effect(workspaceId);
        yield* applyPush(reads, workspaceId, { kind: 'settings', changes });
        const resources = new Set<WorkspaceCatalogResource>();
        if (
          snapshot &&
          changes.some(
            (change) => !snapshot.settings.some((setting) => setting.path === change.path),
          )
        )
          resources.add('settings');
        // MCP config is an entirely redacted secret in settings pushes (§5.12).
        if (changes.some((change) => change.path === 'mcp.servers')) resources.add('mcp');
        if (changes.some((change) => change.path.startsWith('providers.paths.')))
          resources.add('readiness');
        if (changes.some((change) => change.path === 'specialists.dir'))
          resources.add('specialists');
        if (resources.size) yield* put(workspaceCatalogRequested(workspaceId, [...resources]));
        break;
      }
      case 'providers:profiles-changed':
        // Global (§5.54): the catalog's profile summaries are stale for every workspace.
        yield* put(workspaceCatalogRequested(workspaceId, ['catalog']));
        break;
      case 'specialists:changed':
      case 'skills:changed':
        // Both supported events name the affected workspace, including user-tier changes.
        if (scope) yield* put(workspaceCatalogRequested(workspaceId, ['specialists']));
        break;
      case 'mcp.servers:status-changed': {
        const status = data?.status as { state?: unknown; lastError?: unknown } | undefined;
        if (
          typeof data?.serverId !== 'string' ||
          !status ||
          mapDaemonMcpState(status.state) === null
        )
          break;
        yield* applyPush(reads, workspaceId, {
          kind: 'status',
          status: {
            serverId: data.serverId,
            state: status.state as NonNullable<
              WorkspaceCatalogSnapshot['mcpStatuses']
            >[number]['state'],
            ...(typeof status.lastError === 'string' ? { lastError: status.lastError } : {}),
          },
        });
        break;
      }
      case 'workspace:updated': {
        const changes = data?.changes as
          { mcpServerToggled?: { serverId?: unknown; workspaceDisabled?: unknown } } | undefined;
        const toggle = changes?.mcpServerToggled;
        if (
          scope &&
          typeof toggle?.serverId === 'string' &&
          typeof toggle.workspaceDisabled === 'boolean'
        ) {
          yield* applyPush(reads, workspaceId, {
            kind: 'toggle',
            serverId: toggle.serverId,
            workspaceDisabled: toggle.workspaceDisabled,
          });
        }
        break;
      }
    }
  }
}

function* onConfirmedToggle(
  reads: Reads,
  action: ReturnType<typeof setWorkspaceMcpServerDisabled>,
) {
  const [workspaceId, key, workspaceDisabled] = action.payload;
  const snapshot = yield* selectWorkspaceCatalog.effect(workspaceId);
  const server = snapshot?.mcpServers?.find((entry) => getMcpServerKey(entry) === key);
  if (server?.id)
    yield* applyPush(reads, workspaceId, {
      kind: 'toggle',
      serverId: server.id,
      workspaceDisabled,
    });
}

function* watchReconnects(seen: Set<string>) {
  const channel = eventChannel<true>(
    (emit) => onBackendReconnected(() => emit(true)),
    buffers.sliding(1),
  );
  try {
    while (true) {
      yield* take(channel);
      seen.clear();
      yield* put(workspaceCatalogInvalidated(true));
      yield* refreshMountedCatalogs();
    }
  } finally {
    channel.close();
  }
}

export function* workspaceCatalogSaga() {
  const reads: Reads = { queued: new Map(), pending: new Map() };
  const seen = new Set<string>();
  yield* takeSingleFlightInContext(
    [workspaceCatalogRequested, workspaceUnmounted, workspaceDeleted, removeWorkspaceEntity],
    (action: CatalogAction) => {
      const [workspaceId] = action.payload;
      if (action.type !== workspaceCatalogRequested.type) {
        reads.queued.delete(workspaceId);
        return { context: workspaceId, cancel: true as const };
      }
      const resources = reads.queued.get(workspaceId) ?? new Set<WorkspaceCatalogResource>();
      const [, requested] = (action as ReturnType<typeof workspaceCatalogRequested>).payload;
      for (const resource of requested ?? ALL_RESOURCES) resources.add(resource);
      reads.queued.set(workspaceId, resources);
      return workspaceId;
    },
    readCatalog,
    reads,
  );
  yield* takeEvery(ensureWorkspaceCatalogRequested, ensureCatalog, reads);
  yield* takeEvery(workspaceMounted, onMount);
  yield* takeEvery(hostExecutionConnectionChanged, function* () {
    const mounted = yield* selectMountedWorkspaceIds.effect();
    for (const workspaceId of mounted) yield* put(workspaceCatalogRequested(workspaceId));
  });
  yield* takeEvery(workspaceCatalogEventReceived, onEvent, reads, seen);
  yield* takeEvery(setWorkspaceMcpServerDisabled, onConfirmedToggle, reads);
  yield* fork(watchReconnects, seen);
  yield* fork(watchProviderReadiness);
}
