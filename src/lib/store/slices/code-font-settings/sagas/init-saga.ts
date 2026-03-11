import { call, put } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { setCodeFontFamily, setSystemFonts } from "../code-font-settings-slice";

const STORAGE_KEY = "code-font-settings";

function loadFromLocalStorage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.fontFamily || 'system-default';
    }
  } catch {
    // Ignore parse errors
  }
  return 'system-default';
}

async function loadSystemFonts(): Promise<string[]> {
  try {
    const result = (await invoke('system:list-fonts', {})) as
      | { success: true; data: string[] }
      | { success: false; error: string };

    if (result.success) {
      return result.data;
    }
  } catch (error) {
    console.warn('Failed to load system fonts:', error);
  }
  return [];
}

/**
 * Loads code font settings from localStorage on startup
 * and invokes IPC to load system fonts.
 */
export function* initSaga() {
  const fontFamily = yield* call(loadFromLocalStorage);
  yield* put(setCodeFontFamily(fontFamily));

  // Load system fonts via IPC
  const fonts: string[] = yield* call(loadSystemFonts);
  if (fonts.length > 0) {
    yield* put(setSystemFonts(fonts));
  }
}

