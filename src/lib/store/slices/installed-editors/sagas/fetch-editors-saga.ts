import { call, put, takeLatest } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import {
  clearError,
  fetchEditors,
  fetchEditorsSuccess,
  fetchEditorsFailure,
  setLoading,
  STORAGE_KEY,
  CACHE_TTL_MS,
  type InstalledEditor,
} from "../installed-editors-slice";
import { selectInstalledEditors, selectLastFetched } from "../installed-editors-selectors";

const logger = createLogger("InstalledEditorsSaga");

function* loadCachedEditors() {
  if (typeof window === "undefined") return;

  try {
    const cached: string | null = yield* call(
      [localStorage, localStorage.getItem],
      STORAGE_KEY
    );
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.editors && parsed.timestamp) {
        yield* put(fetchEditorsSuccess(parsed.editors, parsed.timestamp));
      }
    }
  } catch {
    // Ignore cache errors
  }
}

function* handleFetchEditors(action: ReturnType<typeof fetchEditors>) {
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
            [localStorage, localStorage.setItem],
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
  } catch (e) {
    const errorMessage =
      e instanceof Error ? e.message : "Failed to detect editors";
    logger.error("Failed to fetch installed editors", { error: e });
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

