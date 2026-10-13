import { store } from '../index';
import { getFileContentEntry } from '../../../../../src/store/renderer/slices/files/files-projections';

export const selectFileContentEntry = store.createSelector(getFileContentEntry);
