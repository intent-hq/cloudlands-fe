import { all, call, put, takeEvery, throttle, type SagaGenerator } from 'typed-redux-saga';

import { SemanticMapClient } from '$lib/components/visualization/semantic-map/core/client';
import { createLogger } from '$lib/utils/client-logger';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
} from '../../workspace-notes/workspace-notes-slice';
import { selectAllNotes } from '../../workspace-notes/workspace-notes-selectors';
import { selectSemanticMapState } from '../semantic-map-selectors';
import {
  semanticMapActivityReceived,
  semanticMapCleared,
  semanticMapHydrated,
  semanticMapLoadFailed,
  semanticMapLoadStarted,
  semanticMapRefreshRequested,
  semanticMapRouteLoaded,
  semanticMapRouteRefreshRequested,
  type SemanticMapRouteSubject,
  semanticMapSelectedAgentChanged,
  semanticMapSelectedTaskChanged,
} from '../semantic-map-slice';

const logger = createLogger('SemanticMapSaga');
const client = new SemanticMapClient();

type MapReadAction =
  ReturnType<typeof workspaceMounted> | ReturnType<typeof semanticMapRefreshRequested>;
type MapContextAction = MapReadAction | ReturnType<typeof workspaceUnmounted>;
type RouteContextAction =
  ReturnType<typeof semanticMapRouteRefreshRequested> | ReturnType<typeof workspaceUnmounted>;
type GenerationCoordinator = Map<string, number>;
type RequestGenerations<Action extends object> = WeakMap<Action, number>;
type ManifestNoteAction =
  | ReturnType<typeof applyNoteCreated>
  | ReturnType<typeof applyNoteDeleted>
  | ReturnType<typeof applyNoteUpdated>;
type TaggedManifestNotes = Map<string, Set<string>>;

function mapContext(
  generations: GenerationCoordinator,
  requests: RequestGenerations<MapReadAction>,
  action: MapContextAction,
) {
  const [workspaceId] = action.payload;
  if (action.type === workspaceUnmounted.type) {
    generations.set(workspaceId, (generations.get(workspaceId) ?? 0) + 1);
    return { context: workspaceId, cancel: true as const };
  }
  const generation =
    action.type === workspaceMounted.type
      ? (generations.get(workspaceId) ?? 0) + 1
      : generations.get(workspaceId);
  if (generation === undefined) return { context: workspaceId, cancel: true as const };
  generations.set(workspaceId, generation);
  requests.set(action, generation);
  return workspaceId;
}

function* readMapWorker(
  requests: RequestGenerations<MapReadAction>,
  taggedManifestNotes: TaggedManifestNotes,
  action: MapReadAction,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const generation = requests.get(action);
  if (generation === undefined) return;
  const notes = yield* selectAllNotes.effect(workspaceId);
  taggedManifestNotes.set(
    workspaceId,
    new Set(
      notes.filter((note) => note.tags.includes('semantic-map')).map((note) => String(note.id)),
    ),
  );
  const state = yield* selectSemanticMapState.effect(workspaceId);
  const baselineActivityIds = state.activities.map((activity) => activity.id);
  yield* put(semanticMapLoadStarted(workspaceId, generation));
  try {
    const snapshot: Awaited<ReturnType<SemanticMapClient['get']>> = yield* call(
      [client, client.get],
      workspaceId,
    );
    const activities: Awaited<ReturnType<SemanticMapClient['activity']>> = yield* call(
      [client, client.activity],
      workspaceId,
      { minutesAgo: 60 },
    );
    yield* put(
      semanticMapHydrated(
        workspaceId,
        generation,
        snapshot.manifest,
        snapshot.source,
        activities,
        baselineActivityIds,
      ),
    );
    const hydratedState = yield* selectSemanticMapState.effect(workspaceId);
    if (hydratedState.selectedAgentId || hydratedState.selectedTaskNoteId) {
      yield* put(semanticMapRouteRefreshRequested(workspaceId));
    }
  } catch (error) {
    yield* put(semanticMapLoadFailed(workspaceId, generation));
    logger.warn('Semantic map hydration failed', { workspaceId, error });
  }
}

function* refreshTaggedManifest(
  taggedManifestNotes: TaggedManifestNotes,
  action: ManifestNoteAction,
) {
  const [workspaceId, noteOrId, updatedNote] = action.payload;
  const note = action.type === applyNoteCreated.type ? noteOrId : updatedNote;
  const noteId =
    action.type === applyNoteCreated.type && typeof note === 'object' && note !== null
      ? String(note.id)
      : String(noteOrId);
  const wasSeeded = taggedManifestNotes.has(workspaceId);
  const taggedNoteIds = taggedManifestNotes.get(workspaceId) ?? new Set<string>();
  const wasTagged = taggedNoteIds.has(noteId);
  const isTagged = typeof note === 'object' && note !== null && note.tags.includes('semantic-map');
  if (isTagged) taggedNoteIds.add(noteId);
  else taggedNoteIds.delete(noteId);
  taggedManifestNotes.set(workspaceId, taggedNoteIds);
  if (!wasTagged && !isTagged && (wasSeeded || action.type !== applyNoteDeleted.type)) return;
  yield* put(semanticMapRefreshRequested(workspaceId));
}

