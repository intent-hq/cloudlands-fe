import { call, delay, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { selectSessionImportSupported } from '../importable-sessions-selectors';
import { listImportableSessions } from '$features/session-import/importable-sessions.client';
import {
  importableSessionsFailed,
  importableSessionsLoaded,
  importableSessionsLoading,
  importableSessionsRequested,
} from '../importable-sessions-slice';

/** @internal */
export const IMPORTABLE_SESSIONS_SEARCH_DEBOUNCE_MS = 250;
/** @internal */
export const IMPORTABLE_SESSIONS_PAGE_SIZE = 50;

function* requestWorker(
  action: ReturnType<typeof importableSessionsRequested>,
): SagaGenerator<void> {
  // A host without `sessionImport: 1` has nothing to list; the option stays hidden.
  if (!(yield* selectSessionImportSupported.effect())) return;
  const connection = yield* selectPrincipalConnectionContext.effect();
  const query = action.payload[0].trim();
  const provider = action.payload[1] ?? '';
  // Typed queries coalesce; the first page loads at once.
  if (query) yield* delay(IMPORTABLE_SESSIONS_SEARCH_DEBOUNCE_MS);
  if (connection !== (yield* selectPrincipalConnectionContext.effect())) return;
  yield* put(importableSessionsLoading(query, provider));
  const result = yield* call(listImportableSessions, {
    ...(provider ? { provider } : {}),
    ...(query ? { query } : {}),
    limit: IMPORTABLE_SESSIONS_PAGE_SIZE,
  });
  if (connection !== (yield* selectPrincipalConnectionContext.effect())) return;
  if (result.ok) {
    yield* put(importableSessionsLoaded(query, result.sessions, result.providers, provider));
  } else {
    yield* put(importableSessionsFailed(query, result.error, provider));
  }
}

export function* importableSessionsSaga(): SagaGenerator<void> {
  yield* takeLatest(importableSessionsRequested, requestWorker);
}
