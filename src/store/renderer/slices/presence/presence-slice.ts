/**
 * Presence Slice (multiplayer w5)
 *
 * Rosters mirrored from `presence:changed` / `presence.snapshot`, the
 * receiver-local typing expiry bookkeeping, and this window's own presence
 * inputs (typing target, visibility, identity). The saga owns the timers and
 * the `presence:report` sends; see `sagas/presence-saga.ts`.
 */

import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { PresenceRoster } from '$shared/types/presence';
import type { WorkspaceMember } from '../guest-sessions/guest-sessions-types';
import type { LiveTypingEntry, PresenceState } from './presence-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: PresenceState = {
  rosters: {},
  members: {},
  liveTyping: {},
  ownPrincipalId: null,
  ownTypingSource: null,
  ownTyping: null,
  windowVisible: true,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A pushed `presence:changed` event — a full roster replacement, newer than any read in flight. */
export const presenceRosterReceived =
  createAction<[roster: PresenceRoster]>('presence/rosterReceived');

/** A `presence.snapshot` result the saga has fenced as current — the same full replacement. */
export const presenceSnapshotReceived = createAction<[roster: PresenceRoster]>(
  'presence/snapshotReceived',
);

/** A `workspace.members.list` result the saga has fenced as current — a full replacement. */
export const presenceMembersReceived = createAction<
  [workspaceId: string, members: WorkspaceMember[]]
>('presence/membersReceived');

/** The 3 s receiver-local timer of a `(source, pulse)` pair ran out. */
export const presenceTypingExpired =
  createAction<[workspaceId: string, source: string, pulse: number]>('presence/typingExpired');

/** The composer produced input for an agent (one pulse per keystroke burst). */
export const presenceTypingPulse = createAction<[agentId: string]>('presence/typingPulse');

/** The composer went idle, was cleared, or sent. */
export const presenceTypingStopped = createAction('presence/typingStopped');

export const presenceWindowVisibilityChanged = createAction<[visible: boolean]>(
  'presence/windowVisibilityChanged',
);

/** `principal.me` of the window's backend (`null` when the daemon has none). */
export const presenceOwnPrincipalReceived = createAction<[principalId: string | null]>(
  'presence/ownPrincipalReceived',
);

/** The connection's `typingSource` from the last `presence:report` reply. */
export const presenceOwnTypingSourceReceived = createAction<[source: string | null]>(
  'presence/ownTypingSourceReceived',
);

/** The window moved to another backend: every roster and identity is stale. */
export const presenceReset = createAction('presence/reset');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const presenceReducer = createReducer<PresenceState>(initialState);

function foldLiveTyping(
  previous: Record<string, LiveTypingEntry> | undefined,
  roster: PresenceRoster,
): Record<string, LiveTypingEntry> {
  const next: Record<string, LiveTypingEntry> = {};
  for (const member of roster.members) {
    for (const entry of member.typing) {
      const seen = previous?.[entry.source];
      next[entry.source] =
        seen && seen.pulse === entry.pulse && seen.agentId === entry.agentId
          ? seen
          : {
              principalId: member.principalId,
              agentId: entry.agentId,
              pulse: entry.pulse,
              expired: false,
            };
    }
  }
  return next;
}

function replaceRoster(state: PresenceState, roster: PresenceRoster): PresenceState {
  return {
    ...state,
    rosters: {
      ...state.rosters,
      [roster.workspaceId]: createCollection('principalId', roster.members),
    },
    liveTyping: {
      ...state.liveTyping,
      [roster.workspaceId]: foldLiveTyping(state.liveTyping[roster.workspaceId], roster),
    },
  };
}

presenceReducer.with(presenceRosterReceived, (state, { payload: [roster] }) =>
  replaceRoster(state, roster),
);

presenceReducer.with(presenceSnapshotReceived, (state, { payload: [roster] }) =>
  replaceRoster(state, roster),
);

presenceReducer.with(presenceMembersReceived, (state, { payload: [workspaceId, members] }) => ({
  ...state,
  members: { ...state.members, [workspaceId]: createCollection('principalId', members) },
}));

presenceReducer.with(presenceTypingExpired, (state, { payload: [workspaceId, source, pulse] }) => {
  const entry = state.liveTyping[workspaceId]?.[source];
  if (!entry || entry.pulse !== pulse || entry.expired) return state;
  return {
    ...state,
    liveTyping: {
      ...state.liveTyping,
      [workspaceId]: { ...state.liveTyping[workspaceId], [source]: { ...entry, expired: true } },
    },
  };
});

presenceReducer.with(presenceTypingPulse, (state, { payload: [agentId] }) =>
  state.ownTyping?.agentId === agentId ? state : { ...state, ownTyping: { agentId } },
);

presenceReducer.with(presenceTypingStopped, (state) =>
  state.ownTyping === null ? state : { ...state, ownTyping: null },
);

presenceReducer.with(presenceWindowVisibilityChanged, (state, { payload: [visible] }) =>
  state.windowVisible === visible ? state : { ...state, windowVisible: visible },
);

presenceReducer.with(presenceOwnPrincipalReceived, (state, { payload: [principalId] }) => ({
  ...state,
  ownPrincipalId: principalId,
}));

presenceReducer.with(presenceOwnTypingSourceReceived, (state, { payload: [source] }) =>
  state.ownTypingSource === source ? state : { ...state, ownTypingSource: source },
);

presenceReducer.with(presenceReset, (state) => ({
  ...initialState,
  windowVisible: state.windowVisible,
}));
