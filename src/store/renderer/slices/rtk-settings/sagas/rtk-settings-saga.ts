import { buffers, channel as createChannel } from 'redux-saga';
import {
  actionChannel,
  call,
  cancelled,
  delay,
  fork,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { invoke } from '$shared/generated/ipc-client';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { notify } from '$lib/components/patterns/notify';
import { addTerminal, openTerminalOverlay } from '../../terminals/terminals-slice';
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
import { rtkInstallStarted, rtkSettingsRequested } from '../rtk-settings-slice';
import { takeEveryByContextFIFO, takeLatestInContext } from '../../../utils/context-saga-effects';

type RequestAction = ReturnType<typeof rtkSettingsRequested>;

function* waitForClose(request: SettingsFormRequest): SagaGenerator<void> {
  while (true) {
    const {
      payload: [identity],
    } = yield* take(settingsFormClosed);
    if (identity.formId === request.formId && identity.sessionId === request.sessionId) return;
  }
}

function* availability(): SagaGenerator<boolean> {
  const result = yield* call(
    invoke<{ data?: { available?: boolean } }>,
    SYSTEM_CHANNELS.CHECK_RTK,
    undefined,
  );
  return result?.data?.available ?? false;
}

function* installFollowup(request: SettingsFormRequest, terminalId: string): SagaGenerator<void> {
  yield* fork(function* (): SagaGenerator<void> {
    yield* delay(1000);
    if (!(yield* selectSettingsForm.effect(request))) return;
    try {
      yield* call(
        [appClient.terminals, appClient.terminals.write],
        terminalId,
        'brew install rtk\n',
      );
    } catch {
      /* The user can type the command manually if the PTY is not ready. */
    }
  });
  for (const wait of [10000, 10000, 10000]) {
    yield* delay(wait);
    if (!(yield* selectSettingsForm.effect(request))) return;
    const probe = { ...request, resource: 'probe', requestId: crypto.randomUUID() };
    yield* put(rtkSettingsRequested(probe, { kind: 'probe' }));
  }
}

function* runRequest(action: RequestAction): SagaGenerator<void> {
  const [request, intent] = action.payload;
  let error: string | undefined;
  const values: Record<string, SettingsFormValue> = {};
  try {
    if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
    if (intent.kind === 'load') {
      try {
        const entry = yield* call([appClient.settings, appClient.settings.get], 'rtk.enabled');
        if (entry === null) error = m.settings_rtk_loadError();
        else {
          values.enabled = typeof entry.value === 'boolean' ? entry.value : false;
          values.settingKnown = true;
        }
      } catch {
        error = m.settings_rtk_loadError();
      }
      if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
      try {
        values.available = yield* call(availability);
      } catch {
        values.available = false;
      }
      values.loaded = true;
    } else if (intent.kind === 'probe') {
      try {
        values.available = yield* call(availability);
      } catch {
        /* A failed recheck leaves the previous availability intact. */
      }
    } else if (intent.kind === 'toggle') {
      yield* call(
        [appClient.settings, appClient.settings.update],
        [{ path: 'rtk.enabled', value: intent.enabled }],
      );
      values.enabled = intent.enabled;
    } else {
      const result = yield* call([appClient.terminals, appClient.terminals.create], {
        workspaceId: ROOT_WORKSPACE_ID,
        cols: 80,
        rows: 24,
      });
      if (!(yield* selectSettingsFormRequestCurrent.effect(request))) return;
      if (!result.success || !result.id) throw new Error('Terminal creation failed');
      yield* put(addTerminal(ROOT_WORKSPACE_ID, result.id, m.settings_rtk_installTerminalTitle()));
      yield* put(openTerminalOverlay(ROOT_WORKSPACE_ID, result.id));
      yield* put(rtkInstallStarted(request, result.id));
    }
    if (yield* selectSettingsFormRequestCurrent.effect(request)) {
      yield* put(
        settingsFormRequestSettled(request, {
          status: error ? 'failed' : 'succeeded',
          error,
          values,
        }),
      );
    }
  } catch {
    if (yield* selectSettingsFormRequestCurrent.effect(request)) {
      error =
        intent.kind === 'install'
          ? m.terminal_adapter_openFailed_error()
          : m.settings_rtk_saveError();
      if (intent.kind === 'install') yield* call(notify.error, error);
      yield* put(settingsFormRequestSettled(request, { status: 'failed', error }));
    }
  } finally {
    if (yield* cancelled())
      yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
  }
}

export function* rtkSettingsSaga(): SagaGenerator<void> {
  // The intake starts status synchronously before the ordered worker sees a write.
  const channel = yield* actionChannel<
    RequestAction | ReturnType<typeof rtkInstallStarted> | ReturnType<typeof settingsFormClosed>
  >([rtkSettingsRequested, rtkInstallStarted, settingsFormClosed], buffers.expanding());
  const writes = createChannel<RequestAction>(buffers.expanding());
  const reads = createChannel<RequestAction>(buffers.expanding());
  const installs = createChannel<ReturnType<typeof rtkInstallStarted>>(buffers.expanding());
  try {
    yield* takeEveryByContextFIFO(writes, () => 'rtk', runRequest, {
      onDiscardPending: function* (action) {
        yield* put(settingsFormRequestSettled(action.payload[0], { status: 'cancelled' }));
      },
    });
    yield* takeLatestInContext(
      reads,
      ({ payload: [request] }) => `${request.formId}:${request.sessionId}:${request.resource}`,
      function* (action) {
        const [request] = action.payload;
        yield* race({
          work: call(runRequest, action),
          closed: call(waitForClose, request),
        });
      },
    );
    yield* takeLatestInContext(
      installs,
      ({ payload: [request] }) => `${request.formId}:${request.sessionId}`,
      function* ({ payload: [request, terminalId] }) {
        yield* race({
          work: call(installFollowup, request, terminalId),
          closed: call(waitForClose, request),
        });
      },
    );
    while (true) {
      const action = yield* take(channel);
      if (action.type === settingsFormClosed.type) {
        continue;
      }
      if (action.type === rtkInstallStarted.type) {
        yield* put(installs, action as ReturnType<typeof rtkInstallStarted>);
        continue;
      }
      const requestAction = action as RequestAction;
      const [request, intent] = requestAction.payload;
      if (!(yield* selectSettingsForm.effect(request))) continue;
      yield* put(settingsFormRequestStarted(request));
      if (intent.kind === 'load' || intent.kind === 'probe') {
        yield* put(reads, requestAction);
      } else yield* put(writes, requestAction);
    }
  } finally {
    channel.close();
    writes.close();
    reads.close();
    installs.close();
  }
}
