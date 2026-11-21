import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  clearAutocompleteApiKey,
  loadAutocompleteSettings,
  saveAutocompleteApiKey,
  setAutocompleteEnabled,
  setAutocompleteModel,
  setAutocompleteService,
} from '$features/autocomplete/autocomplete-settings-service';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  changeAutocompleteEnabled,
  changeAutocompleteModel,
  changeAutocompleteService,
  clearAutocompleteKey,
  initialState,
  initializeAutocompleteSettings,
  saveAutocompleteKey,
  setAutocompleteBusyService,
  setAutocompleteEnabledValue,
  setAutocompleteKeyConfigured,
  setAutocompleteModelValue,
  setAutocompleteServiceValue,
  setAutocompleteSettingsError,
  setAutocompleteSettingsSnapshot,
} from '../autocomplete-settings-slice';
import { selectAutocompleteSettings } from '../autocomplete-settings-selectors';

const logger = createLogger('AutocompleteSettingsSaga');

function* initializeWorker(): SagaGenerator<void> {
  try {
    const snapshot = yield* call(loadAutocompleteSettings);
    yield* put(setAutocompleteSettingsSnapshot(snapshot));
  } catch (error) {
    // An unreadable catalog hides the section; the composer stays off.
    yield* put(
      setAutocompleteSettingsSnapshot({
        available: false,
        enabled: false,
        service: initialState.service,
        model: initialState.model,
        keyConfigured: initialState.keyConfigured,
      }),
    );
    logger.error('initialize error', error);
  }
}

function* persistEnabled(enabled: boolean): SagaGenerator<void> {
  const previous = (yield* selectAutocompleteSettings.effect()).enabled;
  if (previous === enabled) return;
  yield* put(setAutocompleteSettingsError(null));
  yield* put(setAutocompleteEnabledValue(enabled));
  try {
    yield* call(setAutocompleteEnabled, enabled);
  } catch (error) {
    yield* put(setAutocompleteEnabledValue(previous));
    yield* put(setAutocompleteSettingsError(m.settings_autocomplete_saveFailed_error()));
    logger.error('enabled change error', error);
  }
}

function* changeEnabledWorker(
  action: ReturnType<typeof changeAutocompleteEnabled>,
): SagaGenerator<void> {
  yield* call(persistEnabled, action.payload[0]);
}

function* changeServiceWorker(
  action: ReturnType<typeof changeAutocompleteService>,
): SagaGenerator<void> {
  const [service, disableFirst = false] = action.payload;
  const previous = (yield* selectAutocompleteSettings.effect()).service;
  if (previous === service) return;
  if (disableFirst) {
    // Off first: the new service must not run until its gate passes.
    yield* call(persistEnabled, false);
    if ((yield* selectAutocompleteSettings.effect()).enabled) return;
  }
  yield* put(setAutocompleteSettingsError(null));
  yield* put(setAutocompleteServiceValue(service));
  try {
    yield* call(setAutocompleteService, service);
  } catch (error) {
    yield* put(setAutocompleteServiceValue(previous));
    yield* put(setAutocompleteSettingsError(m.settings_autocomplete_saveFailed_error()));
    logger.error('service change error', error);
  }
}

function* changeModelWorker(
  action: ReturnType<typeof changeAutocompleteModel>,
): SagaGenerator<void> {
  const [model] = action.payload;
  const previous = (yield* selectAutocompleteSettings.effect()).model;
  if (previous === model) return;
  yield* put(setAutocompleteSettingsError(null));
  yield* put(setAutocompleteModelValue(model));
  try {
    yield* call(setAutocompleteModel, model);
  } catch (error) {
    yield* put(setAutocompleteModelValue(previous));
    yield* put(setAutocompleteSettingsError(m.settings_autocomplete_saveFailed_error()));
    logger.error('model change error', error);
  }
}

function* saveKeyWorker(action: ReturnType<typeof saveAutocompleteKey>): SagaGenerator<void> {
  const [service, apiKey, enableAfter] = action.payload;
  yield* put(setAutocompleteSettingsError(null));
  yield* put(setAutocompleteBusyService(service));
  let saved = false;
  try {
    yield* call(saveAutocompleteApiKey, service, apiKey);
    yield* put(setAutocompleteKeyConfigured(service, true));
    saved = true;
  } catch (error) {
    yield* put(setAutocompleteSettingsError(m.settings_autocomplete_keySaveFailed_error()));
    logger.error('key save error', error);
  } finally {
    yield* put(setAutocompleteBusyService(null));
  }
  if (saved && enableAfter) yield* call(persistEnabled, true);
}

function* clearKeyWorker(action: ReturnType<typeof clearAutocompleteKey>): SagaGenerator<void> {
  const [service, disableFirst] = action.payload;
  if (disableFirst) {
    // Off first: a request between the key delete and the switch-off would go keyless.
    yield* call(persistEnabled, false);
    if ((yield* selectAutocompleteSettings.effect()).enabled) return;
  }
  yield* put(setAutocompleteSettingsError(null));
  yield* put(setAutocompleteBusyService(service));
  try {
    yield* call(clearAutocompleteApiKey, service);
    yield* put(setAutocompleteKeyConfigured(service, false));
  } catch (error) {
    yield* put(setAutocompleteSettingsError(m.settings_autocomplete_keyClearFailed_error()));
    logger.error('key clear error', error);
  } finally {
    yield* put(setAutocompleteBusyService(null));
  }
}

export function* autocompleteSettingsSaga(): SagaGenerator<void> {
  yield* all([
    call(initializeWorker),
    takeEvery(initializeAutocompleteSettings, initializeWorker),
    takeEvery(changeAutocompleteEnabled, changeEnabledWorker),
    takeEvery(changeAutocompleteService, changeServiceWorker),
    takeEvery(changeAutocompleteModel, changeModelWorker),
    takeEvery(saveAutocompleteKey, saveKeyWorker),
    takeEvery(clearAutocompleteKey, clearKeyWorker),
  ]);
}
