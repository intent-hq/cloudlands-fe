import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { AgentRenameRequest } from './agent-session-types';
import { isAgentRunningState } from '$shared/utils/agent-runtime-state';
import type { AgentSession } from '$shared/types/agent-session';
import { getAgentProvider } from '$shared/types/agent-session';
import type { StoredAgentSession, AgentSessionState } from './agent-session-types';
import type { ProviderReadState } from '../provider-catalog/provider-read-types';
import {
  getEffectiveDefaultProviderId,
  getNormalizedProviderId,
} from '../provider-catalog/provider-catalog-projections';
export type AgentSessionProjectionState = ProviderReadState & { agentSessions: AgentSessionState };
const LEGACY_CODEX_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const LEGACY_CODEX_EFFORT_MODELS = new Set(['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']);

/** Select the canonical session map for dynamic component-owned ID sets. */
export const getAgentSessionsById = (
  state: AgentSessionProjectionState,
): Readonly<Record<string, AgentSession>> => state.agentSessions?.byAgentId ?? {};

export const getAgentSession = (
  state: AgentSessionProjectionState,
  agentId?: string,
): StoredAgentSession | undefined => {
  if (!agentId) return undefined;
  return state.agentSessions?.byAgentId[agentId];
};
export const getAgentDetailHydrated = (
  state: AgentSessionProjectionState,
  agentId?: string,
): boolean => Boolean(agentId && state.agentSessions?.detailHydrated?.[agentId]);
export const getAgentSessionProvider = (
  state: AgentSessionProjectionState,
  agentId?: string,
): string | undefined => {
  if (!agentId) return undefined;
  const stored = state.agentSessions?.byAgentId[agentId];
  const raw = stored
    ? getAgentProvider(stored, getEffectiveDefaultProviderId(state, stored.workspaceId))
    : undefined;
  return raw ? getNormalizedProviderId(state, raw, stored?.workspaceId) : undefined;
};
export const getAgentSessionWorkspaceId = (
  state: AgentSessionProjectionState,
  agentId: string,
): AgentSession['workspaceId'] | undefined => state.agentSessions?.byAgentId[agentId]?.workspaceId;
export const getAgentReasoningEffort = (
  state: AgentSessionProjectionState,
  agentId: string,
): string | undefined => {
  const stored = state.agentSessions?.byAgentId[agentId];
  if (!stored) return undefined;
  if (typeof stored.reasoningEffort === 'string' && stored.reasoningEffort.length > 0) {
    return stored.reasoningEffort;
  }
  if (stored.reasoningEffort === null) return undefined;
  const model = stored.model;
  if (typeof model !== 'string') return undefined;
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= model.length - 1) return undefined;
  const suffix = model.slice(slashIndex + 1);
  if (!LEGACY_CODEX_EFFORTS.has(suffix)) return undefined;
  const base = model.slice(0, slashIndex);
  const isCodex =
    getAgentSessionProvider(state, agentId) === 'codex' ||
    base.startsWith('codex:') ||
    LEGACY_CODEX_EFFORT_MODELS.has(base);
  return isCodex ? suffix : undefined;
};

export const getAgentIsResponding = (
  state: { agentSessions: AgentSessionState },
  agentId: string,
): boolean => {
  const stored = state.agentSessions?.byAgentId[agentId];
  return !!stored && isAgentRunningState(stored);
};

export const getAgentRenameRevision = (
  state: { agentSessions: AgentSessionState },
  agentId: string,
): number => state.agentSessions.renameRevisions?.[agentId] ?? 0;
export const getAgentRenameOperations = (
  state: { agentSessions: AgentSessionState },
  agentId: string,
) =>
  state.agentSessions.renameOperations
    ? getItems(state.agentSessions.renameOperations).filter(
        (operation) => operation.agentId === agentId,
      )
    : [];
export const getAgentRenameViewCurrent = (
  state: { agentSessions: AgentSessionState },
  request: Pick<AgentRenameRequest, 'viewId' | 'workspaceId' | 'agentId' | 'authority' | 'context'>,
): boolean => {
  const view =
    state.agentSessions.renameViews && getItem(state.agentSessions.renameViews, request.viewId);
  const session = state.agentSessions.byAgentId[request.agentId];
  return (
    !!view &&
    !view.released &&
    view.workspaceId === request.workspaceId &&
    view.agentId === request.agentId &&
    view.authority === request.authority &&
    view.context === request.context &&
    session?.workspaceId === request.workspaceId
  );
};
