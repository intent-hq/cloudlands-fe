import { invoke } from "$lib/electron-bridge";
import { getItems, isCollection } from "$lib/store/utils/collection-utils";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, delay, put, takeLatest } from "typed-redux-saga";
import { selectInstalledEditors, selectInstalledEditorsLoading, selectLastFetched } from "../external-editors-selectors";
import {
  CACHE_TTL_MS,
  STORAGE_KEY,
  clearError,
  fetchEditors,
  fetchEditorsFailure,
  fetchEditorsSuccess,
  setLoading,
  type InstalledEditor,
} from "../external-editors-slice";

export function normalizeEditorsCacheData(cachedEditors: unknown): InstalledEditor[] | null {
  if (Array.isArray(cachedEditors)) {
    return cachedEditors;
  }

  if (
    cachedEditors &&
    typeof cachedEditors === "object" &&
    isCollection<InstalledEditor, "id">(cachedEditors)
  ) {
    return getItems(cachedEditors);
  }

  return null;
}

export function* loadCachedEditors() {
  if (typeof window === "undefined") return;

  const cached = yield* call(
    getLocalStorageJSON<{ editors?: unknown; timestamp?: unknown }>,
    STORAGE_KEY
  );
  if (cached) {
    const editors = normalizeEditorsCacheData(cached.editors);

    if (editors && typeof cached.timestamp === "number") {
      yield* put(fetchEditorsSuccess(editors, cached.timestamp));
    }
  }
}

export function* handleFetchEditors(action: ReturnType<typeof fetchEditors>) {
  const [forceRefresh] = action.payload;
  yield* delay(50);

  const isLoading = yield* selectInstalledEditorsLoading.effect();
  if (isLoading) {
    return;
  }

  // Check cache TTL unless force refresh
  if (!forceRefresh) {
    const lastFetched: number = yield* selectLastFetched.effect();
    const editors: InstalledEditor[] = yield* selectInstalledEditors.effect();
    const now = Date.now();
    if (editors.length > 0 && now - lastFetched < CACHE_TTL_MS) {
      return;
    }
  }
  
  yield* put(clearError());
  yield* put(setLoading(true));

  try {
    const result = (yield* call(invoke, "external-editors:detect-installed", {
      forceRefresh: forceRefresh ?? false,
    })) as {
      success: boolean;
      data?: InstalledEditor[];
      error?: string;
    };

    if (result?.success && result.data) {
      const now = Date.now();
      yield* put(fetchEditorsSuccess(result.data, now));

      // Persist to localStorage
      if (typeof window !== "undefined") {
        yield* call(setLocalStorageJSON, STORAGE_KEY, { editors: result.data, timestamp: now });
      }
    } else if (result?.error) {
      yield* put(fetchEditorsFailure(result.error));
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to detect editors";
    yield* put(fetchEditorsFailure(errorMessage));
  } finally {
    yield* put(setLoading(false));
  }
}

/**
 * Fetch editors saga:
 * - Loads cached editors from localStorage on init
 * - Watches for fetchEditors actions and handles IPC + caching
 */
export function* fetchEditorsSaga() {
  yield* call(loadCachedEditors);
  yield* takeLatest(fetchEditors, handleFetchEditors);
}