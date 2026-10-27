import { store } from '../../store';
import type { WorkspaceEvent } from '$features/events/types';
import { emptyWorkspaceEventsState } from './workspace-events-slice';
import { getPeopleActivity } from '$features/presence/components/people-activity';
import { selectWorkspacePeopleIdentities } from '../presence/presence-selectors';
import { selectWorkspaceById } from '../workspace/workspace-selectors';

export const selectDaemonEventsSubscriptionAttempt = store.createSelector(
  (state) => state.workspaceEvents.subscriptionAttempt,
);

/** `0` until the daemon-events firehose is live; +1 per (re)subscription. */
export const selectDaemonEventsSubscriptionGeneration = store.createSelector<[], number>(
  (state) => state.workspaceEvents.subscriptionGeneration,
);

export const selectWorkspaceEvents = store.createSelector<[workspaceId: string], WorkspaceEvent[]>(
  (state, workspaceId) => {
    return (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState).events;
  },
);

export const selectEventsLoading = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => {
    return (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState).loading;
  },
);

export const selectOlderEventsNextToken = store.createSelector<
  [workspaceId: string],
  string | null
>((state, workspaceId) => {
  return (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState).nextToken;
});

export const selectOlderEventsLoading = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => {
    return (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState)
      .loadingOlder;
  },
);

export const selectOlderEventsError = store.createSelector<[workspaceId: string], string | null>(
  (state, workspaceId) => {
    return (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState)
      .olderError;
  },
);

export const selectOlderEventsEndReached = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => {
    return (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState)
      .endReached;
  },
);

export const selectPeopleEventsLoading = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) =>
    (state.workspaceEvents.byWorkspaceId[workspaceId]?.peopleRequestId ?? null) !== null,
);

export const selectPeopleEventsError = store.createSelector<[workspaceId: string], string | null>(
  (state, workspaceId) => state.workspaceEvents.byWorkspaceId[workspaceId]?.peopleError ?? null,
);

export const selectPeopleEventsInitialized = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) =>
    state.workspaceEvents.byWorkspaceId[workspaceId]?.peopleInitialized ?? false,
);

export const selectPeopleEventsStreams = store.createSelector(
  (state, workspaceId: string) =>
    (state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState).peopleStreams,
);
export const selectPeopleEventsEndReached = store.createSelector((state, workspaceId: string) =>
  Object.values(selectPeopleEventsStreams.select(state, workspaceId)).every(
    (stream) => stream.initialized && stream.nextToken === null,
  ),
);

/** A row target is complete only after both filtered histories reach its oldest timestamp. */
export const selectPeopleEventsStreamsToRead = store.createSelector(
  (state, workspaceId: string, target: number) => {
    const events = selectWorkspaceEvents.select(state, workspaceId);
    const rows = getPeopleActivity(
      workspaceId,
      events,
      selectWorkspacePeopleIdentities.select(state, workspaceId),
      selectWorkspaceById.select(state, workspaceId)?.ownerPrincipalId,
    );
    const cutoff = rows[target - 1]?.timestamp;
    const cursors = selectPeopleEventsStreams.select(state, workspaceId);
    return (['user', 'message'] as const).filter((key) => {
      const cursor = cursors[key];
      if (!cursor.initialized) return true;
      if (cursor.nextToken === null) return false;
      const oldest = events.find((event) => event.id === cursor.oldestEventId)?.timestamp;
      return !cutoff || !oldest || !(Date.parse(oldest) <= Date.parse(cutoff));
    });
  },
);
