import {
  updateAgentStats,
  clearAgentLineStats,
  agentLineStatsRequestSucceeded,
} from '$store/renderer/slices/changes/changes-slice';
import type { Metrics } from '$features/line-changes/line-changes.client';
import { trackAgentMetadataRead } from './agent-metadata-read-lane';
export { trackAgentMetadataRead } from './agent-metadata-read-lane';
import type {
  RendererRecoveryScope,
  RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import type { RecoveryReader } from '$features/events/event-recovery-coordinator';
import { normalizeAgent, normalizeAgentListResult } from '$lib/client/live/live-agents-client';
import type { AgentListResult } from '$lib/client/app-client';
import type { AgentSession } from '$shared/types';
import { classifyAgentScope } from '$shared/utils/agent-scope';
import {
  bulkUpsertSessions,
  removeSession,
  setAgentBackgroundPending,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  setAgents,
  setAgentsLoaded,
  setRetiredCount,
  setScopeCounts,
  setDelegatedCounts,
  setOrphanedDelegatedAgentIds,
  setRetiredAgentsLoaded,
  setLazyBinLoaded,
  setDelegatedParentLoaded,
  setOrphanedDelegatedAgentsLoaded,
  setIsLoadingAgents,
  setIsLoadingRetiredAgents,
  setIsLoadingLazyBin,
  setIsLoadingDelegatedParent,
  setIsLoadingOrphanedDelegatedAgents,
  removeWorkspaceAgentState,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { selectMountedWorkspaceIds } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { agentMetadataRecoveryKey } from './agent-recovery-keys';
import {
  isAgentDeletionPending,
  listPendingAgentDeletions,
  removePendingAgentDeletion,
} from './utils/pending-agent-deletions';
import { staleRuntimeFlagClearUpsertOptions } from './utils/stale-runtime-flag-clear';
import { reconcileAgentFailureSnapshot, type AgentRecoveryStore } from './agent-event-recovery';

import {
  agentMetadataDemands as demands,
  agentMetadataDemandListeners as listeners,
  bindAgentMetadataDemandOwner,
} from './agent-metadata-demand';
export { acquireAgentMetadataDemand } from './agent-metadata-demand';
function lineStatsIdsFor(workspaceId: string, store: AgentRecoveryStore): string[] {
  const state = store.getState();
  return [
    ...new Set(
      [
        ...Object.keys(state.changes?.agentStats ?? {}),
        ...Object.keys(state.changes?.agentLineStatsRequests ?? {}),
      ]
        .filter((id) => state.agentSessions.byAgentId[id]?.workspaceId === workspaceId)
        .concat(
          [...(demands.get(workspaceId) ?? [])].flatMap((d) =>
            d.lineStats && d.agentId ? [d.agentId] : [],
          ),
        ),
    ),
  ];
}
interface MetadataSnapshot extends AgentListResult {
  lineStats: Array<{ agentId: string; metrics: Metrics | null }>;
  details: AgentSession[];
  orphanIds?: string[];
  staleRuntimeFlagClearAgentIds: string[];
  removedIds: string[];
  loaded: { delegated: boolean; background: boolean; retired: boolean; parents: string[] };
}
async function readMetadata(
  workspaceId: string,
  store: AgentRecoveryStore,
  reader: RecoveryReader,
): Promise<MetadataSnapshot> {
  const state = store.getState();
  const bins = state.workspaceAgents.byWorkspaceId[workspaceId];
  const requested = [...(demands.get(workspaceId) ?? [])];
  const top = normalizeAgentListResult(
    await reader.request('agent.list', { workspaceId, scope: 'topLevel' }),
  );
  const rows = new Map(top.agents.map((row) => [String(row.id), row]));
  const add = async (params: {
    scope: 'delegated' | 'background';
    parentAgentId?: string;
    orphanedOnly?: boolean;
  }) => {
    const result = normalizeAgentListResult(
      await reader.request('agent.list', { workspaceId, ...params, scope: params.scope }),
    );
    for (const row of result.agents) rows.set(String(row.id), row);
    return result.agents;
  };
  const loaded = { delegated: false, background: false, retired: false, parents: [] as string[] };
  let orphanIds: string[] | undefined;
  if (top.scopeCounts) {
    const delegated =
      bins?.delegatedAgentsLoaded ||
      requested.some((d) => d.bin === 'delegated' && !d.parentAgentId && !d.orphanedOnly);
    const background =
      bins?.backgroundAgentsLoaded || requested.some((d) => d.bin === 'background');
    loaded.delegated = !!delegated;
    loaded.background = !!background;
    if (delegated) await add({ scope: 'delegated' });
    else {
      const parents = new Set([
        ...Object.keys(bins?.loadedDelegatedParentIds ?? {}),
        ...requested.flatMap((d) => (d.parentAgentId ? [d.parentAgentId] : [])),
      ]);
      loaded.parents = [...parents];
      for (const parentAgentId of parents) await add({ scope: 'delegated', parentAgentId });
    }
    const parentsCovered =
      delegated &&
      (background ||
        (top.scopeCounts.background === 0 &&
          !Object.values(state.agentSessions.byAgentId).some(
            (a) =>
              a.workspaceId === workspaceId &&
              !a.retiredAt &&
              classifyAgentScope(a) === 'background',
          )));
    if (
      top.delegatedCounts?.orphaned &&
      !parentsCovered &&
      (bins?.orphanedDelegatedAgentsLoaded || requested.some((d) => d.orphanedOnly))
    ) {
      orphanIds = (await add({ scope: 'delegated', orphanedOnly: true })).map((row) =>
        String(row.id),
      );
    }
    if (background) await add({ scope: 'background' });
  }
  if (bins?.retiredAgentsLoaded || requested.some((d) => d.bin === 'retired')) {
    loaded.retired = true;
    const retired = normalizeAgentListResult(
      await reader.request('agent.list', { workspaceId, retiredOnly: true }),
    );
    for (const row of retired.agents) rows.set(String(row.id), row);
  }
  const details: AgentSession[] = [];
  const removedIds: string[] = [];
  const detailIds = new Set([
    ...(bins?.agentIds ?? []).filter((id) => !rows.has(id)),
    ...requested.flatMap((d) => (d.agentId ? [d.agentId] : [])),
  ]);
  if (requested.some((d) => d.hud)) {
    // Same bounded HUD projection as ordinary hydration: top-level rows plus
    // active agents and the newest eight failed summary rows, never transcripts.
    const { streams } = await reader.request<{
      streams: Array<{ agentId: string; workspaceId: string }>;
    }>('agent.listActive', {});
    const { workspace } = await reader.request<{
      workspace: {
        agentSummary?: { agents?: Array<{ id: string; status: string; lastActivity?: string }> };
      };
    }>('workspace.get', { workspaceId });
    const failed = (workspace.agentSummary?.agents ?? [])
      .filter((a) => a.status === 'error' || a.status === 'failed')
      .sort(
        (a, b) => (Date.parse(b.lastActivity ?? '') || 0) - (Date.parse(a.lastActivity ?? '') || 0),
      )
      .slice(0, 8);
    for (const id of [
      ...streams
        .filter((stream) => stream.workspaceId === workspaceId)
        .map((stream) => stream.agentId),
      ...failed.map((agent) => agent.id),
    ])
      detailIds.add(id);
  }
  for (const agentId of detailIds) {
    if (rows.has(agentId) || isAgentDeletionPending(agentId)) continue;
    try {
      const { agent } = await reader.request<{ agent: Record<string, unknown> }>('agent.get', {
        workspaceId,
        agentId,
      });
      const normalized = normalizeAgent(agent);
      if (normalized.workspaceId === workspaceId && !normalized.pendingDeleteAt)
        details.push(normalized);
    } catch (error) {
      const e = error as { rpcCode?: number; data?: { code?: string } };
      if (e.rpcCode === -32602 && e.data?.code === 'not-found') {
        removedIds.push(agentId);
        continue;
      }
      throw error;
    }
  }
  const agents = [...rows.values()].filter(
    (a) =>
      a.workspaceId === workspaceId && !a.pendingDeleteAt && !isAgentDeletionPending(String(a.id)),
  );
  const lineStats: MetadataSnapshot['lineStats'] = [];
  for (const agentId of lineStatsIdsFor(workspaceId, store)) {
    if (removedIds.includes(agentId) || isAgentDeletionPending(agentId)) {
      lineStats.push({ agentId, metrics: null });
      continue;
    }
    try {
      const metrics = await reader.request<Metrics | null>('metrics.getAgentStats', {
        workspaceId,
        agentId,
      });
      lineStats.push({ agentId, metrics });
    } catch (error) {
      const e = error as { rpcCode?: number; data?: { code?: string } };
      if (e.rpcCode !== -32602 || e.data?.code !== 'not-found') throw error;
      lineStats.push({ agentId, metrics: null });
    }
  }
  const staleRuntimeFlagClearAgentIds = [...agents, ...details].flatMap((agent) => {
    const prior = state.agentSessions.byAgentId[String(agent.id)];
    return staleRuntimeFlagClearUpsertOptions(
      prior?.isStreaming === true && prior.isProcessing === true,
      agent,
    )
      ? [String(agent.id)]
      : [];
  });
  return {
    ...top,
    agents,
    details,
    orphanIds,
    staleRuntimeFlagClearAgentIds,
    removedIds,
    loaded,
    lineStats,
  };
}

export function installAgentMetadataRecovery(
  scope: RendererRecoveryScope,
  store: AgentRecoveryStore,
): () => void {
  const context = selectPrincipalActionContext.select(store.getState());
  const owners = new Map<
    string,
    {
      handle: RendererRecoveryHandle;
      signature: string;
      lineStatsIds: Set<string>;
      unbindDemand: () => void;
    }
  >();
  let disposed = false,
    syncing = false,
    applying = false;
  const signatureFor = (workspaceId: string) => {
    const bin = store.getState().workspaceAgents.byWorkspaceId[workspaceId];
    return JSON.stringify([
      bin?.delegatedAgentsLoaded,
      bin?.backgroundAgentsLoaded,
      bin?.retiredAgentsLoaded,
      bin?.loadedDelegatedParentIds,
      bin?.orphanedDelegatedAgentsLoaded,
      lineStatsIdsFor(workspaceId, store).sort(),
      [...new Set([...(demands.get(workspaceId) ?? [])].map((d) => JSON.stringify(d)))].sort(),
    ]);
  };
  const sync = () => {
    if (disposed || syncing || applying || !scope.isCurrent()) return;
    syncing = true;
    try {
      const state = store.getState();
      if (context !== selectPrincipalActionContext.select(state)) {
        for (const owner of owners.values()) owner.handle.captureLifetime().isCurrent();
        return;
      }
      const mounted = new Set(
        state.workspaceLifecycle ? selectMountedWorkspaceIds.select(state) : [],
      );
      const workspaces = new Set([
        ...Object.keys(state.workspaceAgents.byWorkspaceId),
        ...Object.values(state.agentSessions.byAgentId).map((session) => session.workspaceId),
        ...listPendingAgentDeletions().map((entry) => entry.wsId),
        ...demands.keys(),
      ]);
      for (const workspaceId of workspaces) {
        const signature = signatureFor(workspaceId);
        let owner = owners.get(workspaceId);
        if (!owner) {
          const lineStatsIds = new Set(lineStatsIdsFor(workspaceId, store));
          const handle = scope.registerResource({
            key: agentMetadataRecoveryKey(workspaceId),
            workspaceId,
            eventTypes: ['agent:*', 'changes:metrics-changed'],
            active: mounted.has(workspaceId) || demands.has(workspaceId),
            isCurrent: () =>
              !disposed && context === selectPrincipalActionContext.select(store.getState()),
            read: (reader) =>
              trackAgentMetadataRead(
                workspaceId,
                () => readMetadata(workspaceId, store, reader),
                'recovery',
              ),
            apply: (snapshot) => {
              applying = true;
              try {
                const latest = store.getState();
                const preserve = (agent: AgentSession) => {
                  const old = latest.agentSessions.byAgentId[String(agent.id)];
                  return old?.workspaceId === workspaceId
                    ? { ...agent, messages: old.messages }
                    : agent;
                };
                const agents = snapshot.agents.map(preserve);
                for (const id of snapshot.removedIds) store.dispatch(removeSession(id));
                store.dispatch(
                  setAgents(workspaceId, [...agents, ...snapshot.details.map(preserve)]),
                );
                store.dispatch(setAgentsLoaded(workspaceId, true));
                store.dispatch(setIsLoadingAgents(workspaceId, false));
                if (snapshot.loaded.retired) {
                  store.dispatch(setRetiredAgentsLoaded(workspaceId, true));
                  store.dispatch(setIsLoadingRetiredAgents(workspaceId, false));
                }
                for (const bin of ['delegated', 'background'] as const)
                  if (snapshot.loaded[bin]) {
                    store.dispatch(setLazyBinLoaded(workspaceId, bin, true));
                    store.dispatch(setIsLoadingLazyBin(workspaceId, bin, false));
                  }
                for (const parent of snapshot.loaded.parents) {
                  store.dispatch(setDelegatedParentLoaded(workspaceId, parent, true));
                  store.dispatch(setIsLoadingDelegatedParent(workspaceId, parent, false));
                }
                if (snapshot.orphanIds) {
                  store.dispatch(setOrphanedDelegatedAgentsLoaded(workspaceId, true));
                  store.dispatch(setIsLoadingOrphanedDelegatedAgents(workspaceId, false));
                } else if (!snapshot.delegatedCounts?.orphaned) {
                  store.dispatch(setOrphanedDelegatedAgentsLoaded(workspaceId, false));
                  store.dispatch(setOrphanedDelegatedAgentIds(workspaceId, []));
                }

                store.dispatch(setRetiredCount(workspaceId, snapshot.retiredCount));
                store.dispatch(setScopeCounts(workspaceId, snapshot.scopeCounts ?? null));
                store.dispatch(setDelegatedCounts(workspaceId, snapshot.delegatedCounts ?? null));
                if (snapshot.orphanIds)
                  store.dispatch(setOrphanedDelegatedAgentIds(workspaceId, snapshot.orphanIds));
                store.dispatch(
                  bulkUpsertSessions(agents, {
                    listProjection: true,
                    staleRuntimeFlagClearAgentIds: snapshot.staleRuntimeFlagClearAgentIds,
                  }),
                );
                if (snapshot.details.length)
                  store.dispatch(
                    bulkUpsertSessions(snapshot.details.map(preserve), {
                      staleRuntimeFlagClearAgentIds: snapshot.staleRuntimeFlagClearAgentIds,
                    }),
                  );
                for (const { agentId, metrics } of snapshot.lineStats) {
                  lineStatsIds.add(agentId);
                  const timestamp = new Date().toISOString();
                  if (metrics)
                    store.dispatch(
                      updateAgentStats(agentId, {
                        additions: typeof metrics.additions === 'number' ? metrics.additions : 0,
                        deletions: typeof metrics.deletions === 'number' ? metrics.deletions : 0,
                        timestamp,
                      }),
                    );
                  else store.dispatch(clearAgentLineStats(agentId));
                  store.dispatch(agentLineStatsRequestSucceeded(agentId, timestamp));
                }
                reconcileAgentFailureSnapshot([...agents, ...snapshot.details]);
              } finally {
                applying = false;
              }
              const owned = owners.get(workspaceId);
              if (owned) owned.signature = signatureFor(workspaceId);
            },
            invalidate: () => {
              for (const agentId of Object.keys(
                store.getState().agentSessions.backgroundModePending ?? {},
              ))
                if (store.getState().agentSessions.byAgentId[agentId]?.workspaceId === workspaceId)
                  store.dispatch(setAgentBackgroundPending(agentId, false));
            },
            retire: () => {
              for (const agentId of lineStatsIds) {
                const current = store.getState().agentSessions.byAgentId[agentId];
                if (!current || current.workspaceId === workspaceId)
                  store.dispatch(clearAgentLineStats(agentId));
              }
              for (const entry of listPendingAgentDeletions())
                if (entry.wsId === workspaceId) removePendingAgentDeletion(entry.agentId);
              for (const session of Object.values(store.getState().agentSessions.byAgentId))
                if (session.workspaceId === workspaceId) {
                  store.dispatch(setAgentBackgroundPending(String(session.id), false));
                  store.dispatch(removeSession(String(session.id)));
                }
              store.dispatch(removeWorkspaceAgentState(workspaceId));
            },
          });
          owner = {
            handle,
            signature,
            lineStatsIds,
            unbindDemand: bindAgentMetadataDemandOwner(workspaceId, handle),
          };
          owners.set(workspaceId, owner);
        } else if (owner.signature !== signature) {
          owner.signature = signature;
          if (owner.handle.status.stale) owner.handle.invalidate();
        }
        for (const agentId of lineStatsIdsFor(workspaceId, store)) owner.lineStatsIds.add(agentId);
        owner.handle.setActive(mounted.has(workspaceId) || demands.has(workspaceId));
      }
      for (const [workspaceId, owner] of owners)
        if (!workspaces.has(workspaceId)) owner.handle.setActive(false);
    } finally {
      syncing = false;
    }
  };
  listeners.add(sync);
  const stop = store.subscribe(sync);
  sync();
  return () => {
    disposed = true;
    stop();
    listeners.delete(sync);
    for (const owner of owners.values()) {
      owner.unbindDemand();
      owner.handle.dispose();
    }
    owners.clear();
  };
}
