import {
  actionChannel,
  call,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { beginScriptRead, isScriptReadCurrent } from '../utils/script-read-context';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectCanReadScriptDefinition,
  selectScriptById,
  selectScriptRetainedOutput,
} from '../scripts-selectors';
import {
  removeScript,
  scriptOutputRequested,
  scriptOutputReleased,
  scriptOutputSnapshotReceived,
  scriptReadFinished,
} from '../scripts-slice';

function* readOutput(action: ReturnType<typeof scriptOutputRequested>): SagaGenerator<void> {
  const [workspaceId, scriptId, viewerId] = action.payload;
  const context = yield* beginScriptRead(workspaceId);
  const script = yield* selectScriptById.effect(workspaceId, scriptId);
  const viewer = yield* selectScriptRetainedOutput.effect(workspaceId, scriptId, viewerId);
  if (!context.authority || !(yield* selectCanReadScriptDefinition.effect(workspaceId, script))) {
    yield* put(scriptReadFinished(workspaceId, context.requestId));
    return;
  }
  const runtimeKey = (value: typeof script) => JSON.stringify(value?.runtime);
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
    const currentScript = yield* selectScriptById.effect(workspaceId, scriptId);
    return (
      (yield* isScriptReadCurrent(context)) &&
      viewer === (yield* selectScriptRetainedOutput.effect(workspaceId, scriptId, viewerId)) &&
      (!script || !currentScript || run === runtimeKey(currentScript))
    );
  }
  function* hydrate(): SagaGenerator<void> {
    if (!(yield* isCurrent())) return;
    // Known IDs remain readable after archive retirement and partial-page refresh.
    const output = yield* call(
      [appClient.scripts, appClient.scripts.output],
      workspaceId,
      scriptId,
      10_000,
    );
    if (!(yield* isCurrent())) return;
    yield* put(scriptOutputSnapshotReceived(workspaceId, scriptId, viewerId, output));
  }
  const releases = yield* actionChannel([
    scriptOutputReleased,
    workspaceUnmounted,
    workspaceDeleted,
    removeScript,
  ]);
  function* waitForCleanup(): SagaGenerator<void> {
    while (true) {
      const event = yield* take(releases);
      if (cleanup(event)) {
        yield* put(scriptOutputReleased(workspaceId, scriptId, viewerId));
        return;
      }
    }
  }
  try {
    yield* race({ read: call(hydrate), cleanup: call(waitForCleanup) });
  } catch {
    if (yield* isCurrent()) {
      yield* put(scriptOutputSnapshotReceived(workspaceId, scriptId, viewerId, ''));
    }
  } finally {
    releases.close();
    yield* put(scriptReadFinished(workspaceId, context.requestId));
  }
}

export function* scriptsOutputSaga(): SagaGenerator<void> {
  yield* takeEvery(scriptOutputRequested, readOutput);
}
