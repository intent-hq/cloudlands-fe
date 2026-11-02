import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  defaultHomeConfiguration,
  HOME_SET_ASIDE_CAPACITY,
  type HomeConfiguration,
  type HomePersistenceDocument,
  normalizeHomeSetAside,
  type HomeSetAsideRecord,
} from './home-workspaces-persistence';

export interface HomeWorkspacesState extends HomeConfiguration {
  selectedId: string | null;
  persistenceScope: string | null;
  persistenceError: boolean;
  /** Agent the user explicitly picked in each workspace's Home preview, by workspace ID. */
  previewAgentIds: Record<string, string>;
  /** Personal Home organization, by workspace ID; never sent to the daemon. */
  setAside: Record<string, HomeSetAsideRecord>;
}
const initialState: HomeWorkspacesState = {
  ...defaultHomeConfiguration(),
  selectedId: null,
  persistenceScope: null,
  persistenceError: false,
  previewAgentIds: {},
  setAside: {},
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
// Resetting view controls keeps personal set-aside state.
homeWorkspacesReducer.with(resetHomeWorkspaceView, (state) => ({
  ...initialState,
  persistenceScope: state.persistenceScope,
  setAside: state.setAside,
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
    setAside: settings.setAside ?? {},
    persistenceScope: scope,
  }),
);
homeWorkspacesReducer.with(setHomePersistenceError, (state, { payload: [failed] }) => ({
  ...state,
  persistenceError: failed,
}));

/** Settle a workspace on Home. Agents, scripts, hooks and watches keep running. */
export const setHomeWorkspaceAside = createAction(
  'homeWorkspaces/setAside',
  (workspaceId: string, at = Date.now()) => ({ workspaceId, at }),
);
/** Explicitly return a set-aside workspace (Bring back or Undo). */
export const bringBackHomeWorkspace = createAction(
  'homeWorkspaces/bringBack',
  (workspaceId: string) => ({ workspaceId }),
);
/** `archived`/`deleted` free the record; Archive stays the stronger, separate action. */
type HomeWorkspaceReturnReason = 'attention' | 'instruction' | 'archived' | 'deleted';
/** The app returned a set-aside workspace on its own; `attention` is worth announcing. */
export const homeWorkspaceReturned = createAction(
  'homeWorkspaces/returned',
  (workspaceId: string, reason: HomeWorkspaceReturnReason) => ({ workspaceId, reason }),
);
/** Watcher-owned: replace the attention already known for a set-aside workspace. */
export const homeSetAsideKnownAttentionRecorded = createAction(
  'homeWorkspaces/setAsideKnownAttention',
  (workspaceId: string, known: string[], knownAt: number) => ({ workspaceId, known, knownAt }),
);

function withoutSetAside(state: HomeWorkspacesState, workspaceId: string): HomeWorkspacesState {
  if (!state.setAside[workspaceId]) return state;
  const setAside = { ...state.setAside };
  delete setAside[workspaceId];
  return { ...state, setAside };
}
homeWorkspacesReducer.with(setHomeWorkspaceAside, (state, { payload: { workspaceId, at } }) => {
  if (state.setAside[workspaceId]) return state;
  if (Object.keys(state.setAside).length >= HOME_SET_ASIDE_CAPACITY) return state;
  return {
    ...state,
    // `known: null` lets the watcher record current attention before judging it.
    setAside: { ...state.setAside, [workspaceId]: { at, known: null, knownAt: at } },
  };
});
homeWorkspacesReducer.with(bringBackHomeWorkspace, (state, { payload: { workspaceId } }) =>
  withoutSetAside(state, workspaceId),
);
homeWorkspacesReducer.with(homeWorkspaceReturned, (state, { payload: { workspaceId } }) =>
  withoutSetAside(state, workspaceId),
);
homeWorkspacesReducer.with(workspaceDeleted, (state, { payload: [workspaceId] }) =>
  withoutSetAside(state, workspaceId),
);
homeWorkspacesReducer.with(
  homeSetAsideKnownAttentionRecorded,
  (state, { payload: { workspaceId, known, knownAt } }) => {
    const record = state.setAside[workspaceId];
    if (!record) return state;
    const same =
      record.known !== null &&
      record.known.length === known.length &&
      record.known.every((token, index) => token === known[index]);
    if (same && record.knownAt === knownAt) return state;
    return {
      ...state,
      setAside: { ...state.setAside, [workspaceId]: { ...record, known, knownAt } },
    };
  },
);

/** Another app window saved newer set-aside records for this scope; view controls stay local. */
export const homeSetAsideSynced = createAction<
  [scope: string, setAside: Record<string, HomeSetAsideRecord>]
>('homeWorkspaces/setAsideSynced');
homeWorkspacesReducer.with(homeSetAsideSynced, (state, { payload: [scope, setAside] }) =>
  state.persistenceScope === scope
    ? { ...state, setAside: normalizeHomeSetAside(setAside) }
    : state,
);
