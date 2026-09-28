import { buffers, channel, type Channel } from 'redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { createLogger } from '$lib/utils/client-logger';
import {
  fastModeHydrationStarted,
  fastModeWriteSettled,
  hydrateProviderFastMode,
  setProviderFastMode,
} from '../provider-settings-slice';
import {
  selectFastModeSupportedProviders,
  selectProviderFastModeState,
} from '../provider-settings-selectors';

const logger = createLogger('ProviderFastModeSaga');
type Edit = { providerId: string; enabled: boolean; editId: number };

function* queueEdit(edits: Channel<Edit>, action: ReturnType<typeof setProviderFastMode>) {
  const [providerId, enabled] = action.payload;
  const state = yield* selectProviderFastModeState.effect();
  const edit = state?.pending[providerId];
  if (!edit) return;
  if (!(yield* selectFastModeSupportedProviders.effect()).includes(providerId)) {
    yield* put(fastModeWriteSettled(providerId, edit.editId));
    return;
  }
  yield* put(edits, { providerId, enabled, editId: edit.editId });
}

function* persistEdits(edits: Channel<Edit>) {
  while (true) {
    const { providerId, enabled, editId } = yield* take(edits);
    // Merge one click over the latest confirmed map at dequeue time. Never
    // persist another provider's optimistic value or snapshot the whole map
    // when enqueuing: either would lose changes behind a slow/rejected write.
    const { confirmed } = yield* selectProviderFastModeState.effect();
    const changes = [
      { path: 'providers.fastMode', value: { ...confirmed, [providerId]: enabled } },
    ];
    try {
      const result = appClient.settings.updateSnapshot
        ? yield* call([appClient.settings, appClient.settings.updateSnapshot], changes)
        : {
            applied: yield* call([appClient.settings, appClient.settings.update], changes),
            revision: undefined,
          };
      const applied = result.applied.find((change) => change.path === 'providers.fastMode');
      if (
        !applied ||
        !applied.value ||
        typeof applied.value !== 'object' ||
        Array.isArray(applied.value)
      ) {
        throw new Error('Missing providers.fastMode write acknowledgement');
      }
      yield* put(
        hydrateProviderFastMode(applied.value as Record<string, boolean>, result.revision),
      );
    } catch (error) {
      logger.warn('Failed to save provider Fast mode', { error });
      yield* call([notify, notify.error], m.settings_providers_fastMode_error());
    }
    yield* put(fastModeWriteSettled(providerId, editId));
  }
}

export function* providerFastModeSaga() {
  while (true) {
    const edits = channel<Edit>(buffers.expanding());
    try {
      // Reconnect/backend switches discard this connection's queue and cancel
      // response handlers. The new settings snapshot supplies its own values.
      yield* race({
        writes: all([call(persistEdits, edits), takeEvery(setProviderFastMode, queueEdit, edits)]),
        reconnect: take(fastModeHydrationStarted),
      });
    } finally {
      edits.close();
    }
  }
}
