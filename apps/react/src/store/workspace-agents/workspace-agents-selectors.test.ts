import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import type { WireAgentSession } from '../../../../../src/store/renderer/slices/agent-session/agent-session-types';
import {
  removeSession,
  bulkUpsertSessions,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  adjustScopeCount,
  setActiveAgentId,
  setAgents,
  setDelegatedCounts,
  setDelegatedParentLoaded,
  setIsLoadingDelegatedParent,
  setIsLoadingLazyBin,
  setIsLoadingOrphanedDelegatedAgents,
  setIsLoadingRetiredAgents,
  setLazyBinLoaded,
  setOrphanedDelegatedAgentsLoaded,
  setRetiredAgentsLoaded,
  setScopeCounts,
} from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { store } from '../index';
import * as selectors from './workspace-agents-selectors';

const workspaceId = WorkspaceId('11111111-1111-4111-8111-111111111111');
const otherWorkspaceId = WorkspaceId('22222222-2222-4222-8222-222222222222');
const stops: Array<() => void> = [];
let dispose: () => void;

beforeEach(() => {
  dispose = store.init();
});
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  dispose();
});

function session(id: string, name = id): WireAgentSession {
  return {
    id: AgentId(id),
    workspaceId,
    backendSessionId: null,
    name,
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('canonical workspace-agent selectors on the configured React Store', () => {
  it('returns empty values for missing workspaces without creating workspace state', () => {
    expect(selectors.selectAllWorkspaceAgents.select(store.state)).toEqual([]);
    expect(selectors.selectAllWorkspaceAgents.select(store.state, '')).toEqual([]);
    expect(selectors.selectAllWorkspaceAgents.select(store.state, workspaceId)).toEqual([]);
    expect(selectors.selectActiveAgentId.select(store.state, workspaceId)).toBeNull();
    expect(selectors.selectWorkspaceAgentIds.select(store.state, workspaceId)).toEqual([]);
    expect(selectors.selectRetiredAgentsLoaded.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectIsLoadingRetiredAgents.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectDelegatedAgentsLoaded.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectIsLoadingDelegatedAgents.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectBackgroundAgentsLoaded.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectIsLoadingBackgroundAgents.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectOrphanedDelegatedAgentsLoaded.select(store.state, workspaceId)).toBe(
      false,
    );
    expect(selectors.selectIsLoadingOrphanedDelegatedAgents.select(store.state, workspaceId)).toBe(
      false,
    );
    expect(selectors.selectDelegatedParentLoaded.select(store.state, workspaceId, 'parent-a')).toBe(
      false,
    );
    expect(
      selectors.selectIsLoadingDelegatedParent.select(store.state, workspaceId, 'parent-a'),
    ).toBe(false);
    expect(selectors.selectLoadedDelegatedParentIds.select(store.state, workspaceId)).toEqual({});
    expect(selectors.selectScopeCounts.select(store.state, workspaceId)).toBeNull();
    expect(selectors.selectDelegatedCounts.select(store.state, workspaceId)).toBeNull();
    expect(selectors.selectScopeCountsGeneration.select(store.state, workspaceId)).toBe(0);
    expect(store.state.workspaceAgents.byWorkspaceId[workspaceId]).toBeUndefined();
  });

  it('joins in membership order, skips absent sessions, and follows session replacement/removal', () => {
    const a = session('a');
    const b = session('b');
    const missing = session('missing');
    store.dispatch(bulkUpsertSessions([a]));
    store.dispatch(bulkUpsertSessions([b]));
    store.dispatch(setAgents(workspaceId, [b, missing, a]));
    store.dispatch(setActiveAgentId(workspaceId, 'b'));

    const ids = selectors.selectWorkspaceAgentIds.select(store.state, workspaceId);
    expect(ids).toEqual(['b', 'missing', 'a']);
    expect(ids).toBe(store.state.workspaceAgents.byWorkspaceId[workspaceId].agentIds);
    const joined = selectors.selectAllWorkspaceAgents.select(store.state, workspaceId);
    expect(joined.map((row) => row.id)).toEqual(['b', 'a']);
    expect(joined[0]).toBe(store.state.agentSessions.byAgentId.b);
    expect(joined[1]).toBe(store.state.agentSessions.byAgentId.a);
    expect(selectors.selectActiveAgentId.select(store.state, workspaceId)).toBe('b');
    expect(selectors.selectAllWorkspaceAgents.select(store.state, otherWorkspaceId)).toEqual([]);

    store.dispatch(bulkUpsertSessions([session('b', 'Renamed')]));
    const updated = selectors.selectAllWorkspaceAgents.select(store.state, workspaceId);
    expect(updated[0].name).toBe('Renamed');
    expect(updated[0]).toBe(store.state.agentSessions.byAgentId.b);
    expect(updated[0]).not.toBe(joined[0]);
    expect(updated[1]).toBe(joined[1]);
    store.dispatch(removeSession('b'));
    expect(
      selectors.selectAllWorkspaceAgents.select(store.state, workspaceId).map((row) => row.id),
    ).toEqual(['a']);
    expect(selectors.selectWorkspaceAgentIds.select(store.state, workspaceId)).toBe(ids);
  });

  it('keeps parent load coverage separate from whole-bin and orphan coverage', () => {
    store.dispatch(setDelegatedParentLoaded(workspaceId, 'parent-a', true));
    const loadedParents = selectors.selectLoadedDelegatedParentIds.select(store.state, workspaceId);
    expect(loadedParents).toEqual({ 'parent-a': true });
    expect(loadedParents).toBe(
      store.state.workspaceAgents.byWorkspaceId[workspaceId].loadedDelegatedParentIds,
    );
    expect(selectors.selectDelegatedParentLoaded.select(store.state, workspaceId, 'parent-a')).toBe(
      true,
    );
    expect(selectors.selectDelegatedParentLoaded.select(store.state, workspaceId, 'parent-b')).toBe(
      false,
    );
    expect(selectors.selectDelegatedAgentsLoaded.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectOrphanedDelegatedAgentsLoaded.select(store.state, workspaceId)).toBe(
      false,
    );

    store.dispatch(setLazyBinLoaded(workspaceId, 'delegated', true));
    expect(selectors.selectDelegatedParentLoaded.select(store.state, workspaceId, 'parent-b')).toBe(
      true,
    );
    expect(selectors.selectDelegatedAgentsLoaded.select(store.state, workspaceId)).toBe(true);
    expect(selectors.selectLoadedDelegatedParentIds.select(store.state, workspaceId)).toBe(
      loadedParents,
    );
    expect(selectors.selectOrphanedDelegatedAgentsLoaded.select(store.state, workspaceId)).toBe(
      false,
    );
    store.dispatch(setOrphanedDelegatedAgentsLoaded(workspaceId, true));
    store.dispatch(setLazyBinLoaded(workspaceId, 'delegated', false));
    expect(selectors.selectDelegatedParentLoaded.select(store.state, workspaceId, 'parent-b')).toBe(
      false,
    );
    expect(selectors.selectOrphanedDelegatedAgentsLoaded.select(store.state, workspaceId)).toBe(
      true,
    );
    expect(selectors.selectBackgroundAgentsLoaded.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectRetiredAgentsLoaded.select(store.state, workspaceId)).toBe(false);
  });

  it('tracks and clears independent bin and per-parent loading through canonical actions', () => {
    store.dispatch(setIsLoadingLazyBin(workspaceId, 'delegated', true));
    store.dispatch(setIsLoadingDelegatedParent(workspaceId, 'parent-a', true));
    expect(selectors.selectIsLoadingDelegatedAgents.select(store.state, workspaceId)).toBe(true);
    expect(
      selectors.selectIsLoadingDelegatedParent.select(store.state, workspaceId, 'parent-a'),
    ).toBe(true);
    expect(
      selectors.selectIsLoadingDelegatedParent.select(store.state, workspaceId, 'parent-b'),
    ).toBe(false);
    expect(selectors.selectIsLoadingOrphanedDelegatedAgents.select(store.state, workspaceId)).toBe(
      false,
    );
    expect(selectors.selectIsLoadingBackgroundAgents.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectIsLoadingRetiredAgents.select(store.state, workspaceId)).toBe(false);
    store.dispatch(setIsLoadingOrphanedDelegatedAgents(workspaceId, true));
    store.dispatch(setIsLoadingLazyBin(workspaceId, 'background', true));
    store.dispatch(setIsLoadingRetiredAgents(workspaceId, true));
    store.dispatch(setIsLoadingLazyBin(workspaceId, 'delegated', false));
    store.dispatch(setIsLoadingDelegatedParent(workspaceId, 'parent-a', false));
    expect(selectors.selectIsLoadingDelegatedAgents.select(store.state, workspaceId)).toBe(false);
    expect(
      selectors.selectIsLoadingDelegatedParent.select(store.state, workspaceId, 'parent-a'),
    ).toBe(false);
    expect(selectors.selectIsLoadingOrphanedDelegatedAgents.select(store.state, workspaceId)).toBe(
      true,
    );
    expect(selectors.selectIsLoadingBackgroundAgents.select(store.state, workspaceId)).toBe(true);
    expect(selectors.selectIsLoadingRetiredAgents.select(store.state, workspaceId)).toBe(true);
    store.dispatch(setIsLoadingOrphanedDelegatedAgents(workspaceId, false));
    store.dispatch(setIsLoadingLazyBin(workspaceId, 'background', false));
    store.dispatch(setIsLoadingRetiredAgents(workspaceId, false));
    store.dispatch(setRetiredAgentsLoaded(workspaceId, true));
    store.dispatch(setLazyBinLoaded(workspaceId, 'background', true));
    expect(selectors.selectIsLoadingOrphanedDelegatedAgents.select(store.state, workspaceId)).toBe(
      false,
    );
    expect(selectors.selectIsLoadingBackgroundAgents.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectIsLoadingRetiredAgents.select(store.state, workspaceId)).toBe(false);
    expect(selectors.selectRetiredAgentsLoaded.select(store.state, workspaceId)).toBe(true);
    expect(selectors.selectBackgroundAgentsLoaded.select(store.state, workspaceId)).toBe(true);
    expect(selectors.selectRetiredAgentsLoaded.select(store.state, otherWorkspaceId)).toBe(false);
  });

  it('reports daemon counts and advances baseline generation only on setScopeCounts', () => {
    const agent = session('a');
    store.dispatch(bulkUpsertSessions([agent]));
    store.dispatch(setAgents(workspaceId, [agent]));
    store.dispatch(setScopeCounts(workspaceId, { topLevel: 19, delegated: 42, background: 5 }));
    const counts = selectors.selectScopeCounts.select(store.state, workspaceId);
    expect(counts).toEqual({ topLevel: 19, delegated: 42, background: 5 });
    expect(counts).toBe(store.state.workspaceAgents.byWorkspaceId[workspaceId].scopeCounts);
    expect(selectors.selectAllWorkspaceAgents.select(store.state, workspaceId)).toHaveLength(1);
    expect(selectors.selectScopeCountsGeneration.select(store.state, workspaceId)).toBe(1);
    store.dispatch(setScopeCounts(workspaceId, { topLevel: 19, delegated: 42, background: 5 }));
    expect(selectors.selectScopeCounts.select(store.state, workspaceId)).toBe(counts);
    expect(selectors.selectScopeCountsGeneration.select(store.state, workspaceId)).toBe(2);
    store.dispatch(adjustScopeCount(workspaceId, 'delegated', 1));
    expect(selectors.selectScopeCounts.select(store.state, workspaceId)).toEqual({
      topLevel: 19,
      delegated: 43,
      background: 5,
    });
    expect(selectors.selectScopeCountsGeneration.select(store.state, workspaceId)).toBe(2);
    store.dispatch(setScopeCounts(workspaceId, null));
    expect(selectors.selectScopeCounts.select(store.state, workspaceId)).toBeNull();
    expect(selectors.selectScopeCountsGeneration.select(store.state, workspaceId)).toBe(3);
    store.dispatch(setScopeCounts(workspaceId, null));
    expect(selectors.selectScopeCountsGeneration.select(store.state, workspaceId)).toBe(4);
    store.dispatch(adjustScopeCount(workspaceId, 'delegated', 1));
    expect(selectors.selectScopeCounts.select(store.state, workspaceId)).toBeNull();
    expect(selectors.selectScopeCountsGeneration.select(store.state, workspaceId)).toBe(4);
  });

  it('distinguishes unavailable counts, absent orphan metadata, and a served zero orphan count', () => {
    expect(selectors.selectDelegatedCounts.select(store.state, workspaceId)).toBeNull();
    store.dispatch(
      setDelegatedCounts(workspaceId, {
        running: 2,
        byParent: { 'parent-a': { total: 42, running: 2 } },
      }),
    );
    const absent = selectors.selectDelegatedCounts.select(store.state, workspaceId);
    expect(absent).toEqual({ running: 2, byParent: { 'parent-a': { total: 42, running: 2 } } });
    expect(absent).not.toHaveProperty('orphaned');
    expect(absent).toBe(store.state.workspaceAgents.byWorkspaceId[workspaceId].delegatedCounts);
    store.dispatch(
      setDelegatedCounts(workspaceId, {
        running: 2,
        byParent: { 'parent-a': { total: 42, running: 2 } },
        orphaned: { total: 0, running: 0 },
      }),
    );
    const served = selectors.selectDelegatedCounts.select(store.state, workspaceId);
    expect(served).toHaveProperty('orphaned', { total: 0, running: 0 });
    expect(served).toBe(store.state.workspaceAgents.byWorkspaceId[workspaceId].delegatedCounts);
    store.dispatch(setDelegatedCounts(workspaceId, null));
    expect(selectors.selectDelegatedCounts.select(store.state, workspaceId)).toBeNull();
  });

  it('reads all production selector effects through the configured Store saga lifetime', async () => {
    const agent = session('effect-agent');
    store.dispatch(bulkUpsertSessions([agent]));
    store.dispatch(setAgents(workspaceId, [agent]));
    store.dispatch(setActiveAgentId(workspaceId, 'effect-agent'));
    store.dispatch(setRetiredAgentsLoaded(workspaceId, true));
    store.dispatch(setIsLoadingRetiredAgents(workspaceId, true));
    store.dispatch(setLazyBinLoaded(workspaceId, 'delegated', true));
    store.dispatch(setIsLoadingLazyBin(workspaceId, 'background', true));
    store.dispatch(setOrphanedDelegatedAgentsLoaded(workspaceId, true));
    store.dispatch(setIsLoadingDelegatedParent(workspaceId, 'parent-a', true));
    store.dispatch(setDelegatedParentLoaded(workspaceId, 'parent-a', true));
    store.dispatch(setScopeCounts(workspaceId, { topLevel: 9, delegated: 4, background: 2 }));
    store.dispatch(
      setDelegatedCounts(workspaceId, {
        running: 1,
        byParent: { 'parent-a': { total: 4, running: 1 } },
      }),
    );
    const result = await new Promise((resolve, reject) => {
      stops.push(
        store.runSaga(function* readWorkspaceAgentEffects() {
          try {
            resolve({
              active: yield* selectors.selectActiveAgentId.effect(workspaceId),
              ids: yield* selectors.selectWorkspaceAgentIds.effect(workspaceId),
              agents: yield* selectors.selectAllWorkspaceAgents.effect(workspaceId),
              omitted: yield* selectors.selectAllWorkspaceAgents.effect(),
              retiredLoaded: yield* selectors.selectRetiredAgentsLoaded.effect(workspaceId),
              retiredLoading: yield* selectors.selectIsLoadingRetiredAgents.effect(workspaceId),
              delegatedLoaded: yield* selectors.selectDelegatedAgentsLoaded.effect(workspaceId),
              delegatedLoading: yield* selectors.selectIsLoadingDelegatedAgents.effect(workspaceId),
              backgroundLoaded: yield* selectors.selectBackgroundAgentsLoaded.effect(workspaceId),
              backgroundLoading:
                yield* selectors.selectIsLoadingBackgroundAgents.effect(workspaceId),
              orphanLoaded:
                yield* selectors.selectOrphanedDelegatedAgentsLoaded.effect(workspaceId),
              orphanLoading:
                yield* selectors.selectIsLoadingOrphanedDelegatedAgents.effect(workspaceId),
              parentLoaded: yield* selectors.selectDelegatedParentLoaded.effect(
                workspaceId,
                'parent-b',
              ),
              parentLoading: yield* selectors.selectIsLoadingDelegatedParent.effect(
                workspaceId,
                'parent-a',
              ),
              loadedParents: yield* selectors.selectLoadedDelegatedParentIds.effect(workspaceId),
              counts: yield* selectors.selectScopeCounts.effect(workspaceId),
              delegatedCounts: yield* selectors.selectDelegatedCounts.effect(workspaceId),
              generation: yield* selectors.selectScopeCountsGeneration.effect(workspaceId),
            });
          } catch (error) {
            reject(error);
          }
        }),
      );
    });
    expect(result).toEqual({
      active: 'effect-agent',
      ids: ['effect-agent'],
      agents: [store.state.agentSessions.byAgentId['effect-agent']],
      omitted: [],
      retiredLoaded: true,
      retiredLoading: true,
      delegatedLoaded: true,
      delegatedLoading: false,
      backgroundLoaded: false,
      backgroundLoading: true,
      orphanLoaded: true,
      orphanLoading: false,
      parentLoaded: true,
      parentLoading: true,
      loadedParents: { 'parent-a': true },
      counts: { topLevel: 9, delegated: 4, background: 2 },
      delegatedCounts: { running: 1, byParent: { 'parent-a': { total: 4, running: 1 } } },
      generation: 1,
    });
  });
});
