import {
  actionChannel,
  call,
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
import { selectScriptById } from '../scripts-selectors';
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
    if (!(yield* isCurrent())) return;
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
      if (cleanup(yield* take(releases))) {
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
  }
}

export function* scriptsOutputSaga(): SagaGenerator<void> {
  yield* takeEvery(scriptOutputRequested, readOutput);
}
