/**
 * Directory-picker read service — companion to the `directoryPicker` slice
 * (`src/store/renderer/slices/directory-picker`) that owns the `host.listDirectory`
 * round-trip for the BE-driven `DirectoryPickerModal`.
 *
 * The modal dispatches `loadDirectoryRequested(path?)` whenever it opens or the
 * user navigates into a folder. This middleware observes that action and, in a
 * coalesced fire-and-forget call, asks the daemon for the listing via
 * `backendRequest<DirectoryPickerListing>('host.listDirectory', ...)`. The
 * response (success or failure) is dispatched back as `directoryListingLoaded`
 * / `directoryListingFailed` carrying the same `requestedPath` so the reducer
 * can discard stale responses.
 *
 * Keeping the IPC call here — not in the Svelte component — satisfies the
 * `intent/no-component-async-data-fetch` ESLint rule and matches the
 * "service middleware" pattern used by `git-read-service`,
 * `agent-read-service`, and `lifecycle-ipc-read-service` for the post-saga
 * read path.
 *
 * Refreshes are coalesced per requested path so rapid dispatches collapse
 * into a single fetch. The one mutation this module owns is the picker's
 * `createDirectoryRequested` → `host.createDirectory` round-trip (the modal's
 * "New Folder" action), which on success feeds back into the read path by
 * dispatching `loadDirectoryRequested(createdPath)`.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { m } from "$shared/paraglide/messages.js";
import { backendRequest } from "$lib/client/live/backend-transport";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  createDirectoryFailed,
  createDirectoryRequested,
  directoryListingFailed,
  directoryListingLoaded,
  loadDirectoryRequested,
  navigateToPathRequested,
  pathNavigationFailed,
  type DirectoryPickerListing,
} from "$store/renderer/slices/directory-picker/directory-picker-slice";

const logger = createLogger("DirectoryPickerReadService");

/** In-flight loads keyed by requested path; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/** Stable key for the in-flight map; `null` (home) collapses to a sentinel. */
function inFlightKey(requestedPath: string | null): string {
  return requestedPath ?? "<home>";
}

/**
 * True when `message` looks like a "path does not exist" failure surfaced by
 * the daemon (matches Rust's `io::Error` display for `NotFound` on macOS/Linux
 * — "os error 2" / "No such file or directory" — plus the `ENOENT` alias).
 */
function isMissingPathError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("enoent") ||
    lower.includes("os error 2") ||
    lower.includes("no such file or directory")
  );
}

/**
 * Fetch a listing via `host.listDirectory` and dispatch the result back to the
 * slice. Concurrent calls for the same `requestedPath` share one fetch.
 *
 * When a non-home `requestedPath` fails because the path is missing (ENOENT),
 * dispatch `loadDirectoryRequested()` to retry against the daemon-host home
 * instead of surfacing a dead-end error. Home failures and non-missing errors
 * (permission, etc.) still fall through to `directoryListingFailed`.
 */
async function refreshDirectoryListing(requestedPath: string | null): Promise<void> {
  const key = inFlightKey(requestedPath);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = (async () => {
    try {
      const listing = await backendRequest<DirectoryPickerListing>(
        "host.listDirectory",
        requestedPath ? { path: requestedPath } : {},
      );
      appStore.dispatch(directoryListingLoaded(requestedPath, listing));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("host.listDirectory failed", { requestedPath, error: message });
      if (requestedPath !== null && isMissingPathError(message)) {
        logger.info("initial path missing; falling back to daemon-host home", {
          requestedPath,
        });
        appStore.dispatch(loadDirectoryRequested());
      } else {
        appStore.dispatch(directoryListingFailed(requestedPath, message));
      }
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, run);
  return run;
}

/**
 * List a user-typed path via `host.listDirectory`. Unlike
 * `refreshDirectoryListing`, a failure never falls back to home and never
 * clears the current listing: it dispatches `pathNavigationFailed` so the
 * picker can render an inline hint next to the path input instead. Missing
 * paths get a friendly "Path not found" hint; other errors surface verbatim.
 */
async function navigateToTypedPath(path: string): Promise<void> {
  try {
    const listing = await backendRequest<DirectoryPickerListing>(
      "host.listDirectory",
      { path },
    );
    appStore.dispatch(directoryListingLoaded(path, listing));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("host.listDirectory failed for typed path", { path, error: message });
    const hint = isMissingPathError(message) ? m.onboarding_dirPicker_pathNotFound_error() : message;
    appStore.dispatch(pathNavigationFailed(path, hint));
  }
}

/**
 * Create a directory via `host.createDirectory` (the modal's "New Folder"
 * action). On success the daemon echoes the fully expanded created path, and
 * the picker navigates into it by dispatching `loadDirectoryRequested`. On
 * failure `createDirectoryFailed` keeps the current listing so the modal can
 * render an inline hint next to the name input.
 */
async function createDirectoryAt(path: string): Promise<void> {
  try {
    const created = await backendRequest<{ path: string }>(
      "host.createDirectory",
      { path },
    );
    // Fail closed on a malformed response: dispatching a non-string path
    // would leave the picker stuck loading (the middleware ignores it), so
    // surface the same inline hint as an RPC failure instead.
    if (typeof created?.path !== "string" || created.path.length === 0) {
      logger.warn("host.createDirectory returned no valid path", { path, created });
      appStore.dispatch(createDirectoryFailed(path, m.dialog_unexpected_error()));
      return;
    }
    appStore.dispatch(loadDirectoryRequested(created.path));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("host.createDirectory failed", { path, error: message });
    appStore.dispatch(createDirectoryFailed(path, message));
  }
}

/** First tuple-payload element, treated as an optional path string. */
function requestedPathOf(action: { payload?: unknown }): string | null {
  if (!Array.isArray(action.payload)) return null;
  const raw = action.payload[0];
  return typeof raw === "string" ? raw : null;
}

/**
 * Middleware that observes `loadDirectoryRequested` /
 * `navigateToPathRequested` / `createDirectoryRequested` and triggers the IPC
 * call. Fire-and-forget — dispatch stays synchronous.
 */
export function createDirectoryPickerReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === loadDirectoryRequested.type) {
      void refreshDirectoryListing(requestedPathOf(action));
    } else if (action && action.type === navigateToPathRequested.type) {
      const path = requestedPathOf(action);
      if (path) void navigateToTypedPath(path);
    } else if (action && action.type === createDirectoryRequested.type) {
      const path = requestedPathOf(action);
      if (path) void createDirectoryAt(path);
    }
    return result;
  };
}
