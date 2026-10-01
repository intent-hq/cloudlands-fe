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
  scriptOutputDefinitionReceived,
  scriptOutputReleased,
  scriptOutputSnapshotReceived,
  updateRuntimeState,
} from '../scripts-slice';

type DefinitionReads = Map<
  string,
  {
    dispatch: typeof store.dispatch;
    promise: Promise<Awaited<ReturnType<typeof appClient.scripts.list>>>;
  }
>;

function* readOutput(
  reads: DefinitionReads,
  action: ReturnType<typeof scriptOutputRequested>,
): SagaGenerator<void> {
  const [workspaceId, scriptId, viewerId] = action.payload;
  const dispatch = store.dispatch;
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  let script = yield* selectScriptById.effect(workspaceId, scriptId);
  if (!authority) return;
  const definitionKey = JSON.stringify([workspaceId, authority]);
  const runtimeKey = (value: typeof script) =>
    JSON.stringify([
      value?.runtime?.status,
      value?.runtime?.startedAt,
      value?.runtime?.restartCount,
    ]);
  let run = runtimeKey(script);
  let pendingRuntime: ReturnType<typeof updateRuntimeState>['payload']['partial'] = {};
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
      (!script || run === runtimeKey(yield* selectScriptById.effect(workspaceId, scriptId)))
    );
  }
  function* hydrate(): SagaGenerator<void> {
    if (!(yield* isCurrent())) return;
    if (!script) {
      // There is no definition-by-ID endpoint. Only mounted viewers missing a
      // definition read the complete list; concurrent viewers share one request.
      let pending = reads.get(definitionKey);
      if (!pending || pending.dispatch !== dispatch) {
        const promise = appClient.scripts.list(workspaceId, { archive: 'all' });
        pending = { dispatch, promise };
        reads.set(definitionKey, pending);
        const clear = () => {
          if (reads.get(definitionKey) === pending) reads.delete(definitionKey);
        };
        void promise.then(clear, clear);
      }
      const entries = yield* call(() => pending.promise);
      if (!(yield* isCurrent())) return;
      const definition = entries.find((entry) => entry.id === scriptId);
      if (definition) {
        // State events can precede the missing definition. Keep their newer
        // runtime instead of reviving the run captured by the list snapshot.
        yield* put(
          scriptOutputDefinitionReceived(
            workspaceId,
            { ...definition, runtime: { ...definition.runtime, ...pendingRuntime } },
            viewerId,
          ),
        );
        script = yield* selectScriptById.effect(workspaceId, scriptId);
        run = runtimeKey(script);
      }
    }
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
    updateRuntimeState,
  ]);
  function* waitForCleanup(): SagaGenerator<void> {
    while (true) {
      const event = yield* take(releases);
      if (event.type === updateRuntimeState.type) {
        const {
          wsId,
          scriptId: id,
          partial,
        } = (event as ReturnType<typeof updateRuntimeState>).payload;
        if (!script && wsId === workspaceId && id === scriptId) {
          pendingRuntime = { ...pendingRuntime, ...partial };
        }
      }
      if (cleanup(event)) {
        if (event.type !== scriptOutputReleased.type) reads.delete(definitionKey);
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
  const reads: DefinitionReads = new Map();
  yield* takeEvery(scriptOutputRequested, readOutput, reads);
}
