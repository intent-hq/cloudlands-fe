import { store } from '../index';
import { getTerminalsForWorkspace } from '../../../../../src/store/renderer/slices/terminals/terminals-projections';

export const selectTerminalsForWorkspace = store.createSelector(getTerminalsForWorkspace);
