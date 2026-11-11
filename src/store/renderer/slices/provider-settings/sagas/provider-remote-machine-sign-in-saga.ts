import { buffers, channel, type Channel } from 'redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { createLogger } from '$lib/utils/client-logger';
import { REMOTE_MACHINE_SIGN_IN_SETTING } from '$shared/provider-profiles';
import {
  fastModeHydrationStarted,
  hydrateRemoteMachineSignIn,
  remoteMachineSignInWriteSettled,
  setRemoteMachineSignIn,
} from '../provider-settings-slice';
import { selectRemoteMachineSignInState } from '../provider-settings-selectors';

const logger = createLogger('ProviderRemoteMachineSignInSaga');
type Edit = { providerId: string; enabled: boolean; editId: number };

function* queueEdit(edits: Channel<Edit>, action: ReturnType<typeof setRemoteMachineSignIn>) {
  const [providerId, enabled] = action.payload;
  const edit = (yield* selectRemoteMachineSignInState.effect())?.pending[providerId];
  if (edit) yield* put(edits, { providerId, enabled, editId: edit.editId });
}

/** One click at a time, merged over the latest confirmed map (as for Fast mode). */
function* persistEdits(edits: Channel<Edit>) {
  while (true) {
    const { providerId, enabled, editId } = yield* take(edits);
    const { confirmed } = yield* selectRemoteMachineSignInState.effect();
    const changes = [
      { path: REMOTE_MACHINE_SIGN_IN_SETTING, value: { ...confirmed, [providerId]: enabled } },
    ];
    try {
      const result = appClient.settings.updateSnapshot
        ? yield* call([appClient.settings, appClient.settings.updateSnapshot], changes)
        : {
            applied: yield* call([appClient.settings, appClient.settings.update], changes),
            revision: undefined,
          };
      const applied = result.applied.find(
        (change) => change.path === REMOTE_MACHINE_SIGN_IN_SETTING,
      );
      const value = applied?.value;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`Missing ${REMOTE_MACHINE_SIGN_IN_SETTING} write acknowledgement`);
      yield* put(hydrateRemoteMachineSignIn(value as Record<string, boolean>, result.revision));
    } catch (error) {
      logger.warn('Failed to save remote sign-in setting', { error });
      yield* call([notify, notify.error], m.settings_providerRemote_machineSignIn_error());
    }
    yield* put(remoteMachineSignInWriteSettled(providerId, editId));
  }
}

export function* providerRemoteMachineSignInSaga() {
  while (true) {
    const edits = channel<Edit>(buffers.expanding());
    try {
      yield* race({
        writes: all([
          call(persistEdits, edits),
          takeEvery(setRemoteMachineSignIn, queueEdit, edits),
        ]),
        reconnect: take(fastModeHydrationStarted),
      });
    } finally {
      edits.close();
    }
  }
}
