/**
 * Recent Agents Slice
 *
 * A read-through view of the app-wide recent-agent list that main owns. Main's
 * reply or push is the only thing that changes it; the renderer reports visits
 * and asks to open an entry, and the saga carries both.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { RecentAgentEntry } from '$shared/recent-agents';

export interface RecentAgentsSliceState {
  entries: RecentAgentEntry[];
}

const initialState: RecentAgentsSliceState = { entries: [] };

/** The list from `recent-agents:list`, a request reply, or a `recent-agents:changed` push. */
export const recentAgentsReceived =
  createAction<[entries: RecentAgentEntry[]]>('recentAgents/received');

/** Open an entry from the switcher: its connection, then its workspace and agent. */
export const recentAgentOpenRequested = createAction<[entry: RecentAgentEntry]>(
  'recentAgents/openRequested',
);

export const recentAgentsReducer = createReducer<RecentAgentsSliceState>(initialState);
recentAgentsReducer.with(recentAgentsReceived, (_state, { payload: [entries] }) => ({
  entries: [...entries],
}));
