import { store } from '../index';
import { getAllWorkspaceScriptEntries } from '../../../../../src/store/renderer/slices/scripts/scripts-projections';

export const selectAllWorkspaceScriptEntries = store.createSelector(getAllWorkspaceScriptEntries);
