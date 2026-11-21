import {
  AUTOCOMPLETE_DEFAULT_MODEL,
  AUTOCOMPLETE_DEFAULT_SERVICE,
  type AutocompleteModel,
  type AutocompleteService,
} from '$features/autocomplete/autocomplete-settings-constants';
import type { AutocompleteSettingsSnapshot } from '$features/autocomplete/autocomplete-settings-service';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { AutocompleteSettingsSliceState } from './autocomplete-settings-types';

export const initialState: AutocompleteSettingsSliceState = {
  isLoading: true,
  available: false,
  enabled: false,
  service: AUTOCOMPLETE_DEFAULT_SERVICE,
  model: AUTOCOMPLETE_DEFAULT_MODEL,
  keyConfigured: { kilo: false, openrouter: false },
  busyService: null,
  error: null,
};

// --- Triggers (handled by the saga) ---

/** Load the `[autocomplete]` settings from the daemon. */
export const initializeAutocompleteSettings = createAction('autocompleteSettings/initialize');

/** Persist `autocomplete.enabled` (optimistic, rolls back on failure). */
export const changeAutocompleteEnabled = createAction<[enabled: boolean]>(
  'autocompleteSettings/changeEnabled',
);

/** Persist `autocomplete.service` (optimistic, rolls back on failure). */
/** Change the service; a keyless target while on turns autocomplete off first (kept old service on failure). */
export const changeAutocompleteService = createAction<[service: AutocompleteService]>(
  'autocompleteSettings/changeService',
);

/** Persist `autocomplete.model` (optimistic, rolls back on failure). */
export const changeAutocompleteModel = createAction<[model: AutocompleteModel]>(
  'autocompleteSettings/changeModel',
);

/** Store a pasted key; with `enableAfter`, turn autocomplete on once the key is saved. */
export const saveAutocompleteKey = createAction<
  [service: AutocompleteService, apiKey: string, enableAfter: boolean]
>('autocompleteSettings/saveKey');

/** Delete a stored key; with `disableFirst`, turn autocomplete off before deleting it. */
export const clearAutocompleteKey = createAction<
  [service: AutocompleteService, disableFirst: boolean]
>('autocompleteSettings/clearKey');

// --- State setters ---

export const setAutocompleteSettingsSnapshot = createAction<
  [snapshot: AutocompleteSettingsSnapshot]
>('autocompleteSettings/setSnapshot');

export const setAutocompleteEnabledValue = createAction<[enabled: boolean]>(
  'autocompleteSettings/setEnabledValue',
);

export const setAutocompleteServiceValue = createAction<[service: AutocompleteService]>(
  'autocompleteSettings/setServiceValue',
);

export const setAutocompleteModelValue = createAction<[model: AutocompleteModel]>(
  'autocompleteSettings/setModelValue',
);

export const setAutocompleteKeyConfigured = createAction<
  [service: AutocompleteService, configured: boolean]
>('autocompleteSettings/setKeyConfigured');

export const setAutocompleteBusyService = createAction<[service: AutocompleteService | null]>(
  'autocompleteSettings/setBusyService',
);

export const setAutocompleteSettingsError = createAction<[error: string | null]>(
  'autocompleteSettings/setError',
);

// --- Reducer ---

export const autocompleteSettingsReducer =
  createReducer<AutocompleteSettingsSliceState>(initialState);
autocompleteSettingsReducer.with(setAutocompleteSettingsSnapshot, (state, { payload: [snap] }) => ({
  ...state,
  isLoading: false,
  available: snap.available,
  enabled: snap.enabled,
  service: snap.service,
  model: snap.model,
  keyConfigured: snap.keyConfigured,
}));
autocompleteSettingsReducer.with(setAutocompleteEnabledValue, (state, { payload: [enabled] }) => ({
  ...state,
  enabled,
}));
autocompleteSettingsReducer.with(setAutocompleteServiceValue, (state, { payload: [service] }) => ({
  ...state,
  service,
}));
autocompleteSettingsReducer.with(setAutocompleteModelValue, (state, { payload: [model] }) => ({
  ...state,
  model,
}));
autocompleteSettingsReducer.with(
  setAutocompleteKeyConfigured,
  (state, { payload: [service, configured] }) => ({
    ...state,
    keyConfigured: { ...state.keyConfigured, [service]: configured },
  }),
);
autocompleteSettingsReducer.with(setAutocompleteBusyService, (state, { payload: [service] }) => ({
  ...state,
  busyService: service,
}));
autocompleteSettingsReducer.with(setAutocompleteSettingsError, (state, { payload: [error] }) => ({
  ...state,
  error,
}));
