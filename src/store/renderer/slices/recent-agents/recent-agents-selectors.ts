import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { visibleRecentAgents, type RecentAgentEntry } from '$shared/recent-agents';
import { resolveShortcut } from '$shared/keyboard-shortcut-bindings';
import { store } from '../../store';

/**
 * The recent agents the switcher offers: entries of connections that are still saved (a
 * forgotten device or ended guest session drops out). Before the connection list loads,
 * every entry.
 */
export const selectRecentAgents = store.createSelector((state): RecentAgentEntry[] => {
  const entries = getItems(state.recentAgents.entries).map(
    ({ key: _key, ...entry }): RecentAgentEntry => entry,
  );
  if (!state.connections.hasReceivedList) return entries;
  const saved = new Set<string>([
    state.connections.windowBackendId,
    ...getItems(state.connections.connections)
      .filter((connection) => !connection.displayOnly)
      .map((connection) => connection.id),
    ...getItems(state.guestSessions.sessions).map((session) => session.id),
  ]);
  return visibleRecentAgents(entries, saved);
});

/** The switcher's effective binding (the user's, else this platform's default). */
export const selectRecentAgentsBinding = store.createSelector((state): string =>
  resolveShortcut('navigation.recent-agents', state.userPreferences?.shortcutOverrides ?? {}),
);
