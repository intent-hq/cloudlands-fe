/**
 * Agent trace selectors (renderer).
 */
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { Trace, TraceAgentInfo } from '$features/agent-trace/trace-types';
import { buildTrace } from '$features/agent-trace/utils/build-trace';
import { agentDelegationParentOf } from '$shared/utils/agent-scope';
import { providerRefBaseId } from '$shared/provider-profiles';
import { selectAgentIsResponding } from '../agent-session/agent-session-selectors';
import { selectModelDisplayName } from '../model/model-selectors';
import { selectWorkspaceTokenUsage } from '../token-usage/token-usage-selectors';
import { selectAllWorkspaceAgents } from '../workspace-agents/workspace-agents-selectors';
import { emptyAgentTraceWorkspaceState, type AgentTraceWorkspaceState } from './agent-trace-slice';

export const selectAgentTraceState = store.createSelector(
  (state, wsId: string): AgentTraceWorkspaceState =>
    state.agentTrace?.byWorkspaceId[wsId] ?? emptyAgentTraceWorkspaceState,
);

/** Session facts the trace builder reads, one row per workspace agent. */
const selectTraceAgents = store.createSelector((state, wsId: string): TraceAgentInfo[] =>
  selectAllWorkspaceAgents.select(state, wsId).map((session) => {
    const id = String(session.id);
    const provider = session.provider;
    const modelId = session.model ?? undefined;
    let model: string | undefined;
    if (modelId && provider) {
      const baseId = providerRefBaseId(provider);
      model =
        selectModelDisplayName.select(state, provider, modelId, wsId) ??
        (baseId !== provider
          ? selectModelDisplayName.select(state, baseId, modelId, wsId)
          : undefined) ??
        modelId;
    } else model = modelId;
    return {
      id,
      name: session.name || '',
      parentId: agentDelegationParentOf(session),
      model,
      provider,
      active: selectAgentIsResponding.select(state, id),
      lastResponse: session.lastAgentResponse,
    };
  }),
);

/** The workspace's loaded agent activity as one timeline; `null` before its first turn. */
export const selectAgentTrace = store.createSelector((state, wsId: string): Trace | null => {
  const trace = selectAgentTraceState.select(state, wsId);
  if (trace.records.ids.length === 0) return null;
  return buildTrace({
    records: getItems(trace.records),
    agents: selectTraceAgents.select(state, wsId),
    names: selectWorkspaceTokenUsage.select(state, wsId).agentNames,
    now: Date.now(),
  });
});
