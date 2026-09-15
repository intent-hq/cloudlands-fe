/**
 * Main-process store bridge (neutralized).
 *
 * The main-process Redux StreamingStore has been removed. This function is
 * retained as a no-op so main-process services that historically read state
 * continue to type-check; in the mock-driven app the renderer never relies on
 * real main-process state.
 */

import type { MainStoreState } from './types';

/** Returns an empty state snapshot; no main-process store exists. */
export function getMainState(): MainStoreState {
  return {} as MainStoreState;
}

/**
 * No-op test-only reset retained for API compatibility.
 * @internal
 */
function _resetMainStoreBridge(): void {}
