import { store } from '../index';
import { getIsDarkTheme } from '../../../../../src/store/renderer/slices/theme/theme-projections';

export const selectIsDarkTheme = store.createSelector(getIsDarkTheme);
