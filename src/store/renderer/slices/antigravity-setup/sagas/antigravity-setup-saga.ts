import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { call, delay, join, put } from 'typed-redux-saga';
import {
  closeAntigravitySetup,
  requestAntigravitySetup,
} from '$features/antigravity/antigravity-setup.client';
import { isAntigravitySetupBusy } from '$shared/types/antigravity-setup';
import { getModelsForProviderForLoadingState } from '../../model/model-utils';
import { providerModelsLoaded } from '../../provider-models/provider-models-slice';
import { selectProviderModelsClearEpoch } from '../../provider-models/provider-models-selectors';
import { setProviderEnabled } from '../../provider-settings/provider-settings-slice';
import {
  selectAntigravitySetup,
  selectAntigravitySetupRequest,
} from '../antigravity-setup-selectors';
import {
  antigravitySetupReceived,
  antigravitySetupVerified,
  type SetupCommand,
} from '../antigravity-setup-slice';

type SetupRequest = { generation: number; command: SetupCommand };

export function* antigravitySetupWorker(command: SetupCommand, generation: number) {
  try {
    const previous = (yield* selectAntigravitySetup.effect()).result;
    if (command === 'close' || command === 'cancel') {
      // Closing the private connection cancels even a start whose ID has not
      // arrived yet. No late success can enable the provider after this action.
      yield* call(closeAntigravitySetup);
      if (command === 'cancel' && previous?.ok) {
        yield* put(
          antigravitySetupReceived(generation, {
            ok: true,
            status: { ...previous.status, phase: 'cancelled' },
          }),
        );
      }
      return;
    }
    if (command === 'start') yield* call(closeAntigravitySetup);
    let result = yield* call(
      requestAntigravitySetup,
      command,
      command === 'login' && previous?.ok ? (previous.status.operationId ?? undefined) : undefined,
    );
    while (result.ok && isAntigravitySetupBusy(result.status)) {
      yield* put(antigravitySetupReceived(generation, result));
      yield* delay(500);
      result = yield* call(requestAntigravitySetup, 'status' as const);
    }
    if (result.ok && result.status.phase === 'connected' && command !== 'status') {
      const connected = result.status;
      yield* put(
        antigravitySetupReceived(generation, {
          ok: true,
          status: { ...connected, phase: 'checking' },
        }),
      );
      const epoch = yield* selectProviderModelsClearEpoch.effect();
      const models = yield* call(getModelsForProviderForLoadingState, 'antigravity', {
        forceRefresh: true,
      });
      // Recheck the original local connection after model refresh; a window
      // switch or daemon reconnect must not publish results for another host.
      const stillConnected = yield* call(requestAntigravitySetup, 'status' as const);
      if (
        !stillConnected.ok ||
        stillConnected.status.operationId !== connected.operationId ||
        stillConnected.status.phase !== 'connected' ||
        (yield* selectProviderModelsClearEpoch.effect()) !== epoch
      ) {
        result = { ok: false, code: 'connectionLost' };
      } else if (!models.models.length || models.stale || models.warning) {
        result = { ok: true, status: { ...connected, phase: 'failed', code: 'modelsUnavailable' } };
      } else if ((yield* selectAntigravitySetup.effect()).generation === generation) {
        yield* put(antigravitySetupVerified());
        yield* put(providerModelsLoaded('antigravity', models, epoch));
        yield* put(setProviderEnabled({ providerId: 'antigravity', enabled: true }));
      }
    }
    yield* put(antigravitySetupReceived(generation, result));
  } catch {
    yield* put(antigravitySetupReceived(generation, { ok: false, code: 'connectionLost' }));
  }
}

function* antigravitySetupRequestWorker({
  payload,
  prevPayload,
}: SelectorChannelPayload<SetupRequest>) {
  // The selector channel replays the idle initial state once; nothing was requested yet.
  if (prevPayload == null) return;
  yield* call(antigravitySetupWorker, payload.command, payload.generation);
}

export function* antigravitySetupSaga() {
  // A repeated start/login the reducer deduped leaves the generation unchanged, so
  // the running attempt keeps going; any other request cancels it and runs the latest.
  const watcher = yield* takeLatestFromSelector(
    selectAntigravitySetupRequest,
    antigravitySetupRequestWorker,
  );
  try {
    yield* join(watcher);
  } finally {
    yield* call(closeAntigravitySetup);
  }
}
