/**
 * Main-process store bridge (neutralized).
 *
 * The main-process Redux StreamingStore has been removed. These functions are
 * retained as no-ops so main-process services that historically dispatched
 * actions or read state continue to type-check; in the mock-driven app the
 * renderer never relies on real main-process state.
 */

import type { MainStoreState } from './types';

type MainAction = { type: string };

/** Returns an empty state snapshot; no main-process store exists. */
export function getMainState(): MainStoreState {
  return {} as MainStoreState;
}

/** No-op dispatch: returns the action unchanged. */
export const mainDispatch = <A extends MainAction>(action: A): A => action;

/**
 * No-op test-only reset retained for API compatibility.
 * @internal
 */
function _resetMainStoreBridge(): void {}
