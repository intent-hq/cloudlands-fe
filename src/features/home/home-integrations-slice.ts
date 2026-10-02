import {
  normalizeHomeConfiguration,
  type HomeIntegrationViewConfiguration,
} from './home-workspaces-persistence';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { HomeIntegrationScope, HomeIntegrationsState } from './home-integrations-types';

export const emptyHomeIntegrations: HomeIntegrationsState = {
  scope: null,
  generation: 0,
  query: '',
  filter: 'all',
  closed: false,
  status: 'idle',
  error: null,
  items: [],
  cursors: [],
  loadingMore: false,
  selectedId: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  comments: [],
  commentsCursor: null,
  commentsLoading: false,
  commentsError: null,
  reviewData: null,
  reviewLoading: false,
  reviewError: null,
  reviewsCursor: null,
  checksLoading: false,
  checksError: null,
  files: [],
  filesCursor: null,
  filesHeadSha: null,
  filesTruncated: false,
  filesLoading: false,
  filesError: null,
};
export const mountHomeIntegrations =
  createAction<[scope: HomeIntegrationScope, settings?: HomeIntegrationViewConfiguration]>(
    'homeIntegrations/mount',
  );
export const unmountHomeIntegrations = createAction('homeIntegrations/unmount');
export const searchHomeIntegrations =
  createAction<[query: string, filter: string, closed: boolean]>('homeIntegrations/search');
export const suspendHomeIntegrations = createAction('homeIntegrations/suspend');
export const refreshHomeIntegrations = createAction('homeIntegrations/refresh');
export const loadMoreHomeIntegrations = createAction('homeIntegrations/loadMore');
export const selectHomeIntegration = createAction<[id: string | null]>('homeIntegrations/select');
export const loadHomeReviewComments = createAction('homeIntegrations/loadComments');
export const startHomeIntegrationWorkspace = createAction('homeIntegrations/startWorkspace');
export const patchHomeIntegrations =
  createAction<[generation: number, patch: Partial<HomeIntegrationsState>]>(
    'homeIntegrations/patch',
  );
export const homeIntegrationsReducer = createReducer<HomeIntegrationsState>(emptyHomeIntegrations);
const reset = (state: HomeIntegrationsState): HomeIntegrationsState => ({
  ...emptyHomeIntegrations,
  scope: state.scope,
  generation: state.generation + 1,
  query: state.query,
  filter: state.filter,
  closed: state.closed,
  status: 'loading',
});
homeIntegrationsReducer.with(mountHomeIntegrations, (state, { payload: [scope, settings] }) => ({
  ...emptyHomeIntegrations,
  scope,
  generation: state.generation + 1,
  ...normalizeHomeConfiguration({ integrationViews: { [scope.kind]: settings } }).integrationViews[
    scope.kind
  ],
  status: 'loading',
}));
homeIntegrationsReducer.with(unmountHomeIntegrations, (state) => ({
  ...emptyHomeIntegrations,
  generation: state.generation + 1,
}));
homeIntegrationsReducer.with(
  searchHomeIntegrations,
  (state, { payload: [query, filter, closed] }) => ({
    ...reset(state),
    items: filter === state.filter && closed === state.closed ? state.items : [],
    query,
    filter,
    closed,
  }),
);
homeIntegrationsReducer.with(refreshHomeIntegrations, reset);
homeIntegrationsReducer.with(suspendHomeIntegrations, (state) => ({
  ...reset(state),
  status: 'disconnected',
}));
homeIntegrationsReducer.with(selectHomeIntegration, (state, { payload: [selectedId] }) => ({
  ...state,
  selectedId,
  detail: null,
  detailLoading: selectedId !== null,
  detailError: null,
  comments: [],
  commentsCursor: null,
  commentsLoading: false,
  commentsError: null,
  reviewData: null,
  reviewLoading: false,
  reviewError: null,
  reviewsCursor: null,
  checksLoading: false,
  checksError: null,
  files: [],
  filesCursor: null,
  filesHeadSha: null,
  filesTruncated: false,
  filesLoading: false,
  filesError: null,
}));
homeIntegrationsReducer.with(patchHomeIntegrations, (state, { payload: [generation, patch] }) =>
  state.generation === generation ? { ...state, ...patch } : state,
);

export const openHomeIntegrationUrl = createAction<[url: string]>('homeIntegrations/openUrl');

export const loadHomePullFiles = createAction('homeIntegrations/loadFiles');
export const loadHomePullReviewData = createAction('homeIntegrations/loadReviewData');

export const loadHomePullChecks = createAction('homeIntegrations/loadChecks');
