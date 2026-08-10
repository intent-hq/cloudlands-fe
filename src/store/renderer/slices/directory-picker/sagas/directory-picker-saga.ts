import { call, put, takeLatest, takeLeading, type SagaGenerator } from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  directoryListingFailed,
  directoryListingLoaded,
  createDirectoryFailed,
  createDirectoryRequested,
  loadDirectoryRequested,
  navigateToPathRequested,
  pathNavigationFailed,
  type DirectoryPickerListing,
} from '../directory-picker-slice';

const logger = createLogger('DirectoryPickerSaga');
function isMissingPathError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('enoent') ||
    lower.includes('os error 2') ||
    lower.includes('no such file or directory')
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
      yield* call(loadDirectory, null);
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
    const hint = isMissingPathError(message)
      ? m.onboarding_dirPicker_pathNotFound_error()
      : message;
    yield* put(pathNavigationFailed(path, hint));
  }
}

function* createDirectory(path: string): SagaGenerator<void> {
  try {
    yield* call(backendRequest, 'host.createDirectory', { path });
    yield* put(loadDirectoryRequested(path));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('host.createDirectory failed', { path, error: message });
    yield* put(createDirectoryFailed(path, message));
  }
}

function* loadDirectoryWorker(action: ReturnType<typeof loadDirectoryRequested>) {
  const [requestedPath] = action.payload;
  yield* call(loadDirectory, requestedPath ?? null);
}

function* navigateToPathWorker(action: ReturnType<typeof navigateToPathRequested>) {
  const [path] = action.payload;
  if (path) yield* call(navigateToTypedPath, path);
}

function* createDirectoryWorker(action: ReturnType<typeof createDirectoryRequested>) {
  const [path] = action.payload;
  if (path) yield* call(createDirectory, path);
}

export function* directoryPickerSaga(): SagaGenerator<void> {
  yield* takeLeading(loadDirectoryRequested, loadDirectoryWorker);
  yield* takeLatest(navigateToPathRequested, navigateToPathWorker);
  yield* takeLatest(createDirectoryRequested, createDirectoryWorker);
}
