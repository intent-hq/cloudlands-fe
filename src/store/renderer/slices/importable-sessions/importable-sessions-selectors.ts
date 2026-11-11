import { store } from '../../store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { ImportableSessionProvider } from '$features/session-import/importable-session';
import type { ImportableSessionRow, ImportableSessionsStatus } from './importable-sessions-slice';

// Partial-state stores (form test harnesses) may omit the slice; read it optionally.

/** Newest-first rows of the last loaded page. */
export const selectImportableSessions = store.createSelector((state): ImportableSessionRow[] => {
  const sessions = state.importableSessions?.sessions;
  return sessions ? getItems(sessions) : [];
});

/** Providers the daemon listed, in its order. */
export const selectImportableSessionProviders = store.createSelector(
  (state): ImportableSessionProvider[] => {
    const providers = state.importableSessions?.providers;
    return providers ? getItems(providers) : [];
  },
);

export const selectImportableSessionsStatus = store.createSelector(
  (state): ImportableSessionsStatus => state.importableSessions?.status ?? 'idle',
);

/**
 * Whether New Workspace offers "Import a session": the daemon supports the
 * method and has sessions (or a provider failed to list), or the first page
 * failed and can be retried.
 */
export const selectImportableSessionsAvailable = store.createSelector((state): boolean => {
  const slice = state.importableSessions;
  if (!slice || slice.status === 'unsupported') return false;
  return slice.hasAny || (slice.status === 'error' && slice.query === '' && slice.provider === '');
});
