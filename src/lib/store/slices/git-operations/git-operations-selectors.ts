import { createSelector } from "../../utils/create-selector";

export const selectLastGitOperation = createSelector((state) => {
  return state.gitOperations.lastGitOperation;
});

export const selectLastGitError = createSelector((state) => {
  return state.gitOperations.lastGitError;
});

export const selectLastAutoCommitHookFailure = createSelector((state) => {
  return state.gitOperations.lastAutoCommitHookFailure;
});