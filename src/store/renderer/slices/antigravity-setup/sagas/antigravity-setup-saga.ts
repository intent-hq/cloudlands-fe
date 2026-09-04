import type { Task } from 'redux-saga';
import { call, cancel, delay, fork, put, take } from 'typed-redux-saga';
import {
  closeAntigravitySetup,
  requestAntigravitySetup,
} from '$features/antigravity/antigravity-setup.client';
import { isAntigravitySetupBusy } from '$shared/types/antigravity-setup';
import { getModelsForProviderForLoadingState } from '../../model/model-utils';
import { providerModelsLoaded } from '../../provider-models/provider-models-slice';
import { selectProviderModelsClearEpoch } from '../../provider-models/provider-models-selectors';
import { setProviderEnabled } from '../../provider-settings/provider-settings-slice';
import { selectAntigravitySetup } from '../antigravity-setup-selectors';
import {
  antigravitySetupReceived,
  antigravitySetupRequested,
  antigravitySetupVerified,
  type SetupCommand,
} from '../antigravity-setup-slice';

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

export function* antigravitySetupSaga() {
  let task: Task | undefined;
  let activeGeneration = -1;
  try {
    while (true) {
      const action = yield* take(antigravitySetupRequested);
      const state = yield* selectAntigravitySetup.effect();
      if (task?.isRunning() && activeGeneration === state.generation) continue;
      if (task) yield* cancel(task);
      activeGeneration = state.generation;
      task = yield* fork(antigravitySetupWorker, action.payload[0], state.generation);
    }
  } finally {
    if (task) yield* cancel(task);
    yield* call(closeAntigravitySetup);
  }
}
