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
import {
  type ScriptReadContext,
  beginScriptRead,
  isScriptReadCurrent,
  reconcileScriptRead,
} from '../utils/script-read-context';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectScriptById, selectScriptRetainedOutput } from '../scripts-selectors';
import {
  removeScript,
  scriptOutputRequested,
  scriptOutputDefinitionReceived,
  scriptOutputReleased,
  scriptOutputSnapshotReceived,
  scriptReadFinished,
  scriptReadReconciled,
} from '../scripts-slice';

type DefinitionRead = {
  dispatch: typeof store.dispatch;
  promise: Promise<Awaited<ReturnType<typeof appClient.scripts.list>>>;
  context: ScriptReadContext;
  viewers: Set<symbol>;
};
type DefinitionReads = Map<string, DefinitionRead>;

function* readOutput(
  reads: DefinitionReads,
  action: ReturnType<typeof scriptOutputRequested>,
): SagaGenerator<void> {
  const [workspaceId, scriptId, viewerId] = action.payload;
  const dispatch = store.dispatch;
  const context = yield* beginScriptRead(workspaceId);
  let script = yield* selectScriptById.effect(workspaceId, scriptId);
  const viewer = yield* selectScriptRetainedOutput.effect(workspaceId, scriptId, viewerId);
  if (!context.authority) {
    yield* put(scriptReadFinished(workspaceId, context.requestId));
    return;
  }
  const definitionKey = JSON.stringify([workspaceId, context.authority, context.connection]);
  const runtimeKey = (value: typeof script) =>
    JSON.stringify([
      value?.runtime?.status,
      value?.runtime?.startedAt,
      value?.runtime?.restartCount,
    ]);
  let run = runtimeKey(script);
  let definitionRead: DefinitionRead | undefined;
  const reader = Symbol();
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
      (yield* isScriptReadCurrent(context)) &&
      viewer === (yield* selectScriptRetainedOutput.effect(workspaceId, scriptId, viewerId)) &&
      (!script || run === runtimeKey(yield* selectScriptById.effect(workspaceId, scriptId)))
    );
  }
  function* hydrate(): SagaGenerator<void> {
    if (!(yield* isCurrent())) return;
    if (!script) {
      // There is no definition-by-ID endpoint. Only mounted viewers missing a
      // definition read the complete list; concurrent viewers share one request.
      let pending = reads.get(definitionKey);
      if (
        !pending ||
        pending.dispatch !== dispatch ||
        !(yield* isScriptReadCurrent(pending.context))
      ) {
        const definitionContext = yield* beginScriptRead(workspaceId);
        const promise = appClient.scripts.list(workspaceId, { archive: 'all' });
        pending = { dispatch, promise, context: definitionContext, viewers: new Set() };
        reads.set(definitionKey, pending);
        const clear = () => {
          if (reads.get(definitionKey) === pending) reads.delete(definitionKey);
        };
        void promise.then(clear, clear);
      }
      definitionRead = pending;
      pending.viewers.add(reader);
      const entries = yield* call(() => pending.promise);
      if (!(yield* isCurrent())) return;
      const reconciled = yield* reconcileScriptRead(pending.context, entries);
      if (!reconciled) return;
      yield* put(
        scriptReadReconciled(workspaceId, pending.context.requestId, reconciled.scripts, true),
      );
      const definition = reconciled.scripts.find((entry) => entry.id === scriptId);
      yield* put(scriptOutputDefinitionReceived(workspaceId, scriptId, definition, viewerId));
      if (definition) {
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
  ]);
  function* waitForCleanup(): SagaGenerator<void> {
    while (true) {
      const event = yield* take(releases);
      if (cleanup(event)) {
        if (event.type !== scriptOutputReleased.type && reads.get(definitionKey) === definitionRead)
          reads.delete(definitionKey);
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
    if (definitionRead) {
      definitionRead.viewers.delete(reader);
      if (definitionRead.viewers.size === 0) {
        yield* put(scriptReadFinished(workspaceId, definitionRead.context.requestId));
        if (reads.get(definitionKey) === definitionRead) reads.delete(definitionKey);
      }
    }
  }
}

export function* scriptsOutputSaga(): SagaGenerator<void> {
  const reads: DefinitionReads = new Map();
  yield* takeEvery(scriptOutputRequested, readOutput, reads);
}
