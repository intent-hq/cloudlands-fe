import { call, takeEvery } from "typed-redux-saga";
import { setAgentFontStyle, cycleFontStyle } from "../agent-font-settings-slice";
import { selectAgentFontStyle } from "../agent-font-settings-selectors";

const STORAGE_KEY = "agent-font-settings";

function persistFontStyle(fontStyle: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontStyle }));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Watches for font style changes and persists to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    [setAgentFontStyle.type, cycleFontStyle.type],
    function* () {
      const fontStyle = yield* selectAgentFontStyle.effect();
      yield* call(persistFontStyle, fontStyle);
    }
  );
}

