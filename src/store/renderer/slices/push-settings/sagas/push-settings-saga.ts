import { buffers, channel as createChannel } from 'redux-saga';
import { actionChannel, call, cancelled, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { m } from '$shared/paraglide/messages.js';
import {
  settingsFormClosed,
  settingsFormRequestStarted,
  settingsFormRequestSettled,
} from '../../settings-events/settings-events-slice';
import {
  selectSettingsForm,
  selectSettingsFormRequestCurrent,
} from '../../settings-events/settings-events-selectors';
import type {
  SettingsFormRequest,
  SettingsFormValue,
} from '../../settings-events/settings-events-types';
import { pushSettingsRequested } from '../push-settings-slice';
import { takeEveryByContextFIFO, takeLatestInContext } from '../../../utils/context-saga-effects';

type RequestAction = ReturnType<typeof pushSettingsRequested>;

function* waitForClose(request: SettingsFormRequest): SagaGenerator<void> {
  while (true) {
    const {
      payload: [identity],
    } = yield* take(settingsFormClosed);
    if (identity.formId === request.formId && identity.sessionId === request.sessionId) return;
  }
}

function* loadStatus(request: SettingsFormRequest): SagaGenerator<void> {
  const values: Record<string, SettingsFormValue> = { loaded: true };
  let error: string | undefined;
  try {
    const status = yield* call([appClient.push, appClient.push.status]);
    values.supported = status !== null;
    if (status) {
      values.enabled = status.enabled;
      values.linked = status.linked;
      values.linkedDevices = status.linkedDevices;
      values.publishing = status.publishing;
    }
  } catch {
    error = m.settings_push_statusError();
  }
  if (yield* selectSettingsFormRequestCurrent.effect(request)) {
    yield* put(
      settingsFormRequestSettled(request, { status: error ? 'failed' : 'succeeded', error, values }),
    );
  }
}

function* saveEnabled(request: SettingsFormRequest, enabled: boolean): SagaGenerator<void> {
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: 'push.relayEnabled', value: enabled }],
    );
    if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
    yield* put(settingsFormRequestSettled(request, { status: 'succeeded', values: { enabled } }));
    const refresh = { ...request, resource: 'load', requestId: crypto.randomUUID() };
    yield* put(pushSettingsRequested(refresh, { kind: 'load' }));
  } catch {
    if (yield* selectSettingsFormRequestCurrent.effect(request)) {
      yield* put(
        settingsFormRequestSettled(request, { status: 'failed', error: m.settings_push_saveError() }),
      );
    }
  } finally {
    if (yield* cancelled())
      yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
  }
}

export function* pushSettingsSaga(): SagaGenerator<void> {
  const channel = yield* actionChannel<RequestAction>(pushSettingsRequested, buffers.expanding());
  const writes = createChannel<RequestAction>(buffers.expanding());
  const reads = createChannel<RequestAction>(buffers.expanding());
  try {
    yield* takeEveryByContextFIFO(
      writes,
      () => 'push',
      function* ({ payload: [request, intent] }) {
        if (intent.kind === 'toggle') yield* call(saveEnabled, request, intent.enabled);
      },
      {
        onDiscardPending: function* (action) {
          yield* put(settingsFormRequestSettled(action.payload[0], { status: 'cancelled' }));
        },
      },
    );
    yield* takeLatestInContext(
      reads,
      ({ payload: [request] }) => `${request.formId}:${request.sessionId}`,
      function* ({ payload: [request] }) {
        yield* race({ work: call(loadStatus, request), closed: call(waitForClose, request) });
      },
    );
    while (true) {
      const action = yield* take(channel);
      const [request, intent] = action.payload;
      if (!(yield* selectSettingsForm.effect(request))) continue;
      yield* put(settingsFormRequestStarted(request));
      yield* put(intent.kind === 'load' ? reads : writes, action);
    }
  } finally {
    channel.close();
    writes.close();
    reads.close();
  }
}
