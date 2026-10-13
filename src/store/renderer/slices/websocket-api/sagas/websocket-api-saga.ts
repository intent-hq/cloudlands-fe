import { captureSettingsWork } from '$features/settings/settings-recovery-lifetime';
import { buffers, channel as createChannel } from 'redux-saga';
import {
  actionChannel,
  call,
  cancelled,
  delay,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import { appClient, localMachineClient } from '$lib/client';
import type { ServerPairingInfo } from '$lib/client/app-client';
import { readSelfPairing } from '$features/devices/self-pairing';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import {
  beginWebsocketCredentialRequest,
  resetWebsocketCredentials,
  clearWebsocketCredentials,
  readWebsocketToken,
  readPersonalPairingUri,
  receiveWebsocketCredentials,
} from '$features/settings/websocket-api-credentials';
import {
  settingsFormClosed,
  settingsFormRequestStarted,
  settingsFormRequestProgressed,
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
import { selfPublicationRequested } from '../../connections/connections-slice';
import { websocketApiQrOpened, websocketApiRequested } from '../websocket-api-slice';
import { selectWebsocketApiSnapshot } from '../websocket-api-selectors';
import type { WebSocketApiSnapshot } from '../websocket-api-types';
import { takeEveryByContextFIFO, takeLatestInContext } from '../../../utils/context-saga-effects';
import {
  selectPrincipalActionContext,
  selectPrincipalSnapshot,
  selectCanAdministerHost,
} from '../../principal/principal-selectors';

type RequestAction = ReturnType<typeof websocketApiRequested>;

function* waitForClose(request: SettingsFormRequest): SagaGenerator<void> {
  while (true) {
    const {
      payload: [identity],
    } = yield* take(settingsFormClosed);
    if (identity.formId === request.formId && identity.sessionId === request.sessionId) return;
  }
}

function* publication(
  operation: Parameters<typeof selfPublicationRequested>[0],
  work: ReturnType<typeof captureSettingsWork>,
): SagaGenerator<void> {
  if (!work.isCurrent()) return;
  const action = selfPublicationRequested(operation);
  // Attach rejection handling before dispatch: publication failures are fail-soft.
  const completion = action.promise.catch(() => {});
  yield* put(action);
  yield* call(() => completion);
}

async function pairing(
  client: typeof localMachineClient,
  request: SettingsFormRequest,
  work: ReturnType<typeof captureSettingsWork>,
): Promise<Omit<ServerPairingInfo, 'token'>> {
  // Credential-bearing results never cross a saga effect/result diagnostic boundary.
  try {
    const { token, ...info } = await client.server.pairingInfo();
    if (work.isCurrent()) receiveWebsocketCredentials(request, { token, qrDataUrl: '' });
    return info;
  } catch {
    throw new Error(m.settings_wsApi_serverNotRunning());
  }
}

function* loadSnapshot(
  client: typeof localMachineClient,
  request: SettingsFormRequest,
  completeMutation: boolean,
  work: ReturnType<typeof captureSettingsWork>,
): SagaGenerator<WebSocketApiSnapshot> {
  const previous = yield* selectWebsocketApiSnapshot.effect(request);
  const settings = yield* call([client.settings, client.settings.list]);
  if (!(completeMutation ? work.isCurrent() : work.isSameScope())) return previous;
  const value = (path: string) => settings.find((entry) => entry.path === path)?.value;
  const bindAddress = value('server.bindAddress');
  const persistedPort = value('server.wsApi.port');
  const snapshot: WebSocketApiSnapshot = {
    ...previous,
    enabled: value('server.wsApi.enabled') === true,
    persistedPort: typeof persistedPort === 'number' ? persistedPort : previous.persistedPort,
    bindAddressSupported: settings.some((entry) => entry.path === 'server.bindAddress'),
    bindIps:
      typeof bindAddress === 'string' && bindAddress.length > 0
        ? [bindAddress]
        : Array.isArray(bindAddress)
          ? bindAddress.filter((ip): ip is string => typeof ip === 'string' && ip.length > 0)
          : [],
    tunnelSupported: settings.some((entry) => entry.path === 'server.tunnel.enabled'),
    tunnelEnabled: value('server.tunnel.enabled') === true,
    tunnelOnly: value('server.tunnel.enabled') === true && value('server.tunnel.only') === true,
  };
  // An accepted mutation owns its full domain completion even if its form closes.
  // Reducer and credential receiver still reject delivery to an obsolete identity.
  if (!completeMutation && !(yield* selectSettingsFormRequestCurrent.effect(request)))
    return snapshot;
  yield* put(settingsFormRequestProgressed(request, { ...snapshot }));
  if (snapshot.enabled) {
    const info = yield* call(pairing, client, request, work);
    if (!(completeMutation ? work.isCurrent() : work.isSameScope())) return snapshot;
    Object.assign(snapshot, {
      port: info.port,
      certFingerprint: info.certFingerprint,
      localIps: info.localIps,
      availableIps: info.availableIps ?? null,
      tcAddress: info.tcAddress ?? '',
    });
    if (completeMutation || (yield* selectSettingsFormRequestCurrent.effect(request)))
      yield* publication('load', work);
  } else receiveWebsocketCredentials(request, { token: '', qrDataUrl: '' });
  return snapshot;
}

function pairingUri(
  request: SettingsFormRequest,
  snapshot: WebSocketApiSnapshot,
  personal = false,
): string {
  if (personal) {
    const uri = readPersonalPairingUri(request);
    if (!uri) throw new Error(m.settings_personalDevices_pairing_error());
    return uri;
  }
  return `intent://pair?token=${encodeURIComponent(readWebsocketToken(request))}&host=${snapshot.localIps.map(encodeURIComponent).join(',')}&port=${snapshot.port}&path=/ws${snapshot.certFingerprint ? `&certFingerprint=${encodeURIComponent(snapshot.certFingerprint)}` : ''}${snapshot.tcAddress ? `&tc=${encodeURIComponent(snapshot.tcAddress)}` : ''}`;
}

function* requestCurrent(request: SettingsFormRequest, context?: string): SagaGenerator<boolean> {
  return (
    (yield* selectSettingsFormRequestCurrent.effect(request)) &&
    (!context || context === (yield* selectPrincipalActionContext.effect()))
  );
}

function* loadMobile(
  request: SettingsFormRequest,
  context: string,
  work: ReturnType<typeof captureSettingsWork>,
  loading = false,
): SagaGenerator<{ enabled: boolean }> {
  const principal = yield* selectPrincipalSnapshot.effect();
  if (!(yield* selectCanAdministerHost.effect()) || !principal)
    throw new Error(m.settings_personalDevices_pairing_error());
  const settings = yield* call([appClient.settings, appClient.settings.list]);
  if (
    !(loading ? work.isSameScope() : work.isCurrent()) ||
    !(yield* requestCurrent(request, context))
  )
    return { enabled: false };
  const enabled = settings.find((entry) => entry.path === 'server.wsApi.enabled')?.value;
  if (typeof enabled !== 'boolean') throw new Error(m.settings_personalDevices_pairing_error());
  yield* put(settingsFormRequestProgressed(request, { enabled }));
  if (enabled) {
    if (!principal.capabilities.personalPairing)
      throw new Error(m.settings_personalDevices_pairing_error());
    let uri = '';
    yield* call(async () => {
      try {
        uri = await readSelfPairing(principal.principal);
      } catch {
        throw new Error(m.settings_personalDevices_pairing_error());
      }
    });
    if (work.isCurrent() && (yield* requestCurrent(request, context)))
      receiveWebsocketCredentials(request, { pairingUri: uri });
  } else receiveWebsocketCredentials(request, { token: '', qrDataUrl: '', pairingUri: '' });
  return { enabled };
}

function* runRequest(action: RequestAction): SagaGenerator<void> {
  const [request, intent] = action.payload;
  const work = captureSettingsWork();
  const loading = intent.kind === 'load' || intent.kind === 'loadMobile';
  const current = loading ? work.isSameScope : work.isCurrent;
  const initialForm = yield* selectSettingsForm.effect(request);
  if (!current()) {
    yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
    return;
  }
  const context = 'context' in intent ? intent.context : undefined;
  const client = intent.connectionId === LOCAL_CONNECTION_ID ? appClient : localMachineClient;
  let snapshot = yield* selectWebsocketApiSnapshot.effect(request);
  let values: Record<string, SettingsFormValue> = {};
  let error: string | undefined;
  try {
    if (!work.isCurrent() || !(yield* requestCurrent(request, context))) return;
    if (intent.kind === 'loadMobile') {
      values = yield* loadMobile(request, intent.context, work, true);
    } else if (intent.kind === 'toggle' && context) {
      if (!(yield* selectCanAdministerHost.effect()))
        throw new Error(m.settings_personalDevices_pairing_error());
      const result = yield* call(
        [appClient.settings, appClient.settings.update],
        [{ path: 'server.wsApi.enabled', value: intent.enabled }],
      );
      if (!work.isCurrent() || !(yield* requestCurrent(request, context))) return;
      const enabled = result.find((entry) => entry.path === 'server.wsApi.enabled')?.value;
      if (typeof enabled !== 'boolean') throw new Error(m.settings_wsApi_startListenerError());
      if (enabled !== intent.enabled) error = m.settings_wsApi_startListenerError();
      values = { enabled };
      yield* put(settingsFormRequestProgressed(request, values));
      if (enabled) values = yield* loadMobile(request, context, work);
      else receiveWebsocketCredentials(request, { token: '', qrDataUrl: '', pairingUri: '' });
    } else if (intent.kind === 'load') {
      snapshot = yield* call(loadSnapshot, client, request, false, work);
      values = { ...snapshot, portResetId: request.requestId };
    } else if (intent.kind === 'toggle') {
      const result = yield* call(
        [client.settings, client.settings.update],
        [{ path: 'server.wsApi.enabled', value: intent.enabled }],
      );
      if (!work.isCurrent()) return;
      const applied = result.find((entry) => entry.path === 'server.wsApi.enabled');
      if (applied && applied.value !== intent.enabled) {
        values.enabled = applied.value === true;
        error = m.settings_wsApi_startListenerError();
      } else {
        snapshot.enabled = intent.enabled;
        if (intent.enabled) {
          snapshot = yield* call(loadSnapshot, client, request, true, work);
          if (!work.isCurrent()) return;
          if (
            snapshot.bindAddressSupported &&
            !snapshot.tunnelOnly &&
            !snapshot.bindIps.some((ip) => ip !== '127.0.0.1')
          ) {
            try {
              yield* call(
                [client.settings, client.settings.update],
                [{ path: 'server.bindAddress', value: ['0.0.0.0'] }],
              );
              yield* publication('refresh', work);
              snapshot = yield* call(loadSnapshot, client, request, true, work);
            } catch (cause) {
              if (work.isCurrent() && (yield* selectSettingsFormRequestCurrent.effect(request)))
                yield* call(
                  notify.error,
                  m.settings_listenTargets_saveError({
                    error: String(cause instanceof Error ? cause.message : cause),
                  }),
                );
            }
          }
          yield* publication('autoPublish', work);
          values.enabledAcknowledged = request.requestId;
        } else {
          receiveWebsocketCredentials(request, { token: '', qrDataUrl: '' });
          yield* publication('autoUnpublish', work);
        }
        values = { ...values, ...snapshot, portResetId: request.requestId };
      }
    } else if (intent.kind === 'port') {
      if (!Number.isInteger(intent.port) || intent.port < 1024 || intent.port > 65535) {
        yield* put(
          settingsFormRequestSettled(request, {
            status: 'failed',
            error: m.settings_wsApi_port_invalid(),
          }),
        );
        return;
      }
      const result = yield* call(
        [client.settings, client.settings.update],
        [{ path: 'server.wsApi.port', value: intent.port }],
      );
      if (!work.isCurrent()) return;
      const applied = result.find((entry) => entry.path === 'server.wsApi.port');
      if (applied && applied.value !== intent.port) {
        values.persistedPort =
          typeof applied.value === 'number' ? applied.value : snapshot.persistedPort;
        error = m.settings_wsApi_portRollbackError();
      } else {
        values.persistedPort = intent.port;
        if (snapshot.enabled) {
          try {
            values.port = (yield* call(pairing, client, request, work)).port;
          } catch {
            /* Saved successfully; pairing refresh is fail-soft. */
          }
          yield* publication('refresh', work);
          if (!work.isCurrent() || !(yield* selectSettingsFormRequestCurrent.effect(request)))
            return;
          yield* call(notify.success, m.settings_wsApi_portChanged({ port: String(intent.port) }));
        } else if (work.isCurrent() && (yield* selectSettingsFormRequestCurrent.effect(request)))
          yield* call(notify.success, m.settings_wsApi_portSaved());
      }
      values.portResetId = request.requestId;
    } else if (intent.kind === 'listen' || intent.kind === 'tunnel') {
      const ips =
        intent.kind === 'listen'
          ? intent.ips
          : snapshot.bindIps.some((ip) => ['0.0.0.0', '::', '127.0.0.1'].includes(ip))
            ? snapshot.bindIps
            : [...snapshot.bindIps, '127.0.0.1'];
      const tunnel = intent.kind === 'listen' ? intent.tunnel : !snapshot.tunnelEnabled;
      const changes: { path: string; value: string[] | boolean }[] = [
        { path: 'server.bindAddress', value: ips },
      ];
      if (snapshot.tunnelSupported)
        changes.push(
          { path: 'server.tunnel.enabled', value: tunnel },
          { path: 'server.tunnel.only', value: false },
        );
      try {
        yield* call([client.settings, client.settings.update], changes);
        if (work.isCurrent() && (yield* selectSettingsFormRequestCurrent.effect(request)))
          yield* call(notify.success, m.settings_listenTargets_saved());
        yield* publication('refresh', work);
      } catch (cause) {
        error = m.settings_listenTargets_saveError({
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
      if (!work.isCurrent() || !(yield* selectSettingsFormRequestCurrent.effect(request))) return;
      values = { ...(yield* call(loadSnapshot, client, request, false, work)) };
    } else if (intent.kind === 'rotate') {
      // Neither the resolved token nor an error echoing it may enter saga diagnostics.
      const fixed = yield* call(async () => {
        try {
          const result = await client.server.rotateToken();
          if (!work.isCurrent()) return false;
          receiveWebsocketCredentials(request, { token: result.token, qrDataUrl: '' });
          return false;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (message.includes('INTENTD_AUTH_TOKEN') || message.includes('token is fixed'))
            return true;
          throw new Error(
            m.settings_wsApi_tokenRegenerateError({ error: m.settings_wsApi_serverNotRunning() }),
          );
        }
      });
      if (fixed) error = m.settings_wsApi_tokenRotateFixedError();
      else {
        yield* publication('refresh', work);
        if (!work.isCurrent() || !(yield* selectSettingsFormRequestCurrent.effect(request))) return;
        yield* call(notify.success, m.settings_wsApi_tokenRegenerated());
      }
    } else if (intent.kind === 'publish') yield* publication('publish', work);
    else if (intent.kind === 'copy') {
      if (intent.target === 'share' && !snapshot.port && !context)
        throw new Error(m.settings_wsApi_serverNotRunning());
      yield* call(async () => {
        const text =
          intent.target === 'token'
            ? readWebsocketToken(request)
            : intent.target === 'fingerprint'
              ? snapshot.certFingerprint
              : intent.target === 'tc'
                ? snapshot.tcAddress
                : pairingUri(request, snapshot, !!context);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          throw new Error(m.settings_wsApi_tokenCopyError());
        }
      });
      if (!work.isCurrent() || !(yield* requestCurrent(request, context))) return;
      yield* call(
        notify.success,
        intent.target === 'token'
          ? m.settings_wsApi_tokenCopied()
          : intent.target === 'fingerprint'
            ? m.settings_wsApi_fingerprintCopied_label()
            : intent.target === 'tc'
              ? m.settings_tunnel_tcAddress_copied()
              : m.settings_wsApi_shareLink_copied(),
      );
    } else if (intent.kind === 'qr') {
      if (!snapshot.port && !context) throw new Error(m.settings_wsApi_serverNotRunning());
      let qrDataUrl = '';
      yield* call(async () => {
        try {
          const QRCode = (await import('qrcode')).default;
          qrDataUrl = await QRCode.toDataURL(pairingUri(request, snapshot, !!context), {
            width: 544,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch {
          throw new Error(m.settings_wsApi_qrGenerateError());
        }
      });
      if (work.isCurrent() && (yield* requestCurrent(request, context))) {
        receiveWebsocketCredentials(request, { qrDataUrl });
        yield* put(websocketApiQrOpened(request));
      }
    }
    if (current() && (yield* requestCurrent(request, context))) {
      if (loading) {
        const form = yield* selectSettingsForm.effect(request);
        for (const key of [
          'enabled',
          'persistedPort',
          'bindAddressSupported',
          'bindIps',
          'tunnelSupported',
          'tunnelEnabled',
          'tunnelOnly',
        ]) {
          const value = form?.values[key];
          if (value !== undefined && value !== initialForm?.values[key]) values[key] = value;
        }
      }
      if (error) yield* call(notify.error, error);
      yield* put(
        settingsFormRequestSettled(request, {
          status: error ? 'failed' : 'succeeded',
          error,
          values,
        }),
      );
    }
  } catch (cause) {
    if (current() && (yield* requestCurrent(request, context))) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error =
        intent.kind === 'loadMobile'
          ? m.settings_personalDevices_pairing_error()
          : intent.kind === 'load'
            ? m.settings_wsApi_loadStatusError({ error: message })
            : intent.kind === 'toggle'
              ? m.settings_wsApi_toggleError({ error: message })
              : intent.kind === 'port'
                ? m.settings_wsApi_portChangeError({ error: message })
                : intent.kind === 'qr'
                  ? m.settings_wsApi_qrGenerateError()
                  : intent.kind === 'copy'
                    ? intent.target === 'token'
                      ? m.settings_wsApi_tokenCopyError()
                      : intent.target === 'tc'
                        ? m.settings_tunnel_tcAddress_copyError()
                        : intent.target === 'share'
                          ? m.settings_wsApi_shareLink_copyError()
                          : m.ui_imageActionsMenu_copyFailed_error()
                    : message;
      yield* call(notify.error, error);
      yield* put(
        settingsFormRequestSettled(request, {
          status: 'failed',
          error,
          values: intent.kind === 'port' ? { portResetId: request.requestId } : undefined,
        }),
      );
    }
  } finally {
    if ((yield* cancelled()) || !current())
      yield* put(settingsFormRequestSettled(request, { status: 'cancelled' }));
  }
}

export function* websocketApiSaga(): SagaGenerator<void> {
  const channel = yield* actionChannel<
    RequestAction | ReturnType<typeof websocketApiQrOpened> | ReturnType<typeof settingsFormClosed>
  >([websocketApiRequested, websocketApiQrOpened, settingsFormClosed], buffers.expanding());
  const writes = createChannel<RequestAction>(buffers.expanding());
  const reads = createChannel<RequestAction>(buffers.expanding());
  const timers = createChannel<{ request: SettingsFormRequest; open: boolean }>(
    buffers.expanding(),
  );
  try {
    yield* takeEveryByContextFIFO(
      writes,
      ({ payload: [, intent] }) => ('context' in intent && intent.context) || 'local-api',
      runRequest,
      {
        onDiscardPending: function* (action) {
          yield* put(settingsFormRequestSettled(action.payload[0], { status: 'cancelled' }));
        },
      },
    );
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
      timers,
      ({ request }) => `${request.formId}:${request.sessionId}`,
      function* ({ request, open }) {
        if (!open) return;
        const result = yield* race({
          expired: delay(30000),
          closed: call(waitForClose, request),
        });
        if (result.expired) receiveWebsocketCredentials(request, { qrDataUrl: '' });
      },
    );
    while (true) {
      const action = yield* take(channel);
      if (action.type === settingsFormClosed.type) {
        const [identity] = action.payload as ReturnType<typeof settingsFormClosed>['payload'];
        clearWebsocketCredentials(identity.formId, identity.sessionId);
        continue;
      }
      if (action.type === websocketApiQrOpened.type) {
        const [request] = action.payload as ReturnType<typeof websocketApiQrOpened>['payload'];
        yield* put(timers, { request, open: true });
        continue;
      }
      const requestAction = action as RequestAction;
      const [request, intent] = requestAction.payload;
      if (!(yield* selectSettingsForm.effect(request))) continue;
      yield* put(settingsFormRequestStarted(request));
      beginWebsocketCredentialRequest(request);
      if (intent.kind === 'closeQr') {
        receiveWebsocketCredentials(request, { qrDataUrl: '' });
        yield* put(timers, { request, open: false });
        yield* put(settingsFormRequestSettled(request, { status: 'succeeded' }));
      } else if (
        intent.kind === 'load' ||
        intent.kind === 'loadMobile' ||
        intent.kind === 'copy' ||
        intent.kind === 'qr'
      ) {
        yield* put(reads, requestAction);
      } else yield* put(writes, requestAction);
    }
  } finally {
    channel.close();
    writes.close();
    reads.close();
    timers.close();
    resetWebsocketCredentials();
  }
}
