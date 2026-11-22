import { buffers } from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  put,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

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

/**
 * Turn on only if the service as settled now may run: it has a key, or it is
 * keyless Kilo and the user just confirmed the data dialog. Queued actions may
 * have changed the service since the view decided, so the view cannot gate this.
 */
function* enableIfAllowed(kiloConsent: boolean): SagaGenerator<void> {
  const { service, keyConfigured } = yield* selectAutocompleteSettings.effect();
  if (!keyConfigured[service] && !(service === 'kilo' && kiloConsent)) {
    logger.debug('enable skipped: the selected service needs a key or confirmation');
    return;
  }
  yield* call(persistEnabled, true);
}

function* changeEnabledWorker(
  action: ReturnType<typeof changeAutocompleteEnabled>,
): SagaGenerator<void> {
  const [enabled, kiloConsent = false] = action.payload;
  if (enabled) yield* call(enableIfAllowed, kiloConsent);
  else yield* call(persistEnabled, false);
}

function* changeServiceWorker(
  action: ReturnType<typeof changeAutocompleteService>,
): SagaGenerator<void> {
  const [service] = action.payload;
  const current = yield* selectAutocompleteSettings.effect();
  const previous = current.service;
  if (previous === service) return;
  if (current.enabled && !current.keyConfigured[service]) {
    // Decided here, after earlier mutations settled: a keyless service must
    // not run until its consent or key gate passes, so turn off first.
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
  if (saved && enableAfter) yield* call(enableIfAllowed, false);
}

function* clearKeyWorker(action: ReturnType<typeof clearAutocompleteKey>): SagaGenerator<void> {
  const [service] = action.payload;
  const current = yield* selectAutocompleteSettings.effect();
  if (current.enabled && current.service === service) {
    // Decided from settled state, not the view's flag: removing the active key
    // while on must switch off first, or requests would go keyless.
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

type Mutation =
  | ReturnType<typeof changeAutocompleteEnabled>
  | ReturnType<typeof changeAutocompleteService>
  | ReturnType<typeof saveAutocompleteKey>
  | ReturnType<typeof clearAutocompleteKey>;

/**
 * Enabled, service and key changes run one at a time: each decides its gate
 * from settled state, so an overlapping switch-off and service change cannot
 * leave a keyless service on without consent.
 */
function* serialMutations(): SagaGenerator<void> {
  const channel = yield* actionChannel<Mutation>(
    [
      changeAutocompleteEnabled,
      changeAutocompleteService,
      saveAutocompleteKey,
      clearAutocompleteKey,
    ],
    buffers.expanding(),
  );
  while (true) {
    const action = yield* take(channel);
    if (action.type === changeAutocompleteEnabled.type)
      yield* call(changeEnabledWorker, action as ReturnType<typeof changeAutocompleteEnabled>);
    else if (action.type === changeAutocompleteService.type)
      yield* call(changeServiceWorker, action as ReturnType<typeof changeAutocompleteService>);
    else if (action.type === saveAutocompleteKey.type)
      yield* call(saveKeyWorker, action as ReturnType<typeof saveAutocompleteKey>);
    else yield* call(clearKeyWorker, action as ReturnType<typeof clearAutocompleteKey>);
  }
}

export function* autocompleteSettingsSaga(): SagaGenerator<void> {
  yield* all([
    call(initializeWorker),
    takeEvery(initializeAutocompleteSettings, initializeWorker),
    call(serialMutations),
    takeEvery(changeAutocompleteModel, changeModelWorker),
  ]);
}
