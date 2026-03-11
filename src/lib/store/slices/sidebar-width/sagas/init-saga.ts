import { call, put } from "typed-redux-saga";
import { loadSidebarState, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH } from "../sidebar-width-slice";

const STORAGE_KEY = "workspace-left-panel-width";
const COLLAPSED_STORAGE_KEY = "workspace-left-panel-collapsed";

/**
 * Convert stored percentage to pixels
 */
function percentToPixels(percent: number): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  return (percent / 100) * window.innerWidth;
}

/**
 * Load width from localStorage and convert from percentage to pixels
 */
function loadWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const value = parseFloat(stored);
      if (!isNaN(value) && value > 0) {
        const pixels = percentToPixels(value);
        if (pixels >= MIN_WIDTH && pixels <= MAX_WIDTH) {
          return Math.round(pixels);
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_WIDTH;
}

/**
 * Load collapsed state from localStorage
 */
function loadCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

/**
 * Loads sidebar width and collapsed state from localStorage on startup.
 */
export function* initSaga() {
  const width = yield* call(loadWidth);
  const collapsed = yield* call(loadCollapsed);
  yield* put(loadSidebarState(width, collapsed));
}

