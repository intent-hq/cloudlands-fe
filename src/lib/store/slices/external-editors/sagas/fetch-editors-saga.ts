import { invoke } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import { getItems, isCollection } from "$lib/store/utils/collection-utils";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, put, takeLatest } from "typed-redux-saga";
import { selectInstalledEditors, selectLastFetched } from "../external-editors-selectors";
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

const logger = createLogger("ExternalEditorsSaga");

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

  try {
    const cached: string | null = yield* call(getLocalStorageItem, STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        editors?: unknown;
        timestamp?: unknown;
      };
      const editors = normalizeEditorsCacheData(parsed.editors);

      if (editors && typeof parsed.timestamp === "number") {
        yield* put(fetchEditorsSuccess(editors, parsed.timestamp));
      }
    }
  } catch {
    // Ignore cache errors
  }
}

export function* handleFetchEditors(action: ReturnType<typeof fetchEditors>) {
  const [forceRefresh] = action.payload;

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
        try {
          yield* call(
            setLocalStorageItem,
            STORAGE_KEY,
            JSON.stringify({ editors: result.data, timestamp: now })
          );
        } catch {
          // Ignore storage errors
        }
      }
    } else if (result?.error) {
      yield* put(fetchEditorsFailure(result.error));
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to detect editors";
    logger.error("Failed to fetch installed editors", { error });
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