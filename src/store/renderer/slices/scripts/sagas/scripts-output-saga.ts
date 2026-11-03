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
import { appClient } from '$lib/client';
import { scriptMachineRuns } from '$features/scripts/utils/script-location';
import { beginScriptRead, isScriptReadCurrent } from '../utils/script-read-context';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectCanReadScriptDefinition,
  selectScriptById,
  selectScriptOutputStreamReady,
  selectScriptRetainedOutput,
} from '../scripts-selectors';
import {
  removeScript,
  scriptOutputRequested,
  scriptOutputReleased,
  scriptOutputSnapshotReceived,
  scriptOutputStreamReady,
  scriptReadFinished,
} from '../scripts-slice';

/**
 * Longest a viewer snapshot waits for its workspace's live output lease. A
 * subscribe that keeps failing must not withhold the retained output.
 */
export const SCRIPT_OUTPUT_STREAM_WAIT_MS = 5_000;

/**
 * Wait until the workspace's live `script:output` lease is routable, so the
 * snapshot read below starts after the stream: output between them lands in
 * the live buffer instead of falling into neither. Resolves `false` when the
 * wait timed out and the snapshot is only a fallback.
 */
function* waitForLiveOutputStream(workspaceId: string): SagaGenerator<boolean> {
  if (yield* selectScriptOutputStreamReady.effect(workspaceId)) return true;
  const { ready } = yield* race({
    ready: call(takeOutputStreamReady, workspaceId),
    timeout: delay(SCRIPT_OUTPUT_STREAM_WAIT_MS),
  });
  return ready !== undefined;
}

function* takeOutputStreamReady(workspaceId: string): SagaGenerator<true> {
  while (true) {
    const { payload } = yield* take(scriptOutputStreamReady);
    if (payload[0] === workspaceId) return true;
  }
}

function* readOutput(action: ReturnType<typeof scriptOutputRequested>): SagaGenerator<void> {
  const [workspaceId, scriptId, viewerId, remoteAgentId] = action.payload;
  let context = yield* beginScriptRead(workspaceId);
  const script = yield* selectScriptById.effect(workspaceId, scriptId);
  let viewer = yield* selectScriptRetainedOutput.effect(workspaceId, scriptId, viewerId);
  if (!context.authority || !(yield* selectCanReadScriptDefinition.effect(workspaceId, script))) {
    yield* put(scriptReadFinished(workspaceId, context.requestId));
    return;
  }
  // A machine run is read (and invalidated) by its own runtime, not the home run's.
  const runtimeKey = (value: typeof script) =>
    JSON.stringify(
      remoteAgentId
        ? scriptMachineRuns(value ?? {}).find((entry) => entry.remoteAgentId === remoteAgentId)
            ?.runtime
        : value?.runtime,
    );
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
  function* readSnapshot(): SagaGenerator<void> {
    // Known IDs remain readable after archive retirement and partial-page refresh.
    const output = yield* call(
      [appClient.scripts, appClient.scripts.output],
      workspaceId,
      scriptId,
      10_000,
      ...(remoteAgentId ? [{ remoteAgentId }] : []),
    );
    if (!(yield* isCurrent())) return;
    yield* put(scriptOutputSnapshotReceived(workspaceId, scriptId, viewerId, output));
    // Our own publication replaces the viewer entry; a later re-request or
    // release replaces it again and retires this read.
    viewer = yield* selectScriptRetainedOutput.effect(workspaceId, scriptId, viewerId);
  }
  function* hydrate(): SagaGenerator<void> {
    if (!(yield* isCurrent())) return;
    // Machine-run output is never streamed as script:output, so there is no
    // live lease to wait for: the snapshot is the whole read.
    if (remoteAgentId) {
      yield* call(readSnapshot);
      return;
    }
    const streamed = yield* call(waitForLiveOutputStream, workspaceId);
    if (!(yield* isCurrent())) return;
    yield* call(readSnapshot);
    if (streamed) return;
    // The fallback snapshot predates the lease, so output produced before it
    // becomes routable reached neither. Refresh once the lease is ready. The
    // wait is open-ended, so close this read's change journal first.
    const fallback = context;
    yield* put(scriptReadFinished(workspaceId, fallback.requestId));
    // Readiness may already have arrived while the fallback read was in flight.
    if (!(yield* selectScriptOutputStreamReady.effect(workspaceId))) {
      const { ready } = yield* race({
        ready: call(takeOutputStreamReady, workspaceId),
        replaced: call(takeViewerRequest),
      });
      if (!ready) return;
    }
    context = yield* beginScriptRead(workspaceId);
    if (
      context.authority !== fallback.authority ||
      context.connection !== fallback.connection ||
      context.backendId !== fallback.backendId ||
      !(yield* isCurrent())
    ) {
      return;
    }
    yield* call(readSnapshot);
  }
  function* takeViewerRequest(): SagaGenerator<void> {
    while (true) {
      const { payload } = yield* take(scriptOutputRequested);
      if (payload[0] === workspaceId && payload[1] === scriptId && payload[2] === viewerId) return;
    }
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