function forgetTaggedManifestNotes(
  taggedManifestNotes: TaggedManifestNotes,
  action: ReturnType<typeof workspaceUnmounted>,
): void {
  taggedManifestNotes.delete(action.payload[0]);
}

function* requestRouteRefresh(
  action:
    | ReturnType<typeof semanticMapSelectedAgentChanged>
    | ReturnType<typeof semanticMapSelectedTaskChanged>
    | ReturnType<typeof semanticMapActivityReceived>,
) {
  yield* put(semanticMapRouteRefreshRequested(action.payload[0]));
}

function routeContext(
  generations: GenerationCoordinator,
  requests: RequestGenerations<ReturnType<typeof semanticMapRouteRefreshRequested>>,
  action: RouteContextAction,
) {
  const [workspaceId] = action.payload;
  if (action.type === workspaceUnmounted.type) {
    return { context: workspaceId, cancel: true as const };
  }
  const generation = generations.get(workspaceId);
  if (generation === undefined) return { context: workspaceId, cancel: true as const };
  requests.set(action, generation);
  return workspaceId;
}

function* readRouteWorker(
  generations: GenerationCoordinator,
  requests: RequestGenerations<ReturnType<typeof semanticMapRouteRefreshRequested>>,
  action: ReturnType<typeof semanticMapRouteRefreshRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const generation = requests.get(action);
  if (generation === undefined) return;
  const state = yield* selectSemanticMapState.effect(workspaceId);
  const subject: SemanticMapRouteSubject | null = state.selectedAgentId
    ? { agentId: state.selectedAgentId }
    : state.selectedTaskNoteId
      ? { taskNoteId: state.selectedTaskNoteId }
      : null;
  if (!subject) {
    return;
  }
  try {
    const route: Awaited<ReturnType<SemanticMapClient['route']>> = yield* call(
      [client, client.route],
      workspaceId,
      subject,
    );
    const current = yield* selectSemanticMapState.effect(workspaceId);
    const subjectIsCurrent =
      'agentId' in subject
        ? current.selectedAgentId === subject.agentId && current.selectedTaskNoteId === null
        : current.selectedTaskNoteId === subject.taskNoteId && current.selectedAgentId === null;
    if (generations.get(workspaceId) === generation && subjectIsCurrent) {
      yield* put(semanticMapRouteLoaded(workspaceId, generation, subject, route));
    }
  } catch (error) {
    logger.warn('Semantic map route refresh failed', { workspaceId, error });
  }
}

function* clearWorkspace(action: ReturnType<typeof workspaceUnmounted>) {
  yield* put(semanticMapCleared(action.payload[0]));
}

export function* semanticMapSaga() {
  const generations: GenerationCoordinator = new Map();
  const taggedManifestNotes: TaggedManifestNotes = new Map();
  const mapRequests: RequestGenerations<MapReadAction> = new WeakMap();
  const routeRequests: RequestGenerations<ReturnType<typeof semanticMapRouteRefreshRequested>> =
    new WeakMap();
  yield* all([
    takeSingleFlightInContext(
      [workspaceMounted, semanticMapRefreshRequested, workspaceUnmounted],
      (action: MapContextAction) => mapContext(generations, mapRequests, action),
      readMapWorker,
      mapRequests,
      taggedManifestNotes,
    ),
    takeEvery(
      [applyNoteCreated, applyNoteUpdated, applyNoteDeleted],
      refreshTaggedManifest,
      taggedManifestNotes,
    ),
    takeEvery(
      [semanticMapSelectedAgentChanged, semanticMapSelectedTaskChanged],
      requestRouteRefresh,
    ),
    throttle(1_000, semanticMapActivityReceived, requestRouteRefresh),
    takeSingleFlightInContext(
      [semanticMapRouteRefreshRequested, workspaceUnmounted],
      (action: RouteContextAction) => routeContext(generations, routeRequests, action),
      readRouteWorker,
      generations,
      routeRequests,
    ),
    takeEvery(workspaceUnmounted, forgetTaggedManifestNotes, taggedManifestNotes),
    takeEvery(workspaceUnmounted, clearWorkspace),
  ]);
}
