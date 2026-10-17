import { DEFAULT_DISCUSSION_ID } from '$shared/types/workspace-discussion';
/**
 * Presence Slice (multiplayer w5)
 *
 * Rosters mirrored from `presence:changed` / `presence.snapshot`, the
 * receiver-local typing expiry bookkeeping, and this window's own presence
 * inputs (typing target, visibility, identity). The saga owns the timers and
 * the `presence:report` sends; see `sagas/presence-saga.ts`.
 */

import {
  createCollection,
  getItem,
  updateItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { effectivePresenceRows, type PresenceRoster } from '$shared/types/presence';
import type { WorkspaceMember } from '../guest-sessions/guest-sessions-types';
import type {
  LiveTypingEntry,
  LiveDiscussionTypingEntry,
  PresenceIdentity,
  PresenceState,
} from './presence-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: PresenceState = {
  context: null,
  workspaceIds: [],
  rosters: {},
  members: {},
  profileRevision: 0,
  profileUpdates: {},
  liveTyping: {},
  ownPrincipalId: null,
  ownTypingSource: null,
  ownTyping: null,
  ownDiscussionTyping: null,
  discussionComposerWorkspaceId: null,
  discussionComposerConversationId: DEFAULT_DISCUSSION_ID,
  liveDiscussionTyping: {},
  windowVisible: true,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const presenceContextReceived = createAction<[context: string, principalId: string]>(
  'presence/contextReceived',
);
export const presenceWorkspacesReceived = createAction<[workspaceIds: string[]]>(
  'presence/workspacesReceived',
);
export const presenceWorkspaceRemoved = createAction<[workspaceId: string]>(
  'presence/workspaceRemoved',
);

/** A pushed `presence:changed` event — a full roster replacement, newer than any read in flight. */
export const presenceRosterReceived =
  createAction<[roster: PresenceRoster]>('presence/rosterReceived');

/** An authorized workspace:updated delta explicitly changed accepted membership. */
export const presenceMembershipChanged = createAction<[workspaceId: string]>(
  'presence/membershipChanged',
);

/** A `presence.snapshot` result the saga has fenced as current — the same full replacement. */
export const presenceSnapshotReceived = createAction<[roster: PresenceRoster]>(
  'presence/snapshotReceived',
);

/** A `workspace.members.list` result the saga has fenced as current — a full replacement. */
export const presenceMembersReceived = createAction<
  [workspaceId: string, members: WorkspaceMember[], startedProfileRevision?: number]
>('presence/membersReceived');

/** The 3 s receiver-local timer of a `(source, pulse)` pair ran out. */
export const presenceTypingExpired =
  createAction<[workspaceId: string, source: string, pulse: number]>('presence/typingExpired');

/** The composer produced input for an agent (one pulse per keystroke burst). */
export const presenceTypingPulse = createAction<[agentId: string]>('presence/typingPulse');

/** The composer went idle, was cleared, or sent. */
export const presenceTypingStopped = createAction('presence/typingStopped');

export const presenceDiscussionComposerFocused = createAction<
  [workspaceId: string, focused: boolean, conversationId?: string]
>('presence/discussionComposerFocused');
export const presenceDiscussionTypingPulse = createAction<
  [workspaceId: string, conversationId?: string]
>('presence/discussionTypingPulse');
export const presenceDiscussionTypingStopped = createAction<
  [workspaceId: string, conversationId?: string]
>('presence/discussionTypingStopped');
export const presenceDiscussionTypingExpired = createAction<
  [workspaceId: string, source: string, pulse: number, conversationId?: string]
>('presence/discussionTypingExpired');

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

function foldDiscussionTyping(
  previous: Record<string, LiveDiscussionTypingEntry> | undefined,
  roster: PresenceRoster,
): Record<string, LiveDiscussionTypingEntry> {
  const next: Record<string, LiveDiscussionTypingEntry> = {};
  for (const member of roster.members) {
    for (const entry of member.discussionTyping ?? []) {
      const seen = previous?.[entry.source];
      next[entry.source] =
        seen &&
        seen.pulse === entry.pulse &&
        seen.principalId === member.principalId &&
        seen.conversationId === (entry.conversationId ?? DEFAULT_DISCUSSION_ID)
          ? seen
          : {
              principalId: member.principalId,
              pulse: entry.pulse,
              expired: false,
              conversationId: entry.conversationId ?? DEFAULT_DISCUSSION_ID,
            };
    }
  }
  return next;
}

function profileFields(online: PresenceIdentity): PresenceIdentity {
  return {
    principalId: online.principalId,
    login: online.login,
    displayName: online.displayName,
    avatarUrl: online.avatarUrl,
    ...(online.hostRole ? { hostRole: online.hostRole } : {}),
    ...(online.identity ? { identity: online.identity } : {}),
  };
}

function replaceRoster(
  state: PresenceState,
  roster: PresenceRoster,
  pushed = false,
): PresenceState {
  if (!state.context || !state.workspaceIds.includes(roster.workspaceId)) return state;
  const onlineMembers = effectivePresenceRows(roster.members);
  const profileRevision = state.profileRevision + (pushed ? 1 : 0);
  let profileUpdates = state.profileUpdates;
  if (pushed) {
    const updates = { ...profileUpdates[roster.workspaceId] };
    for (const online of onlineMembers)
      updates[online.principalId] = { revision: profileRevision, profile: profileFields(online) };
    profileUpdates = { ...profileUpdates, [roster.workspaceId]: updates };
  }
  // Online profile fields are authoritative for accepted people too (mentions
  // and offline avatars). Never invent a membership or copy transient typing.
  let members = state.members[roster.workspaceId];
  if (members) {
    for (const online of onlineMembers) {
      const member = getItem(members, online.principalId);
      if (!member) continue;
      const next = {
        ...member,
        ...profileFields(online),
      };
      if (JSON.stringify(next) !== JSON.stringify(member)) members = updateItem(members, next);
    }
  }
  return {
    ...state,
    profileRevision,
    profileUpdates,
    members:
      members && members !== state.members[roster.workspaceId]
        ? { ...state.members, [roster.workspaceId]: members }
        : state.members,
    rosters: {
      ...state.rosters,
      [roster.workspaceId]: createCollection('principalId', onlineMembers),
    },
    liveDiscussionTyping: {
      ...state.liveDiscussionTyping,
      [roster.workspaceId]: foldDiscussionTyping(
        state.liveDiscussionTyping[roster.workspaceId],
        roster,
      ),
    },
    liveTyping: {
      ...state.liveTyping,
      [roster.workspaceId]: foldLiveTyping(state.liveTyping[roster.workspaceId], roster),
    },
  };
}

presenceReducer.with(presenceRosterReceived, (state, { payload: [roster] }) =>
  replaceRoster(state, roster, true),
);

presenceReducer.with(presenceSnapshotReceived, (state, { payload: [roster] }) =>
  replaceRoster(state, roster),
);

presenceReducer.with(
  presenceMembersReceived,
  (state, { payload: [workspaceId, members, startedProfileRevision] }) => {
    if (!state.context || !state.workspaceIds.includes(workspaceId)) return state;
    const updates = state.profileUpdates[workspaceId] ?? {};
    const accepted = effectivePresenceRows(members).map((member) => {
      const update = updates[member.principalId];
      // Only pushes received after this request started can supersede its profile.
      // Membership inclusion, role and addedAt still come from the accepted reply.
      return update &&
        startedProfileRevision !== undefined &&
        update.revision > startedProfileRevision
        ? { ...member, ...update.profile }
        : member;
    });
    const acceptedIds = new Set(accepted.map((member) => member.principalId));
    return {
      ...state,
      members: { ...state.members, [workspaceId]: createCollection('principalId', accepted) },
      profileUpdates: {
        ...state.profileUpdates,
        [workspaceId]: Object.fromEntries(
          Object.entries(updates).filter(([id]) => acceptedIds.has(id)),
        ),
      },
    };
  },
);

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

presenceReducer.with(
  presenceDiscussionComposerFocused,
  (state, { payload: [workspaceId, focused, conversationId = DEFAULT_DISCUSSION_ID] }) => {
    if (focused)
      return state.context && state.windowVisible && state.workspaceIds.includes(workspaceId)
        ? {
            ...state,
            discussionComposerWorkspaceId: workspaceId,
            discussionComposerConversationId: conversationId,
            ownDiscussionTyping:
              state.ownDiscussionTyping?.workspaceId === workspaceId &&
              (state.ownDiscussionTyping.conversationId ?? DEFAULT_DISCUSSION_ID) === conversationId
                ? state.ownDiscussionTyping
                : null,
          }
        : state;
    return state.discussionComposerWorkspaceId === workspaceId &&
      state.discussionComposerConversationId === conversationId
      ? { ...state, discussionComposerWorkspaceId: null, ownDiscussionTyping: null }
      : state;
  },
);
presenceReducer.with(
  presenceDiscussionTypingPulse,
  (state, { payload: [workspaceId, conversationId = DEFAULT_DISCUSSION_ID] }) =>
    state.context &&
    state.windowVisible &&
    state.discussionComposerWorkspaceId === workspaceId &&
    state.discussionComposerConversationId === conversationId &&
    state.workspaceIds.includes(workspaceId) &&
    (state.ownDiscussionTyping?.workspaceId !== workspaceId ||
      (state.ownDiscussionTyping?.conversationId ?? DEFAULT_DISCUSSION_ID) !== conversationId)
      ? {
          ...state,
          ownDiscussionTyping: {
            workspaceId,
            ...(conversationId !== DEFAULT_DISCUSSION_ID ? { conversationId } : {}),
          },
        }
      : state,
);
presenceReducer.with(
  presenceDiscussionTypingStopped,
  (state, { payload: [workspaceId, conversationId = DEFAULT_DISCUSSION_ID] }) =>
    state.ownDiscussionTyping?.workspaceId === workspaceId &&
    (state.ownDiscussionTyping.conversationId ?? DEFAULT_DISCUSSION_ID) === conversationId
      ? { ...state, ownDiscussionTyping: null }
      : state,
);
presenceReducer.with(
  presenceDiscussionTypingExpired,
  (state, { payload: [workspaceId, source, pulse, conversationId = DEFAULT_DISCUSSION_ID] }) => {
    const entry = state.liveDiscussionTyping[workspaceId]?.[source];
    if (!entry || entry.pulse !== pulse || entry.expired || entry.conversationId !== conversationId)
      return state;
    return {
      ...state,
      liveDiscussionTyping: {
        ...state.liveDiscussionTyping,
        [workspaceId]: {
          ...state.liveDiscussionTyping[workspaceId],
          [source]: { ...entry, expired: true },
        },
      },
    };
  },
);

presenceReducer.with(presenceWindowVisibilityChanged, (state, { payload: [visible] }) =>
  state.windowVisible === visible
    ? state
    : {
        ...state,
        windowVisible: visible,
        ...(!visible ? { ownDiscussionTyping: null, discussionComposerWorkspaceId: null } : {}),
      },
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

presenceReducer.with(presenceContextReceived, (state, { payload: [context, ownPrincipalId] }) => ({
  ...initialState,
  windowVisible: state.windowVisible,
  context,
  ownPrincipalId,
}));
presenceReducer.with(presenceWorkspaceRemoved, (state, { payload: [workspaceId] }) => {
  const rosters = { ...state.rosters };
  const members = { ...state.members };
  const profileUpdates = { ...state.profileUpdates };
  const liveTyping = { ...state.liveTyping };
  const liveDiscussionTyping = { ...state.liveDiscussionTyping };
  delete rosters[workspaceId];
  delete members[workspaceId];
  delete profileUpdates[workspaceId];
  delete liveTyping[workspaceId];
  delete liveDiscussionTyping[workspaceId];
  return {
    ...state,
    rosters,
    members,
    profileUpdates,
    liveTyping,
    liveDiscussionTyping,
    ownDiscussionTyping:
      state.ownDiscussionTyping?.workspaceId === workspaceId ? null : state.ownDiscussionTyping,
    discussionComposerWorkspaceId:
      state.discussionComposerWorkspaceId === workspaceId
        ? null
        : state.discussionComposerWorkspaceId,
  };
});

presenceReducer.with(presenceWorkspacesReceived, (state, { payload: [workspaceIds] }) => {
  const keep = <T>(rows: Record<string, T>) =>
    Object.fromEntries(Object.entries(rows).filter(([id]) => workspaceIds.includes(id)));
  return {
    ...state,
    workspaceIds,
    rosters: keep(state.rosters),
    members: keep(state.members),
    profileUpdates: keep(state.profileUpdates),
    liveTyping: keep(state.liveTyping),
    liveDiscussionTyping: keep(state.liveDiscussionTyping),
    ownDiscussionTyping:
      state.ownDiscussionTyping && workspaceIds.includes(state.ownDiscussionTyping.workspaceId)
        ? state.ownDiscussionTyping
        : null,
    discussionComposerWorkspaceId:
      state.discussionComposerWorkspaceId &&
      workspaceIds.includes(state.discussionComposerWorkspaceId)
        ? state.discussionComposerWorkspaceId
        : null,
  };
});
