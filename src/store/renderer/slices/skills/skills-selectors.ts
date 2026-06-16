import { store } from "../../store";
import { emptyWorkspaceSkillsState } from "./skills-slice";
import type { SkillInfo } from "./skills-types";

export const selectSkillsWorkspaceState = store.createSelector(
  (state, workspaceId: string) => {
    return state.skills.byWorkspaceId[workspaceId] ?? emptyWorkspaceSkillsState;
  },
);

export const selectSkills = store.createSelector<[workspaceId: string], SkillInfo[]>(
  (state, workspaceId) => {
    return selectSkillsWorkspaceState.select(state, workspaceId).skills;
  },
);

