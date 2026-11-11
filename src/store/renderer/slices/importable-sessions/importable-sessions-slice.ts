/**
 * importable-sessions slice — the sessions New Workspace → "Import a session"
 * offers (`agent.importableSessions.list`, spec "Wire contract (phase 1)").
 *
 * Components dispatch `importableSessionsRequested(query)` when the picker
 * mounts and as the user types; the saga debounces typed queries, calls the
 * daemon and stores the newest-first page. `unsupported` marks a daemon that
 * predates the method (-32601), so the form hides the option.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  ImportableSession,
  ImportableSessionProvider,
} from '$features/session-import/importable-session';
import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';

/** A session row keyed by provider and session id. */
export type ImportableSessionRow = ImportableSession & { key: string };

export type ImportableSessionsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';

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
  /** The last unfiltered page had at least one session. */
  hasAny: boolean;
};

const initialState: ImportableSessionsState = {
  sessions: createCollection<ImportableSessionRow, 'key'>('key'),
  status: 'idle',
  query: '',
  provider: '',
  providers: createCollection<ImportableSessionProvider, 'id'>('id'),
  error: null,
  hasAny: false,
};

function importableSessionKey(session: Pick<ImportableSession, 'provider' | 'sessionId'>) {
  return `${session.provider}:${session.sessionId}`;
}

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
  [query: string, error: string, unsupported: boolean, provider?: string]
>('importableSessions/failed');

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
    hasAny:
      query === '' && !provider
        ? sessions.length > 0 || providers.some((entry) => entry.status === 'error')
        : state.hasAny,
  }),
);

importableSessionsReducer.with(
  importableSessionsFailed,
  (state, { payload: [query, error, unsupported, provider = ''] }) => ({
    ...state,
    provider,
    status: unsupported ? 'unsupported' : 'error',
    query,
    error,
    hasAny: unsupported ? false : state.hasAny,
  }),
);

importableSessionsReducer.with(hostExecutionConnectionChanged, () => initialState);
