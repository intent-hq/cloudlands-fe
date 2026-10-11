import { call, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import type { BackendTransport } from '$lib/client/live/backend-transport-types';
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

/** Bind the single directory workflow to a renderer's transport and selector effect. */
export function createDirectoryPickerSaga({
  backendRequest,
  listingEffect,
}: {
  backendRequest: BackendTransport['request'];
  listingEffect: () => SagaGenerator<DirectoryPickerListing | null>;
}) {
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
      const missing = isMissingPathError(message);
      // The modal resets the slice on close, so a null listing means this is the
      // initial load of a remembered path; anything else is explicit navigation.
      const current = yield* listingEffect();
      if (requestedPath !== null && missing && current === null) {
        logger.info('initial path missing; falling back to daemon-host home', { requestedPath });
        yield* call(loadHomeFallback, requestedPath);
      } else if (requestedPath !== null && current !== null) {
        // Navigation failure: keep the current listing and surface an inline
        // hint instead of silently jumping to home.
        const hint = missing ? m.onboarding_dirPicker_pathNotFound_error() : message;
        yield* put(pathNavigationFailed(requestedPath, hint));
      } else {
        yield* put(directoryListingFailed(requestedPath, message));
      }
    }
  }

  /**
   * Initial-load fallback: the remembered path is gone, so list the daemon-host
   * home instead — echoing the originally requested path so the reducer (which
   * discards responses whose `requestedPath` does not match) accepts the result.
   */
  function* loadHomeFallback(requestedPath: string): SagaGenerator<void> {
    try {
      const listing: DirectoryPickerListing = yield* call(
        backendRequest<DirectoryPickerListing>,
        'host.listDirectory',
        {},
      );
      yield* put(directoryListingLoaded(requestedPath, listing));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('daemon-host home fallback failed', { requestedPath, error: message });
      yield* put(directoryListingFailed(requestedPath, message));
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

  return function* directoryPickerSaga(): SagaGenerator<void> {
    // takeLatest (not takeLeading) keeps the reducer's stale-guard sound: the
    // newest request always has a live worker, so a click landing mid-flight
    // cancels the superseded task (including an in-flight home fallback)
    // instead of being dropped with `loading` stuck true (monorepo#2650).
    yield* takeLatest(loadDirectoryRequested, loadDirectoryWorker);
    yield* takeLatest(navigateToPathRequested, navigateToPathWorker);
    yield* takeLatest(createDirectoryRequested, createDirectoryWorker);
  };
}
