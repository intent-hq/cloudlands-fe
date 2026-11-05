import { m } from '$shared/paraglide/messages.js';
import { store } from '../../store';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';
import { emptyAgentSkillsState, emptyWorkspaceSkillsState } from './skills-slice';
import type { SkillInfo, SkillsAgentState, SkillsWorkspaceState } from './skills-types';

const selectSkillsWorkspaceState = store.createSelector<
  [workspaceId: string],
  SkillsWorkspaceState
>((state, workspaceId) => state.skills.byWorkspaceId[workspaceId] ?? emptyWorkspaceSkillsState);

export const selectSkills = store.createSelector<[workspaceId: string], SkillInfo[]>(
  (state, workspaceId) => {
    return selectSkillsWorkspaceState.select(state, workspaceId).skills;
  },
);

export const selectSkillsLoading = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => selectSkillsWorkspaceState.select(state, workspaceId).loading,
);

export const selectSkillsError = store.createSelector<[workspaceId: string], string | null>(
  (state, workspaceId) => selectSkillsWorkspaceState.select(state, workspaceId).error,
);

/** A remote agent's machine skills state (`skill.list` with `agentId`). */
export const selectAgentSkillsState = store.createSelector<[agentId: string], SkillsAgentState>(
  (state, agentId) => state.skills.byAgentId?.[agentId] ?? emptyAgentSkillsState,
);

/** Whether a remote agent's machine skills were loaded (so a change refreshes them). */
export const selectAgentSkillsLoaded = store.createSelector<[agentId: string], boolean>(
  (state, agentId) => Boolean(state.skills.byAgentId?.[agentId]),
);

/** Whether `skill.list` takes `agentId` (exact `remoteAgentSkills: 1`). */
export const selectRemoteAgentSkillsSupported = store.createSelector(
  (state): boolean => selectPrincipalSnapshot.select(state)?.capabilities.remoteAgentSkills === 1,
);

/**
 * The machine whose skills `agentId`'s `/` menu lists: its display name (or
 * id) when it runs on another machine and the daemon supports
 * `remoteAgentSkills`; otherwise `undefined` (the workspace's skills).
 */
export const selectAgentSkillsMachine = store.createSelector<[agentId: string], string | undefined>(
  (state, agentId) => {
    if (!agentId || !selectRemoteAgentSkillsSupported.select(state)) return undefined;
    const session = state.agentSessions?.byAgentId[agentId];
    if (!session?.nodeId) return undefined;
    return session.nodeName ?? m.chat_slashSkillSuggestionList_unnamedMachine_label();
  },
);

/** `agentId`'s machine connection state: a change re-reads its skills. */
export const selectAgentSkillsNodeState = store.createSelector<
  [agentId: string],
  string | undefined
>((state, agentId) => state.agentSessions?.byAgentId[agentId]?.nodeState);
