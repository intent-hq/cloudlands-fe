import { store } from '../../store';
import { emptyWorkspaceSkillsState } from './skills-slice';
import type { SkillInfo, SkillsWorkspaceState } from './skills-types';

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
