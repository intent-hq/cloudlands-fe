import { invoke } from "$lib/electron-bridge";
import {
  getItems,
  isCollection,
} from "$lib/store/utils/collection-utils";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  call,
  delay,
  put,
  takeLatest,
} from "typed-redux-saga";
import {
  selectInstalledEditors,
  selectInstalledEditorsLoading,
  selectLastFetched,
} from "../external-editors-selectors";
import {
  CACHE_TTL_MS,
  STORAGE_KEY,
  clearError,
  fetchEditors,
  fetchEditorsFailure,
  fetchEditorsSuccess,
  normalizeExternalEditorsError,
  normalizeInstalledEditors,
  setLoading,
  type InstalledEditor,
} from "../external-editors-slice";

export function normalizeEditorsCacheData(cachedEditors: unknown): InstalledEditor[] | null {
  let editorRecords: unknown;

  if (Array.isArray(cachedEditors)) {
    editorRecords = cachedEditors;
  } else if (
    cachedEditors &&
    typeof cachedEditors === "object" &&
    isCollection<InstalledEditor, "id">(cachedEditors)
  ) {
    editorRecords = getItems(cachedEditors);
  } else {
    return null;
  }

  return normalizeInstalledEditors(editorRecords);
}

function isDetectionResult(value: unknown): value is {
  success?: unknown;
  data?: unknown;
  error?: unknown;
} {
  return typeof value === "object" && value !== null;
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
    })) as unknown;

    if (isDetectionResult(result) && result.success === true && Array.isArray(result.data)) {
      const now = Date.now();
      const editors = normalizeInstalledEditors(result.data);
      yield* put(fetchEditorsSuccess(editors, now));

      // Persist to localStorage
      if (typeof window !== "undefined") {
        yield* call(setLocalStorageJSON, STORAGE_KEY, { editors, timestamp: now });
      }
    } else if (isDetectionResult(result) && "error" in result) {
      yield* put(fetchEditorsFailure(normalizeExternalEditorsError(result.error)));
    }
  } catch (error) {
    yield* put(fetchEditorsFailure(normalizeExternalEditorsError(error)));
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