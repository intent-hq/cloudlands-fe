import { all, call, put } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { selectHostAdministrationContext } from '../principal-selectors';
import { initializeGitHubAuth, logoutCompleted } from '../../github-auth/github-auth-slice';
import { githubAuthSaga } from '../../github-auth/sagas/github-auth-saga';
import { actionKeySaga } from '../../hardware-console/sagas/action-key-saga';
import { hardwareConsoleDeviceSaga } from '../../hardware-console/sagas/hardware-console-device-saga';
import { encoderPreferenceSaga } from '../../hardware-console/sagas/encoder-preference-saga';
import { keyPinPersistenceSaga } from '../../hardware-console/sagas/key-pin-persistence-saga';
import { promptPickerSaga } from '../../hardware-console/sagas/prompt-picker-saga';
import { voiceTranscriptionSaga } from '../../hardware-console/sagas/voice-transcription-saga';
import { hostRequirementsSaga } from '../../host-requirements/sagas/host-requirements-saga';
import { hostRequirementsReset } from '../../host-requirements/host-requirements-slice';
import { notificationSettingsSaga } from '../../user-preferences/sagas/notification-settings-saga';
import { voiceSettingsSaga } from '../../voice-settings/sagas/voice-settings-saga';

/** Owns all hardware-console listeners and side effects under one root lifetime. */
export function* hardwareConsoleSaga() {
  yield* all([
    call(hardwareConsoleDeviceSaga),
    call(encoderPreferenceSaga),
    call(actionKeySaga),
    call(keyPinPersistenceSaga),
    call(promptPickerSaga),
    call(voiceTranscriptionSaga),
  ]);
}

/** Host account/settings readers start only after this window is admitted as owner. */
export function* hostOwnerServicesSaga() {
  yield* takeLatestFromSelector(
    selectHostAdministrationContext,
    function* ({ payload }: SelectorChannelPayload<string | null>) {
      yield* put(logoutCompleted());
      yield* put(hostRequirementsReset());
      if (!payload) return;
      yield* all([
        call(hostRequirementsSaga),
        call(hardwareConsoleSaga),
        call(voiceSettingsSaga),
        call(notificationSettingsSaga),
        call(githubAuthSaga),
        put(initializeGitHubAuth()),
      ]);
    },
  );
}
