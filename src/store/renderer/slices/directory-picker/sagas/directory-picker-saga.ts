import type { Task } from 'redux-saga';
import { call, cancel, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  directoryListingFailed,
  directoryListingLoaded,
  loadDirectoryRequested,
  navigateToPathRequested,
  pathNavigationFailed,
  type DirectoryPickerListing,
} from '../directory-picker-slice';

const logger = createLogger('DirectoryPickerSaga');
const HOME_KEY = '<home>';

type TrackedTask = { task: Task; token: symbol };

function requestedPathOf(action: { payload?: unknown }): string | null {
  if (!Array.isArray(action.payload)) return null;
  const raw = action.payload[0];
  return typeof raw === 'string' ? raw : null;
}

function isMissingPathError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('enoent')
    || lower.includes('os error 2')
    || lower.includes('no such file or directory')
  );
}

function* loadDirectory(requestedPath: string | null): SagaGenerator<void> {
  try {
    const listing: DirectoryPickerListing = yield* call(
      backendRequest<DirectoryPickerListing>,
      'host.listDirectory',
      requestedPath ? { path: requestedPath } : {},
    );
    yield* put(directoryListingLoaded(requestedPath, listing));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('host.listDirectory failed', { requestedPath, error: message });
    if (requestedPath !== null && isMissingPathError(message)) {
      logger.info('initial path missing; falling back to daemon-host home', { requestedPath });
      yield* put(loadDirectoryRequested());
    } else {
      yield* put(directoryListingFailed(requestedPath, message));
    }
  }
}

function* navigateToTypedPath(path: string): SagaGenerator<void> {
  try {
    const listing: DirectoryPickerListing = yield* call(
      backendRequest<DirectoryPickerListing>,
      'host.listDirectory',
      { path },
    );
    yield* put(directoryListingLoaded(path, listing));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('host.listDirectory failed for typed path', { path, error: message });
    const hint = isMissingPathError(message) ? m.onboarding_dirPicker_pathNotFound_error() : message;
    yield* put(pathNavigationFailed(path, hint));
  }
}

export function* directoryPickerSaga(): SagaGenerator<void> {
  const loadTasks = new Map<string, TrackedTask>();
  let navigationTask: TrackedTask | undefined;

  try {
    while (true) {
      const action: { type: string; payload?: unknown } = yield* take([
        loadDirectoryRequested,
        navigateToPathRequested,
      ]);

      if (action.type === navigateToPathRequested.type) {
        const path = requestedPathOf(action);
        if (!path) continue;
        if (navigationTask) yield* cancel(navigationTask.task);

        const token = Symbol(path);
        const task = yield* fork(function* () {
          try {
            yield* call(navigateToTypedPath, path);
          } finally {
            if (navigationTask?.token === token) navigationTask = undefined;
          }
        });
        navigationTask = { task, token };
        continue;
      }

      const requestedPath = requestedPathOf(action);
      const key = requestedPath ?? HOME_KEY;
      if (loadTasks.has(key)) continue;

      const token = Symbol(key);
      const task = yield* fork(function* () {
        try {
          yield* call(loadDirectory, requestedPath);
        } finally {
          if (loadTasks.get(key)?.token === token) loadTasks.delete(key);
        }
      });
      loadTasks.set(key, { task, token });
    }
  } finally {
    if (navigationTask) yield* cancel(navigationTask.task);
    for (const tracked of loadTasks.values()) yield* cancel(tracked.task);
    loadTasks.clear();
  }
}