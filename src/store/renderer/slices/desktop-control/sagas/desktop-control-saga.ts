import { call, delay, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { desktopClient } from '$features/desktop/renderer/desktop-client';
import {
  dismissDesktopPrompt,
  showDesktopPrompt,
  showDesktopStarted,
  showDesktopError,
} from '$features/desktop/renderer/desktop-notifications';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { workspaceBrowserClientReceived } from '../../browser-clients/browser-clients-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  daemonEventsSubscribed,
  daemonEventsSubscribing,
} from '../../workspace-events/workspace-events-slice';
import {
  selectDesktopControl,
  selectDesktopEntry,
  selectDesktopEventsReady,
} from '../desktop-control-selectors';
import {
  desktopDecisionRequested,
  desktopEntryPatched,
  desktopEventReceived,
  desktopPermissionRequested,
  desktopReadRequested,
  desktopRequestExpired,
  desktopSnapshotReceived,
} from '../desktop-control-slice';
import { desktopKey } from '../desktop-control-types';

function errorDetail(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as { detail?: unknown } | undefined;
    if (typeof data?.detail === 'string') return data.detail;
  }
  return error instanceof Error ? error.message : String(error);
}
function* read(action: ReturnType<typeof desktopReadRequested>): SagaGenerator<void> {
  const [ws, agent] = action.payload;
  if (!(yield* selectDesktopEventsReady.effect())) yield* take(daemonEventsSubscribed);
  const { generation } = yield* selectDesktopControl.effect();
  const entry = yield* selectDesktopEntry.effect(ws, agent);
  const revision = entry?.revision ?? 0;
  try {
    const snapshot = yield* call(desktopClient.getState, ws, agent);
    yield* put(desktopSnapshotReceived(ws, agent, generation, revision, snapshot));
    const current = yield* selectDesktopEntry.effect(ws, agent);
    if (
      generation === (yield* selectDesktopControl.effect()).generation &&
      current?.revision !== revision
    )
      yield* put(desktopReadRequested(ws, agent));
  } catch {
    // Unsupported/offline/foreign-primary reads expose no permission switch.
    yield* put(
      desktopEntryPatched(ws, agent, generation, { loading: false, permission: undefined }),
    );
  }
}
function* decide(action: ReturnType<typeof desktopDecisionRequested>): SagaGenerator<void> {
  const [ws, agent, requestId, decision] = action.payload;
  const entry = yield* selectDesktopEntry.effect(ws, agent);
  if (!entry?.pending || entry.pending.requestId !== requestId || entry.submitting) return;
  if (Date.parse(entry.pending.expiresAt) <= Date.now()) {
    yield* put(desktopRequestExpired(ws, agent, requestId));
    return;
  }
  const { generation } = yield* selectDesktopControl.effect();
  yield* put(desktopEntryPatched(ws, agent, generation, { submitting: true, error: undefined }));
  try {
    yield* call(desktopClient.respond, ws, requestId, decision);
    // A candidate denial is local; other candidates keep their shared request open.
    if (
      decision === 'deny' &&
      entry.pending.claimsPrimary &&
      generation === (yield* selectDesktopControl.effect()).generation
    )
      yield* put(desktopRequestExpired(ws, agent, requestId));
    // An Allow ACK consumes the decision; only the outcome establishes readiness.
  } catch (error) {
    if (generation !== (yield* selectDesktopControl.effect()).generation) return;
    const current = yield* selectDesktopEntry.effect(ws, agent);
    if (current?.pending?.requestId !== requestId) return;
    yield* put(desktopRequestExpired(ws, agent, requestId));
    yield* call(showDesktopError, errorDetail(error));
    // Read-only reconciliation, never retry the decision.
    yield* put(desktopReadRequested(ws, agent));
  }
}
function* setPermission(
  action: ReturnType<typeof desktopPermissionRequested>,
): SagaGenerator<void> {
  const [ws, agent, computerId, allowed] = action.payload;
  const entry = yield* selectDesktopEntry.effect(ws, agent);
  if (!entry?.permission || entry.permission.computerId !== computerId || entry.saving) return;
  const { generation } = yield* selectDesktopControl.effect();
  yield* put(
    desktopEntryPatched(ws, agent, generation, { saving: true, revision: entry.revision + 1 }),
  );
  try {
    const permission = yield* call(desktopClient.setPermission, ws, agent, computerId, allowed);
    const current = yield* selectDesktopEntry.effect(ws, agent);
    if (current?.revision === entry.revision + 1)
      yield* put(desktopEntryPatched(ws, agent, generation, { permission }));
  } catch (error) {
    if (generation === (yield* selectDesktopControl.effect()).generation)
      yield* call(showDesktopError, errorDetail(error));
  } finally {
    const current = yield* selectDesktopEntry.effect(ws, agent);
    yield* put(
      desktopEntryPatched(ws, agent, generation, {
        saving: false,
        revision: (current?.revision ?? 0) + 1,
      }),
    );
    if (generation === (yield* selectDesktopControl.effect()).generation)
      yield* put(desktopReadRequested(ws, agent));
  }
}
function* expire(ws: string, agent: string, requestId: string, expiresAt: string) {
  yield* delay(Math.max(0, Math.min(300_000, Date.parse(expiresAt) - Date.now())));
  yield* put(desktopRequestExpired(ws, agent, requestId));
}
export function* desktopControlSaga(): SagaGenerator<void> {
  const shown = new Set<string>();
  const announced = new Set<string>();
  const handledEvents = new Set<string>();
  yield* takeEvery(
    [
      desktopEventReceived,
      desktopSnapshotReceived,
      desktopRequestExpired,
      connectionStatusChanged,
      daemonEventsSubscribing,
    ],
    function* (action) {
      const state = yield* selectDesktopControl.effect();
      const pending = new Set<string>();
      for (const entry of Object.values(state.byKey)) {
        if (entry.state.status === 'active' && !announced.has(entry.state.sessionId)) {
          announced.add(entry.state.sessionId);
          yield* fork(showDesktopStarted, entry.state.sessionId, entry.state.computerName);
        }
        if (!entry.pending) continue;
        const request = entry.pending;
        if (Date.parse(request.expiresAt) <= Date.now()) {
          yield* put(desktopRequestExpired(entry.workspaceId, entry.agentId, request.requestId));
          continue;
        }
        pending.add(request.requestId);
        if (!shown.has(request.requestId)) {
          shown.add(request.requestId);
          yield* fork(
            expire,
            entry.workspaceId,
            entry.agentId,
            request.requestId,
            request.expiresAt,
          );
          yield* fork(showDesktopPrompt, request);
        }
      }
      for (const id of shown)
        if (!pending.has(id)) {
          shown.delete(id);
          yield* fork(dismissDesktopPrompt, id);
        }
      if (action.type !== desktopEventReceived.type) return;
      const event = (action as ReturnType<typeof desktopEventReceived>).payload[0];
      if (handledEvents.has(event.id)) return;
      handledEvents.add(event.id);
      if (event.type === 'desktop:permission-resolved' && event.data.error)
        yield* call(showDesktopError, event.data.error.detail);
    },
  );
  yield* takeEvery(daemonEventsSubscribed, function* () {
    const state = yield* selectDesktopControl.effect();
    for (const entry of Object.values(state.byKey))
      yield* put(desktopReadRequested(entry.workspaceId, entry.agentId));
  });
  yield* takeSingleFlightInContext(
    desktopReadRequested,
    (action) => desktopKey(...action.payload),
    read,
  );
  yield* takeEvery(workspaceBrowserClientReceived, function* (action) {
    const state = yield* selectDesktopControl.effect();
    for (const entry of Object.values(state.byKey)) {
      if (entry.workspaceId === action.payload[0])
        yield* put(desktopReadRequested(entry.workspaceId, entry.agentId));
    }
  });
  yield* takeEvery(desktopDecisionRequested, decide);
  yield* takeEvery(desktopPermissionRequested, setPermission);
}
