import { call, cancelled, put, type SagaGenerator } from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ConnectionTunnelResult } from '$shared/types/connections';
import { m } from '$shared/paraglide/messages.js';
import { connectionTunnelRequested } from '../connections-slice';
import type { ConnectionTunnelIntent } from '../connections-types';
import {
  settingsFormRequestStarted,
  settingsFormRequestSettled,
} from '../../settings-events/settings-events-slice';
import {
  selectSettingsForm,
  selectSettingsFormRequestCurrent,
} from '../../settings-events/settings-events-selectors';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';

async function requestTunnel(intent: ConnectionTunnelIntent): Promise<ConnectionTunnelResult> {
  if (!window.electronAPI?.invoke) throw new Error(m.settings_devices_connectFailed_error());
  return window.electronAPI.invoke(
    intent.kind === 'load'
      ? IPC_CHANNELS.CONNECTIONS.GET_TUNNEL
      : IPC_CHANNELS.CONNECTIONS.SET_TUNNEL,
    intent.kind === 'load' ? { id: intent.id } : { id: intent.id, enabled: intent.enabled },
  );
}

export function* connectionTunnelSaga(): SagaGenerator<void> {
  yield* takeEveryByContextFIFO(
    connectionTunnelRequested,
    ({ payload: [, intent] }) => intent.id,
    function* ({ payload: [request, intent] }) {
      if (!(yield* selectSettingsForm.effect(request))) return;
      yield* put(settingsFormRequestStarted(request));
      try {
        const result = yield* call(requestTunnel, intent);
        if (yield* selectSettingsFormRequestCurrent.effect(request))
          yield* put(
            settingsFormRequestSettled(request, {
              status: 'succeeded',
              values: { ...result },
            }),
          );
      } catch (cause) {
        if (yield* selectSettingsFormRequestCurrent.effect(request)) {
          const error = cause instanceof Error ? cause.message : String(cause);
          yield* put(
            settingsFormRequestSettled(request, {
              status: 'failed',
              error:
                intent.kind === 'load'
                  ? m.settings_wsApi_loadStatusError({ error })
                  : m.settings_listenTargets_saveError({ error }),
            }),
          );
        }
      } finally {
        if (yield* cancelled())
          yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
      }
    },
    {},
  );
}
