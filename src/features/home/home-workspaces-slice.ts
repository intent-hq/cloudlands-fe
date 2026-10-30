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
  /** Agent the user explicitly picked in each workspace's Home preview, by workspace ID. */
  previewAgentIds: Record<string, string>;
}
const initialState: HomeWorkspacesState = {
  ...defaultHomeConfiguration(),
  selectedId: null,
  persistenceScope: null,
  persistenceError: false,
  previewAgentIds: {},
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
// A dedicated action (not updateView) keeps picks out of the persisted-preference writes.
export const setHomePreviewAgent = createAction<[workspaceId: string, agentId: string]>(
  'homeWorkspaces/setPreviewAgent',
);
homeWorkspacesReducer.with(setHomePreviewAgent, (state, { payload: [workspaceId, agentId] }) =>
  state.previewAgentIds[workspaceId] === agentId
    ? state
    : { ...state, previewAgentIds: { ...state.previewAgentIds, [workspaceId]: agentId } },
);
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
