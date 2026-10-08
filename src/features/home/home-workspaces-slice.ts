import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  defaultHomeConfiguration,
  type HomeConfiguration,
  type HomePersistenceDocument,
} from './home-workspaces-persistence';

export interface HomeWorkspacesState extends HomeConfiguration {
  selectedId: string | null;
  persistenceScope: string | null;
  persistenceError: boolean;
}
const initialState: HomeWorkspacesState = {
  ...defaultHomeConfiguration(),
  selectedId: null,
  persistenceScope: null,
  persistenceError: false,
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
homeWorkspacesReducer.with(resetHomeWorkspaceView, (state) => ({
  ...initialState,
  persistenceScope: state.persistenceScope,
}));

export const hydrateHomeWorkspaceSettings = createAction<
  [scope: string | null, settings: HomePersistenceDocument]
>('homeWorkspaces/hydrateSettings');
export const setHomePersistenceError = createAction<[failed: boolean]>(
  'homeWorkspaces/persistenceError',
);
homeWorkspacesReducer.with(
  hydrateHomeWorkspaceSettings,
  (state, { payload: [scope, settings] }) => ({
    ...initialState,
    ...settings.configuration,
    persistenceScope: scope,
  }),
);
homeWorkspacesReducer.with(setHomePersistenceError, (state, { payload: [failed] }) => ({
  ...state,
  persistenceError: failed,
}));
