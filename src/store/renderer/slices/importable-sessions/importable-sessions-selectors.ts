import { store } from '../../store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { ImportableSessionProvider } from '$features/session-import/importable-session';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';
import type { ImportableSessionRow, ImportableSessionsStatus } from './importable-sessions-slice';

// Partial-state stores (form test harnesses) may omit the slice; read it optionally.

/** The host advertises session import (`server.capabilities.sessionImport === 1`). */
export const selectSessionImportSupported = store.createSelector(
  (state): boolean => selectPrincipalSnapshot.select(state)?.capabilities.sessionImport === 1,
);

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
