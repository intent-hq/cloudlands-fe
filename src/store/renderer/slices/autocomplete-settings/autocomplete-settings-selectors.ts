import { store } from '../../store';

export const selectAutocompleteSettings = store.createSelector(
  (state) => state.autocompleteSettings,
);

/** The composer asks for suggestions only when the daemon knows the setting and it is on. */
export const selectAutocompleteActive = store.createSelector(
  (state) => state.autocompleteSettings.available && state.autocompleteSettings.enabled,
);
