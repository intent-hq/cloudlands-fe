import { store } from '$store/renderer/store';
import { websocketApiSaga } from '$store/renderer/slices/websocket-api/sagas/websocket-api-saga';
import { rtkSettingsSaga } from '$store/renderer/slices/rtk-settings/sagas/rtk-settings-saga';
import { settingsFormSaga } from '$store/renderer/slices/settings-events/sagas/settings-form-saga';

/** Preview mode omits production roots; mount only the owner used by each scene. */
export const setupApiSettingsPreview = () => store.runSaga(websocketApiSaga);
export const setupSettingsFormPreview = () => store.runSaga(settingsFormSaga);
export const setupRtkSettingsPreview = () => {
  const stopRtk = store.runSaga(rtkSettingsSaga);
  const stopForms = store.runSaga(settingsFormSaga);
  return () => {
    stopRtk();
    stopForms();
  };
};
