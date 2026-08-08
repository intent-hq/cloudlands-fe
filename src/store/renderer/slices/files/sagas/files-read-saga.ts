import type { Task } from 'redux-saga';
import { call, cancel, fork, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
} from '../files-slice';

const logger = createLogger('FilesReadSaga');

function readKey(workspaceId: string, path: string): string {
  return `${workspaceId}::${path}`;
}

function* loadFileContentWorker(workspaceId: string, path: string, absolutePath: string) {
  try {
    const entry: Awaited<ReturnType<typeof appClient.files.read>> = yield* call(
      [appClient.files, appClient.files.read],
      workspaceId,
      path,
    );
    if (!entry) {
      yield* put(
        loadFileContentFailed(workspaceId, path, absolutePath, m.files_read_notFound_error()),
      );
      return;
    }
    yield* put(
      loadFileContentSucceeded(
        workspaceId,
        path,
        absolutePath,
        entry.originalContent ?? entry.localContent ?? '',
        entry.isBinary,
        entry.truncated,
      ),
    );
  } catch (error) {
    logger.error('Failed to load file content', error);
    const message = error instanceof Error ? error.message : String(error);
    yield* put(loadFileContentFailed(workspaceId, path, absolutePath, message));
  }
}

type RunningRead = { workspaceId: string; task?: Task; token: symbol };

export function* filesReadSaga() {
  const running = new Map<string, RunningRead>();
  try {
    while (true) {
      const action: ReturnType<
        typeof loadFileContentRequested | typeof workspaceDeleted | typeof workspaceUnmounted
      > = yield* take([loadFileContentRequested, workspaceDeleted, workspaceUnmounted]);

      if (action.type === loadFileContentRequested.type) {
        const [workspaceId, path, absolutePath] = action.payload as [string, string, string];
        if (!workspaceId || !path || typeof absolutePath !== 'string') continue;
        const key = readKey(workspaceId, path);
        if (running.has(key)) continue;
        const token = Symbol(key);
        running.set(key, { workspaceId, token });
        const task = yield* fork(function* () {
          try {
            yield* call(loadFileContentWorker, workspaceId, path, absolutePath);
          } finally {
            if (running.get(key)?.token === token) running.delete(key);
          }
        });
        if (running.get(key)?.token === token) {
          running.set(key, { workspaceId, task, token });
        }
        continue;
      }

      const [workspaceId] = action.payload as [string];
      for (const [key, read] of running) {
        if (read.workspaceId !== workspaceId) continue;
        running.delete(key);
        if (read.task) yield* cancel(read.task);
      }
    }
  } finally {
    for (const read of running.values()) {
      if (read.task) yield* cancel(read.task);
    }
    running.clear();
  }
}
