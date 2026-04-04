import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceSkillsState } from "./skills-slice";
import type { SkillInfo } from "./skills-types";

export const selectSkillsWorkspaceState = createSelector(
  (state, workspaceId: string) => {
    return state.skills.byWorkspaceId[workspaceId] ?? emptyWorkspaceSkillsState;
  },
);

export const selectSkills = createSelector<[workspaceId: string], SkillInfo[]>(
  (state, workspaceId) => {
    return selectSkillsWorkspaceState.select(state, workspaceId).skills;
  },
);

export const selectSkillsLoading = createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => {
    return selectSkillsWorkspaceState.select(state, workspaceId).loading;
  },
);

export const selectSkillsError = createSelector<[workspaceId: string], string | null>(
  (state, workspaceId) => {
    return selectSkillsWorkspaceState.select(state, workspaceId).error;
  },
);

