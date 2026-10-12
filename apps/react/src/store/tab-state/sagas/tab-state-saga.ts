import { createTabStateSaga } from '../../../../../../src/store/renderer/slices/tab-state/sagas/tab-state-saga-factory';
import {
  selectAllScrollPositions,
  selectPersistedWorkspaceTabsState,
} from '../tab-state-selectors';

/** Root-owned persistence binding; constructing it does not start the saga. */
export const tabStateSaga = createTabStateSaga({
  selectAllScrollPositions,
  selectPersistedWorkspaceTabsState,
});
