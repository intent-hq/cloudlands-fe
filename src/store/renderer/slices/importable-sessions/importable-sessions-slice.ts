/**
 * importable-sessions slice — the sessions New Workspace → "Import a session"
 * offers (`agent.importableSessions.list`, spec "Wire contract (phase 1)").
 *
 * Components dispatch `importableSessionsRequested(query)` when the Sessions
 * tab first opens and as the user types; the saga debounces typed queries, calls the
 * daemon and stores the newest-first page. The saga lists only on a host that
 * advertises `sessionImport: 1`.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import {
  importableSessionKey,
  type ImportableSession,
  type ImportableSessionProvider,
} from '$features/session-import/importable-session';
import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';

/** A session row keyed by provider and session id. */
export type ImportableSessionRow = ImportableSession & { key: string };

export type ImportableSessionsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ImportableSessionsState = {
  sessions: Collection<ImportableSessionRow, 'key'>;
  status: ImportableSessionsStatus;
  /** Trimmed query of the request in flight or of `sessions`. */
  query: string;
  /** Provider filter of that request; '' lists every provider. */
  provider: string;
  /** Per-provider status from the last request across every provider. */
  providers: Collection<ImportableSessionProvider, 'id'>;
  error: string | null;
};

const initialState: ImportableSessionsState = {
  sessions: createCollection<ImportableSessionRow, 'key'>('key'),
  status: 'idle',
  query: '',
  provider: '',
  providers: createCollection<ImportableSessionProvider, 'id'>('id'),
  error: null,
};

/** Trigger: load the first page (empty query) or search (typed query), optionally for one provider. */
export const importableSessionsRequested = createAction<[query: string, provider?: string]>(
  'importableSessions/requested',
);

/** Saga → reducer: a request for `query` started. */
export const importableSessionsLoading = createAction<[query: string, provider: string]>(
  'importableSessions/loading',
);

/** Saga → reducer: the page for `query`, newest first. */
export const importableSessionsLoaded = createAction<
  [
    query: string,
    sessions: ImportableSession[],
    providers?: ImportableSessionProvider[],
    provider?: string,
  ]
>('importableSessions/loaded');

/** Saga → reducer: the request for `query` failed. */
export const importableSessionsFailed = createAction<
  [query: string, error: string, provider?: string]
>('importableSessions/failed');

/**
 * The picker that owned the list closed (dialog or onboarding step gone): drop
 * the rows so the next open lists fresh sessions.
 */
export const importableSessionsReset = createAction('importableSessions/reset');

export const importableSessionsReducer = createReducer<ImportableSessionsState>(initialState);

importableSessionsReducer.with(
  importableSessionsLoading,
  (state, { payload: [query, provider] }) => ({
    ...state,
    status: 'loading',
    query,
    provider,
    error: null,
  }),
);

importableSessionsReducer.with(
  importableSessionsLoaded,
  (state, { payload: [query, sessions, providers = [], provider = ''] }) => ({
    ...state,
    provider,
    // A one-provider request reports only that provider; keep the full set.
    providers: provider
      ? state.providers
      : createCollection<ImportableSessionProvider, 'id'>('id', providers),
    sessions: createCollection<ImportableSessionRow, 'key'>(
      'key',
      sessions.map((session) => ({ ...session, key: importableSessionKey(session) })),
    ),
    status: 'ready',
    query,
    error: null,
  }),
);

importableSessionsReducer.with(
  importableSessionsFailed,
  (state, { payload: [query, error, provider = ''] }) => ({
    ...state,
    provider,
    status: 'error',
    query,
    error,
  }),
);

importableSessionsReducer.with(hostExecutionConnectionChanged, () => initialState);
importableSessionsReducer.with(importableSessionsReset, () => initialState);
