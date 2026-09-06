import { all, call, put, takeEvery, throttle } from 'typed-redux-saga';

import { SemanticMapClient } from '$lib/components/visualization/semantic-map/core/client';
import { createLogger } from '$lib/utils/client-logger';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { applyNoteCreated, applyNoteUpdated } from '../../workspace-notes/workspace-notes-slice';
import { selectSemanticMapState } from '../semantic-map-selectors';
import {
  semanticMapActivitiesLoaded,
  semanticMapActivityReceived,
  semanticMapCleared,
  semanticMapLoadFailed,
  semanticMapLoadStarted,
  semanticMapLoaded,
  semanticMapRefreshRequested,
  semanticMapRouteLoaded,
  semanticMapRouteRefreshRequested,
  semanticMapSelectedAgentChanged,
  semanticMapSelectedTaskChanged,
} from '../semantic-map-slice';

const logger = createLogger('SemanticMapSaga');
const client = new SemanticMapClient();

type MapReadAction =
  ReturnType<typeof workspaceMounted> | ReturnType<typeof semanticMapRefreshRequested>;

function* readMapWorker(action: MapReadAction) {
  const [workspaceId] = action.payload;
  yield* put(semanticMapLoadStarted(workspaceId));
  try {
    const snapshot: Awaited<ReturnType<SemanticMapClient['get']>> = yield* call(
      [client, client.get],
      workspaceId,
    );
    yield* put(semanticMapLoaded(workspaceId, snapshot.manifest, snapshot.source));
    if (action.type === workspaceMounted.type) {
      const activities: Awaited<ReturnType<SemanticMapClient['activity']>> = yield* call(
        [client, client.activity],
        workspaceId,
        { minutesAgo: 60 },
      );
      yield* put(semanticMapActivitiesLoaded(workspaceId, activities));
    }
  } catch (error) {
    yield* put(semanticMapLoadFailed(workspaceId));
    logger.warn('Semantic map hydration failed', { workspaceId, error });
  }
}

function* refreshTaggedManifest(
  action: ReturnType<typeof applyNoteCreated> | ReturnType<typeof applyNoteUpdated>,
) {
  const [workspaceId, noteOrId, updatedNote] = action.payload;
  const note = action.type === applyNoteCreated.type ? noteOrId : updatedNote;
  if (typeof note !== 'object' || note === null || !note.tags.includes('semantic-map')) return;
  yield* put(semanticMapRefreshRequested(workspaceId));
}

function* requestRouteRefresh(
  action:
    | ReturnType<typeof semanticMapSelectedAgentChanged>
    | ReturnType<typeof semanticMapSelectedTaskChanged>
    | ReturnType<typeof semanticMapActivityReceived>,
) {
  yield* put(semanticMapRouteRefreshRequested(action.payload[0]));
}

function* readRouteWorker(action: ReturnType<typeof semanticMapRouteRefreshRequested>) {
  const [workspaceId] = action.payload;
  const state = yield* selectSemanticMapState.effect(workspaceId);
  const subject = state.selectedAgentId
    ? { agentId: state.selectedAgentId }
    : state.selectedTaskNoteId
      ? { taskNoteId: state.selectedTaskNoteId }
      : null;
  if (!subject) {
    yield* put(semanticMapRouteLoaded(workspaceId, null));
    return;
  }
  try {
    const route: Awaited<ReturnType<SemanticMapClient['route']>> = yield* call(
      [client, client.route],
      workspaceId,
      subject,
    );
    yield* put(semanticMapRouteLoaded(workspaceId, route));
  } catch (error) {
    logger.warn('Semantic map route refresh failed', { workspaceId, error });
  }
}

function* clearWorkspace(action: ReturnType<typeof workspaceUnmounted>) {
  yield* put(semanticMapCleared(action.payload[0]));
}

export function* semanticMapSaga() {
  yield* all([
    takeSingleFlightInContext(
      [workspaceMounted, semanticMapRefreshRequested],
      (action: MapReadAction) => action.payload[0],
      readMapWorker,
    ),
    takeEvery([applyNoteCreated, applyNoteUpdated], refreshTaggedManifest),
    takeEvery(
      [semanticMapSelectedAgentChanged, semanticMapSelectedTaskChanged],
      requestRouteRefresh,
    ),
    throttle(1_000, semanticMapActivityReceived, requestRouteRefresh),
    takeSingleFlightInContext(
      semanticMapRouteRefreshRequested,
      (action) => action.payload[0],
      readRouteWorker,
    ),
    takeEvery(workspaceUnmounted, clearWorkspace),
  ]);
}
