import { cancel, delay, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import { takeEveryFromElectronChannel } from '$lib/store/utils/ipc-channel';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { agentFileChangeReceived, agentFileRefreshTriggered } from '../chat-changes-slice';
import type { AgentFileChangedEvent } from '../../files/files-types';

export const AGENT_FILE_REFRESH_DEBOUNCE_MS = 300;

function getAgentFileChangedPath(data: AgentFileChangedEvent): string | undefined {
  return data.filePath || data.path;
}

export function* handleAgentFileChangedEvent(data: AgentFileChangedEvent): SagaGenerator<void> {
  const wsId = data.workspaceId;
  if (!wsId) return;
  const path = getAgentFileChangedPath(data);
  if (!path) return;

  yield* put(agentFileChangeReceived(wsId, path));
}

export function* watchAgentFileChangedGlobal() {
  yield* takeEveryFromElectronChannel<AgentFileChangedEvent>(
    'file-tracking:agent-file-changed',
    handleAgentFileChangedEvent,
  );
}

export function* queueAgentFileRefresh(
  refreshTasksByKey: Map<string, Task>,
  action: ReturnType<typeof agentFileChangeReceived>,
): SagaGenerator<void> {
  const [wsId, path] = action.payload;
  const key = `${wsId}:${path}`;
  const existingTask = refreshTasksByKey.get(key);
  if (existingTask) {
    yield* cancel(existingTask);
  }

  const refreshTask = (yield* fork(function* () {
    try {
      yield* delay(AGENT_FILE_REFRESH_DEBOUNCE_MS);
      yield* put(agentFileRefreshTriggered(wsId, path));
    } finally {
      refreshTasksByKey.delete(key);
    }
  })) as unknown as Task;
  refreshTasksByKey.set(key, refreshTask);
}

function* cancelWorkspaceRefreshTasks(
  refreshTasksByKey: Map<string, Task>,
  wsId: string,
): SagaGenerator<void> {
  const keyPrefix = `${wsId}:`;
  for (const [key, task] of [...refreshTasksByKey.entries()]) {
    if (!key.startsWith(keyPrefix)) continue;
    yield* cancel(task);
    refreshTasksByKey.delete(key);
  }
}

export function* chatChangesSaga(): SagaGenerator<void> {
  const refreshTasksByKey = new Map<string, Task>();

  yield* fork(watchAgentFileChangedGlobal);

  yield* takeEvery(agentFileChangeReceived, function* (action) {
    yield* queueAgentFileRefresh(refreshTasksByKey, action);
  });

  yield* takeEvery(workspaceUnmounted, function* (action) {
    const wsId = action.payload[0];
    yield* cancelWorkspaceRefreshTasks(refreshTasksByKey, wsId);
  });
}
