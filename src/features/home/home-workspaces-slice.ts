import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { HomeFilter } from './home-model';

export interface HomeWorkspacesState {
  repoKey: string | null;
  filter: HomeFilter;
  tab: 'workspaces' | 'prs' | 'linear';
  query: string;
  selectedId: string | null;
  view: 'list' | 'board';
}
const initialState: HomeWorkspacesState = {
  repoKey: null,
  filter: 'all',
  tab: 'workspaces',
  query: '',
  selectedId: null,
  view: 'list',
};
export const updateHomeWorkspaceView = createAction<[changes: Partial<HomeWorkspacesState>]>(
  'homeWorkspaces/updateView',
);
export const resetHomeWorkspaceView = createAction('homeWorkspaces/resetView');
export const homeWorkspacesReducer = createReducer<HomeWorkspacesState>(initialState);
homeWorkspacesReducer.with(updateHomeWorkspaceView, (state, { payload: [changes] }) => ({
  ...state,
  ...changes,
}));
homeWorkspacesReducer.with(resetHomeWorkspaceView, () => initialState);
