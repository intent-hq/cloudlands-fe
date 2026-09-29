import { store } from '$store/renderer/store';
export const selectHomeWorkspaceView = store.createSelector((state) => state.homeWorkspaces);
export const selectHomeWorkspaceError = store.createSelector((state) => state.workspace.error);
