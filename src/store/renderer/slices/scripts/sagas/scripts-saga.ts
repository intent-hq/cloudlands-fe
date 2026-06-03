/**
 * Scripts saga — IPC listeners and initialization.
 */

import {
  call,
  put,
  fork,
  takeLatest,
  type SagaGenerator,
  take,
} from 'typed-redux-saga';
import { createListenSyncChannel } from '$store/renderer/utils/ipc-channel';

import { scriptsClient } from '$features/scripts/scripts.client';
import type {
  ScriptStartedEvent,
  ScriptStoppedEvent,
  ScriptOutputEvent,
  ScriptErrorEvent,
  ScriptUrlDetectedEvent,
  ScriptOutputLine,
} from '../scripts-types';
import {
  initializeScripts,
  refreshScripts,
  setScriptsLoading,
  setScriptsInitialized,
  setScriptsData,
  setScriptOutput,
  updateRuntimeState,
  appendScriptOutput,
} from '../scripts-slice';
import { selectWorkspaceScriptsInitialized } from '../scripts-selectors';

// ============================================================================
// IPC Listener Sagas
// ============================================================================

function* watchScriptStarted(): SagaGenerator<void> {
  const channel = createListenSyncChannel<ScriptStartedEvent>('script:started');
  try {
    while (true) {
      const data = yield* take(channel);
      yield* put(
        updateRuntimeState(data.workspaceId, data.scriptId, {
          status: 'running',
          pid: data.pid,
          startedAt: data.startedAt,
          exitCode: undefined,
          stoppedAt: undefined,
          error: undefined,
        }),
      );
    }
  } finally {
    channel.close();
  }
}

function* watchScriptStopped(): SagaGenerator<void> {
  const channel = createListenSyncChannel<ScriptStoppedEvent>('script:stopped');
  try {
    while (true) {
      const data = yield* take(channel);
      yield* put(
        updateRuntimeState(data.workspaceId, data.scriptId, {
          status: 'exited',
          exitCode: data.exitCode,
          stoppedAt: data.stoppedAt,
          pid: undefined,
        }),
      );
    }
  } finally {
    channel.close();
  }
}

function* watchScriptOutput(): SagaGenerator<void> {
  const channel = createListenSyncChannel<ScriptOutputEvent>('script:output');
  try {
    while (true) {
      const data = yield* take(channel);
      const lines: ScriptOutputLine[] = data.lines.map((l) => ({
        text: l.text,
        stream: l.stream,
        timestamp: l.timestamp,
      }));
      yield* put(appendScriptOutput(data.workspaceId, data.scriptId, lines));
    }
  } finally {
    channel.close();
  }
}

function* watchScriptError(): SagaGenerator<void> {
  const channel = createListenSyncChannel<ScriptErrorEvent>('script:error');
  try {
    while (true) {
      const data = yield* take(channel);
      yield* put(
        updateRuntimeState(data.workspaceId, data.scriptId, {
          error: data.error,
        }),
      );
    }
  } finally {
    channel.close();
  }
}

function* watchScriptUrlDetected(): SagaGenerator<void> {
  const channel = createListenSyncChannel<ScriptUrlDetectedEvent>('script:url-detected');
  try {
    while (true) {
      const data = yield* take(channel);
      yield* put(
        updateRuntimeState(data.workspaceId, data.scriptId, {
          detectedUrl: data.url,
        }),
      );
    }
  } finally {
    channel.close();
  }
}

// ============================================================================
// Init & Refresh Handlers
// ============================================================================

function* handleInitializeScripts(
  action: ReturnType<typeof initializeScripts>,
): SagaGenerator<void> {
  const wsId = action.payload[0];

  // Check if already initialized for this workspace
  const alreadyInit = yield* selectWorkspaceScriptsInitialized.effect(wsId);
  if (alreadyInit) return;

  yield* put(setScriptsLoading(wsId, true));

  // Load scripts from main process
  const response = yield* call([scriptsClient, scriptsClient.list], wsId);

  if (response.success && response.data) {
    yield* put(setScriptsData(wsId, response.data));

    // Fetch buffered output for non-idle scripts
    for (const entry of response.data) {
      if (entry.runtime.status !== 'idle') {
        try {
          const outputResponse = yield* call(
            [scriptsClient, scriptsClient.getOutput],
            wsId,
            entry.id,
          );
          if (outputResponse.success && outputResponse.lines && outputResponse.lines.length > 0) {
            const lines: ScriptOutputLine[] = outputResponse.lines.map((line) => ({
              text: line.text,
              stream: line.stream,
              timestamp:
                typeof line.timestamp === 'number'
                  ? new Date(line.timestamp).toISOString()
                  : String(line.timestamp),
            }));
            yield* put(setScriptOutput(wsId, entry.id, lines));
          }
        } catch {
          // Ignore errors fetching buffered output
        }
      }
    }
  }

  yield* put(setScriptsInitialized(wsId, true));
  yield* put(setScriptsLoading(wsId, false));
}

function* handleRefreshScripts(action: ReturnType<typeof refreshScripts>): SagaGenerator<void> {
  const wsId = action.payload[0];

  const response = yield* call([scriptsClient, scriptsClient.list], wsId);

  if (response.success && response.data) {
    yield* put(setScriptsData(wsId, response.data));
  }
}

// ============================================================================
// Root Saga
// ============================================================================

export function* scriptsSaga(): SagaGenerator<void> {
  // Start IPC listeners
  yield* fork(watchScriptStarted);
  yield* fork(watchScriptStopped);
  yield* fork(watchScriptOutput);
  yield* fork(watchScriptError);
  yield* fork(watchScriptUrlDetected);

  // Handle init & refresh actions
  yield* takeLatest(initializeScripts, handleInitializeScripts);
  yield* takeLatest(refreshScripts, handleRefreshScripts);
}
