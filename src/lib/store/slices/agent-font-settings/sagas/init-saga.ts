import { call, put } from "typed-redux-saga";
import { setAgentFontStyle, type AgentFontStyle } from "../agent-font-settings-slice";

const STORAGE_KEY = "agent-font-settings";
const DEFAULT_FONT_STYLE: AgentFontStyle = "sans";

function loadFromLocalStorage(): AgentFontStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
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

/**
 * Loads agent font settings from localStorage on startup.
 */
export function* initSaga() {
  const fontStyle = yield* call(loadFromLocalStorage);
  yield* put(setAgentFontStyle(fontStyle));
}

