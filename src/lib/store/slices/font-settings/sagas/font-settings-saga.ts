import { invoke } from "$lib/electron-bridge";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, fork, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  cycleFontStyle,
  cycleNoteFontStyle,
  setAgentFontStyle,
  setCodeFontFamily,
  setNoteFontStyle,
  setSystemFonts,
  type FontStyle,
} from "../font-settings-slice";
import {
  selectAgentFontStyle,
  selectCodeFontFamily,
  selectNoteFontStyle,
} from "../font-settings-selectors";

const AGENT_STORAGE_KEY = "agent-font-settings";
const NOTE_STORAGE_KEY = "note-font-settings";
const CODE_STORAGE_KEY = "code-font-settings";
const DEFAULT_FONT_STYLE: FontStyle = 'sans';
const DEFAULT_CODE_FONT_FAMILY = 'system-default';

function* loadFontStyleFromLocalStorage(storageKey: string): SagaGenerator<FontStyle> {
  try {
    const stored = yield* call(getLocalStorageItem, storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.fontStyle === 'sans' || parsed?.fontStyle === 'monospace') {
        return parsed.fontStyle;
      }
    }
  } catch {
    // Ignore parse errors
  }

  return DEFAULT_FONT_STYLE;
}

function* loadCodeFontFamilyFromLocalStorage(): SagaGenerator<string> {
  try {
    const stored = yield* call(getLocalStorageItem, CODE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.fontFamily || DEFAULT_CODE_FONT_FAMILY;
    }
  } catch {
    // Ignore parse errors
  }

  return DEFAULT_CODE_FONT_FAMILY;
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

function* persistFontStyle(storageKey: string, fontStyle: FontStyle): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageItem, storageKey, JSON.stringify({ fontStyle }));
  } catch {
    // Ignore storage errors
  }
}

function* persistCodeFontFamily(fontFamily: string): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageItem, CODE_STORAGE_KEY, JSON.stringify({ fontFamily }));
  } catch {
    // Ignore storage errors
  }
}

function* watchAgentFontStylePersistence() {
  yield* takeEvery([setAgentFontStyle.type, cycleFontStyle.type], function* () {
    const fontStyle = yield* selectAgentFontStyle.effect();
    yield* call(persistFontStyle, AGENT_STORAGE_KEY, fontStyle);
  });
}

function* watchNoteFontStylePersistence() {
  yield* takeEvery([setNoteFontStyle.type, cycleNoteFontStyle.type], function* () {
    const fontStyle = yield* selectNoteFontStyle.effect();
    yield* call(persistFontStyle, NOTE_STORAGE_KEY, fontStyle);
  });
}

function* watchCodeFontFamilyPersistence() {
  yield* takeEvery(setCodeFontFamily.type, function* () {
    const fontFamily = yield* selectCodeFontFamily.effect();
    yield* call(persistCodeFontFamily, fontFamily);
  });
}

export function* fontSettingsSaga() {
  const agentFontStyle = yield* call(loadFontStyleFromLocalStorage, AGENT_STORAGE_KEY);
  yield* put(setAgentFontStyle(agentFontStyle));

  const noteFontStyle = yield* call(loadFontStyleFromLocalStorage, NOTE_STORAGE_KEY);
  yield* put(setNoteFontStyle(noteFontStyle));

  const codeFontFamily = yield* call(loadCodeFontFamilyFromLocalStorage);
  yield* put(setCodeFontFamily(codeFontFamily));

  const fonts = yield* call(loadSystemFonts);
  if (fonts.length > 0) {
    yield* put(setSystemFonts(fonts));
  }

  yield* fork(watchAgentFontStylePersistence);
  yield* fork(watchNoteFontStylePersistence);
  yield* fork(watchCodeFontFamilyPersistence);
}