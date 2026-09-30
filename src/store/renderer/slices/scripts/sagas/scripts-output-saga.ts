import {
  actionChannel,
  call,
  delay,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { store } from '../../../store';
import { appClient } from '$lib/client';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectScriptById, selectScriptOutput } from '../scripts-selectors';
import {
  removeScript,
  scriptOutputRequested,
  scriptOutputReleased,
  scriptOutputSnapshotReceived,
} from '../scripts-slice';

function* readOutput(action: ReturnType<typeof scriptOutputRequested>): SagaGenerator<void> {
  const [workspaceId, scriptId, viewerId] = action.payload;
  const dispatch = store.dispatch;
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  const script = yield* selectScriptById.effect(workspaceId, scriptId);
  if (!authority || !script) return;
  const runtimeKey = (value: typeof script) =>
    JSON.stringify([
      value?.runtime?.status,
      value?.runtime?.startedAt,
      value?.runtime?.restartCount,
    ]);
  const run = runtimeKey(script);
  const cleanup = (event: { type: string; payload?: unknown }) => {
    const payload = event.payload;
    if (!Array.isArray(payload) || payload[0] !== workspaceId) return false;
    return (
      event.type === workspaceUnmounted.type ||
      event.type === workspaceDeleted.type ||
      (event.type === removeScript.type && payload[1] === scriptId) ||
      (event.type === scriptOutputReleased.type &&
        payload[1] === scriptId &&
        payload[2] === viewerId)
    );
  };
  function* isCurrent(): SagaGenerator<boolean> {
    return (
      dispatch === store.dispatch &&
      authority === (yield* selectWorkspaceActionContext.effect(workspaceId)) &&
      run === runtimeKey(yield* selectScriptById.effect(workspaceId, scriptId))
    );
  }
  function* hydrate(): SagaGenerator<void> {
    while (yield* isCurrent()) {
      const before = yield* selectScriptOutput.effect(workspaceId, scriptId);
      const output = yield* call(
        [appClient.scripts, appClient.scripts.output],
        workspaceId,
        scriptId,
      );
      if (!(yield* isCurrent())) return;
      const after = yield* selectScriptOutput.effect(workspaceId, scriptId);
      if (before !== after) {
        // The wire has no output cursor. A raced snapshot cannot be safely
        // spliced by text overlap (repeated lines are legitimate output).
        // Keep streaming visible and retry until a read spans a quiet interval.
        yield* delay(50);
        continue;
      }
      yield* put(
        scriptOutputSnapshotReceived(
          workspaceId,
          scriptId,
          output,
          before.revision ?? 0,
          before.dropped + before.chunks.length,
          new Date().toISOString(),
        ),
      );
      return;
    }
  }
  const releases = yield* actionChannel([
    scriptOutputReleased,
    workspaceUnmounted,
    workspaceDeleted,
    removeScript,
  ]);
  function* waitForCleanup(): SagaGenerator<void> {
    while (true) if (cleanup(yield* take(releases))) return;
  }
  try {
    yield* race({ read: call(hydrate), cleanup: call(waitForCleanup) });
  } catch {
    // Output is transient. Failed/expired reads must preserve anything already
    // visible; a subsequent viewer open or connection lifetime retries it.
  } finally {
    releases.close();
  }
}

export function* scriptsOutputSaga(): SagaGenerator<void> {
  yield* takeEvery(scriptOutputRequested, readOutput);
}
