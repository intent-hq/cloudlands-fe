import {
  selectAllScrollPositions,
  selectPersistedWorkspaceTabsState,
} from '../tab-state-selectors';
import { createTabStateSaga } from './tab-state-saga-factory';

// Svelte lifetime binding; remove when the Svelte renderer retires.
/** Unregistered until the S20 middleware cutover. */
export const tabStateSaga = createTabStateSaga({
  selectAllScrollPositions,
  selectPersistedWorkspaceTabsState,
});
