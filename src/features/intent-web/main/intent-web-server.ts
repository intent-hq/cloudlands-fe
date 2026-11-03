import {
  isConnectionAccent,
  isDeviceIconChoice,
  isDetectedDeviceKind,
  type TestConnectionResult,
} from '../../../shared/types/connections';
import { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { getConnectionTunnel, setConnectionTunnel } from '../../backend/main/connection-tunnel';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { createConnectionsStore, plaintextTokenCodec } from '../../backend/main/connections-store';
import { buildConfigForRecord } from '../../backend/main/connection-config';
import {
  captureFingerprint,
  createBackendSocket,
  normalizeFingerprint,
  PinMismatchError,
  AuthRejectedError,
} from '../../backend/main/backend-connection';
import {
  CONNECTION_ID_PATTERN,
  isSameOriginUpgrade,
} from '../../browser-access/main/browser-access-auth';
import { createBrowserAccessServer } from '../../browser-access/main/browser-access-server';

const PREFIX = '/__intent-web/connections';
interface WebServerOptions {
  dataDir: string;
  webRoot: string;
  getAccessKey: () => string;
  localSocket: string | null;
  tailcatAvailable: boolean;
  tailcatBinary?: string | null;
  capture?: typeof captureFingerprint;
  rpc?: (id: string, method: string, params?: unknown) => Promise<unknown>;
}
class ApiError extends Error {
  constructor(readonly status: number) {
    super('Invalid request');
  }
}
async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!isSameOriginUpgrade(request.headers)) throw new ApiError(403);
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new ApiError(415);
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 65536) throw new ApiError(413);
  }
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400);
  }
}
function text(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw new ApiError(400);
  return value;
}
function port(body: Record<string, unknown>): number {
  const value = body.port;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535)
    throw new ApiError(400);
  return value;
}
function metadata(body: Record<string, unknown>) {
  if (body.accent !== undefined && !isConnectionAccent(body.accent)) throw new ApiError(400);
  if (body.deviceIcon !== undefined && !isDeviceIconChoice(body.deviceIcon))
    throw new ApiError(400);
  if (
    body.detectedDeviceKind !== undefined &&
    body.detectedDeviceKind !== null &&
    !isDetectedDeviceKind(body.detectedDeviceKind)
  )
    throw new ApiError(400);
  if (body.detectHosts !== undefined && typeof body.detectHosts !== 'boolean')
    throw new ApiError(400);
  return {
    ...(isConnectionAccent(body.accent) ? { accent: body.accent } : {}),
    ...(isDeviceIconChoice(body.deviceIcon) ? { deviceIcon: body.deviceIcon } : {}),
    ...(isDetectedDeviceKind(body.detectedDeviceKind) || body.detectedDeviceKind === null
      ? { detectedDeviceKind: body.detectedDeviceKind }
      : {}),
    ...(typeof body.detectHosts === 'boolean' ? { detectHosts: body.detectHosts } : {}),
  };
}
export async function createIntentWebServer(options: WebServerOptions) {
  const store = createConnectionsStore({
    dataDir: options.dataDir,
    tokenCodec: plaintextTokenCodec,
    fileName: 'connections.json',
  });
  const capture: typeof captureFingerprint =
    options.capture ??
    ((target) => captureFingerprint(target, { tailcatBinary: options.tailcatBinary ?? null }));
  const subscribers = new Set<http.ServerResponse>();
  const publish = (event: string, data: unknown) => {
    for (const response of subscribers) {
      if (!response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) response.destroy();
    }
  };
  const records = async () =>
    (await store.list()).filter((r) => r.id !== 'local' || options.localSocket);
  const defaultBackend = async () => {
    const list = await records();
    const active = await store.getActiveId();
    return options.localSocket
      ? 'local'
      : (list.find((r) => r.id === active)?.id ?? list[0]?.id ?? null);
  };
  const listConnections = async (requested: string | null) => {
    const connections = await records();
    const id = connections.some((r) => r.id === requested) ? requested : await defaultBackend();
    return { connections, activeId: id, windowBackendId: id };
  };
  const config = async (id: string) => {
    const record = (await records()).find((r) => r.id === id);
    if (!record || !record.host || !record.port || !record.fingerprint) throw new ApiError(404);
    const built = (
      await buildConfigForRecord({
        ...record,
        host: record.host,
        hosts: record.hosts ?? [record.host],
        port: record.port,
        fingerprint: record.fingerprint,
        tcAddress: record.tcAddress ?? null,
        getToken: () => store.getDecryptedToken(id),
      })
    ).config;
    return { ...built, tailcatBinary: options.tailcatBinary ?? null };
  };
  const validate = async (
    id: string,
    host: string,
    targetPort: number,
    token: string,
    confirmed?: string,
  ): Promise<TestConnectionResult> => {
    const record = (await records()).find((r) => r.id === id);
    if (!record) throw new ApiError(404);
    const expected = normalizeFingerprint(record.fingerprint ?? '');
    const probe = await capture({ host, port: targetPort });
    if (!probe.ok)
      return {
        status: 'failed',
        reason: probe.code === 'fingerprint-mismatch' ? 'connect-failed' : probe.code,
      };
    const actual = normalizeFingerprint(probe.fingerprint);
    if (actual !== expected && normalizeFingerprint(confirmed ?? '') !== actual)
      return {
        status: 'fingerprint-confirmation-required',
        expectedFingerprint: expected,
        actualFingerprint: actual,
      };
    const result = await capture({ host, port: targetPort, token, expectedFingerprint: actual });
    if (!result.ok)
      return result.code === 'fingerprint-mismatch'
        ? {
            status: 'fingerprint-confirmation-required',
            expectedFingerprint: expected,
            actualFingerprint: result.actualFingerprint,
          }
        : { status: 'failed', reason: result.code };
    if (!result.tokenValid)
      return { status: 'authentication-rejected', statusCode: result.statusCode ?? 401 };
    if (!result.connected) return { status: 'failed', reason: 'connect-failed' };
    return { status: 'success', fingerprint: actual };
  };
  const openUpstream = async (id: string): Promise<Duplex> => {
    if (id === 'local') {
      if (!options.localSocket) throw new ApiError(404);
      return createBackendSocket({ transport: 'uds', socketPath: options.localSocket });
    }
    const remoteConfig = await config(id);
    await store.setActiveId(id);
    const upstream = createBackendSocket(remoteConfig);
    upstream.on('error', (error: Error) => {
      if (error instanceof PinMismatchError)
        publish('connections:cert-mismatch', {
          id,
          host: remoteConfig.host,
          port: remoteConfig.port,
          expectedFingerprint: error.expected,
          actualFingerprint: error.actual,
        });
      else if (error instanceof AuthRejectedError)
        publish('connections:auth-rejected', {
          id,
          host: remoteConfig.host,
          port: remoteConfig.port,
          statusCode: error.statusCode,
        });
    });
    return upstream;
  };
  const send = (res: http.ServerResponse, value: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  };
  const server = createBrowserAccessServer({
    webRoot: options.webRoot,
    getAccessKey: options.getAccessKey,
    listConnections,
    openUpstream,
    loginText: () => ({
      lang: 'en',
      title: 'Sign in to Intent',
      prompt: 'Enter the access key',
      keyLabel: 'Access key',
      submit: 'Sign in',
      invalidKey: 'That access key is not correct.',
      tooManyAttempts: 'Too many attempts.',
    }),
    runtimeConfig: async () => `(() => {
const ids=${JSON.stringify((await records()).map((r) => r.id))};
let backend=new URLSearchParams(location.search).get('backend');
try { if(ids.includes(backend)) sessionStorage.setItem('intent.browserAccess.backend',backend); else backend=sessionStorage.getItem('intent.browserAccess.backend'); } catch {}
if(!ids.includes(backend)) backend=${JSON.stringify(await defaultBackend())};
globalThis.__INTENT_RUNTIME_CONFIG__=Object.freeze({backendId:backend,intentdWsUrl:backend?'/intentd/ws/'+encodeURIComponent(backend):null,connectionsUrl:${JSON.stringify(PREFIX)},hostCapabilities:['connections.manage'],tailcatAvailable:${options.tailcatAvailable},localAvailable:${!!options.localSocket}});
})();`,
    handleAuthenticatedRequest: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/__intent-web/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        subscribers.add(res);
        res.once('close', () => subscribers.delete(res));
        return true;
      }
      if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return false;
      try {
        const parts = url.pathname
          .slice(PREFIX.length)
          .split('/')
          .filter(Boolean)
          .map(decodeURIComponent);
        const [id, action] = parts;
        if (parts.length > 2 || (id && !CONNECTION_ID_PATTERN.test(id))) throw new ApiError(400);
        if (req.method === 'GET' && !id) {
          send(res, await listConnections(url.searchParams.get('backend')));
          return true;
        }
        if (id && action === 'tunnel' && (req.method === 'GET' || req.method === 'PUT')) {
          const remoteConfig = await config(id);
          const body = req.method === 'PUT' ? await readJson(req) : null;
          if (body && typeof body.enabled !== 'boolean') throw new ApiError(400);
          const client = options.rpc
            ? null
            : new JsonRpcClient({
                config: remoteConfig,
                heartbeatIntervalMs: 0,
                requestTimeoutMs: 10000,
              });
          const request = (method: string, params?: unknown) =>
            options.rpc
              ? options.rpc(id, method, params)
              : client
                ? client.request(method, params)
                : Promise.reject(new ApiError(500));
          try {
            client?.start();
            send(
              res,
              body
                ? await setConnectionTunnel(request, body.enabled as boolean)
                : await getConnectionTunnel(request),
            );
          } finally {
            client?.dispose();
          }
          return true;
        }
        const body = await readJson(req);
        if (req.method === 'POST' && id === 'capture-fingerprint' && !action) {
          send(
            res,
            await capture({
              host: text(body, 'host'),
              port: port(body),
              ...(body.token ? { token: text(body, 'token') } : {}),
            }),
          );
          return true;
        }
        if (req.method === 'POST' && !id) {
          const connection = await store.add({
            ...metadata(body),
            label: text(body, 'label'),
            host: text(body, 'host'),
            port: port(body),
            fingerprint: text(body, 'fingerprint'),
            token: text(body, 'token'),
            ...(body.tcAddress ? { tcAddress: text(body, 'tcAddress') } : {}),
          });
          server.disconnectBackend?.(connection.id);
          send(res, { connection, switched: false });
          return true;
        }
        if (!id || id === 'local' || !(await records()).some((r) => r.id === id))
          throw new ApiError(404);
        if (req.method === 'DELETE' && !action) {
          await store.forget(id);
          server.disconnectBackend?.(id);
          send(res, { ok: true });
          return true;
        }
        const record = (await records()).find((r) => r.id === id);
        if (!record) throw new ApiError(404);
        if (
          (req.method === 'POST' && (action === 'test' || action === 'rotate-secret')) ||
          (req.method === 'PATCH' && !action)
        ) {
          const host = body.host === undefined ? record.host : text(body, 'host');
          const targetPort = body.port === undefined ? record.port : port(body);
          if (!host || !targetPort || (body.host === undefined) !== (body.port === undefined))
            throw new ApiError(400);
          const token =
            body.token === undefined ? await store.getDecryptedToken(id) : text(body, 'token');
          if (!token) {
            send(res, { status: 'secret-unavailable' });
            return true;
          }
          let fingerprint = record.fingerprint;
          if (!fingerprint) throw new ApiError(400);
          if (action || body.host !== undefined || body.confirmedFingerprint !== undefined) {
            const result = await validate(
              id,
              host,
              targetPort,
              token,
              body.confirmedFingerprint === undefined
                ? undefined
                : text(body, 'confirmedFingerprint'),
            );
            if (result.status !== 'success' || action === 'test') {
              send(res, result);
              return true;
            }
            fingerprint = result.fingerprint;
          }
          const connection =
            action === 'rotate-secret'
              ? await store.replaceSecret(id, text(body, 'token'), fingerprint)
              : await store.updateMetadata(id, {
                  ...metadata(body),
                  label: text(body, 'label'),
                  accent: isConnectionAccent(body.accent) ? body.accent : (record.accent ?? null),
                  host,
                  port: targetPort,
                  fingerprint,
                });
          server.disconnectBackend?.(id);
          send(res, { status: 'updated', connection });
          return true;
        }
        throw new ApiError(405);
      } catch (error) {
        send(
          res,
          { error: 'Request could not be completed' },
          error instanceof ApiError ? error.status : 400,
        );
      }
      return true;
    },
  });
  const unsubscribe = store.onConnectionsMutated(() => {
    void listConnections(null)
      .then((value) => publish('connections:changed', value))
      .catch(() => {});
  });
  return {
    ...server,
    disconnectAll: () => {
      server.disconnectAll();
      for (const res of subscribers) res.destroy();
    },
    close: async () => {
      unsubscribe();
      for (const res of subscribers) res.destroy();
      await server.close();
    },
  };
}
