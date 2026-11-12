/**
 * @vitest-environment node
 *
 * Redeeming a local pairing code (protocol §5.58, requester side): the code is
 * checked before anything is sent, the grant is checked against the
 * discovery record and the pinned certificate before it is saved, and every
 * contract error (plus unknown ones) maps to an error the form can explain.
 */
import crypto from 'node:crypto';
import https from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord } from '$shared/types/connections';
import type { NewConnection } from '../../backend/main/connections-store';
import type { LocalDaemonRecord } from './local-daemon-discovery';
import {
  createLocalPairRedeemer,
  exchangeOverLocalPair,
  mapRedeemRpcError,
  type LocalPairExchange,
  type LocalPairRequest,
} from './local-pair-redeem';

const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':');
const TOKEN = 'ab'.repeat(32);

const RECORD: LocalDaemonRecord = {
  instanceId: 'b-instance',
  pid: 4242,
  displayName: 'Intent (dev build)',
  dataDir: '/tmp/intentd-b',
  daemonVersion: '0.400.0',
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  port: 51234,
  fingerprint: FP,
};

const GRANT = {
  version: 1,
  host: '127.0.0.1',
  port: 51234,
  fingerprint: FP.toLowerCase(),
  credentialId: 'cred-1',
  token: TOKEN,
  displayName: 'Intent Beta',
  prettyHostname: 'My Mac',
};

const SAVED = { id: 'conn-1', label: 'Intent Beta' } as ConnectionRecord;

function setup(
  exchanges: LocalPairExchange[],
  options: {
    record?: LocalDaemonRecord | null;
    add?: (c: NewConnection) => Promise<ConnectionRecord>;
  } = {},
) {
  const requests: LocalPairRequest[] = [];
  const add = vi.fn(options.add ?? (async () => SAVED));
  const redeem = createLocalPairRedeemer({
    findRecord: async () => (options.record === undefined ? RECORD : options.record),
    exchange: async (request) => {
      requests.push(request);
      return exchanges.shift() ?? { kind: 'connect-failed' };
    },
    add,
    appName: 'Intent Alpha',
  });
  return { redeem, requests, add };
}

const answer = (message: unknown, presentedFingerprint = FP): LocalPairExchange => ({
  kind: 'response',
  message,
  presentedFingerprint,
});
const rpcError = (code: number, data?: unknown) =>
  answer({ jsonrpc: '2.0', id: 1, error: { code, message: 'x', data } });

describe('createLocalPairRedeemer', () => {
  it('redeems the code in display form and saves the machine with the pinned fingerprint', async () => {
    const { redeem, requests, add } = setup([answer({ jsonrpc: '2.0', id: 1, result: GRANT })]);
    await expect(redeem('b-instance', 'ktp 82m')).resolves.toEqual({ ok: true, connection: SAVED });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ host: '127.0.0.1', port: 51234, fingerprint: FP });
    expect(JSON.parse(requests[0]!.body)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'pairing.redeemLocalCode',
      params: { code: 'KTP-82M', appName: 'Intent Alpha' },
    });
    expect(add).toHaveBeenCalledWith({
      label: 'Intent Beta',
      host: '127.0.0.1',
      port: 51234,
      fingerprint: FP,
      token: TOKEN,
      detectHosts: false,
      syncExcluded: true,
      daemonMode: 'regular',
      localPairing: true,
    });
  });

  it('checks the code before contacting anything', async () => {
    const { redeem, requests } = setup([]);
    for (const code of ['KTP82', 'KTP-82MM', 'KTP-820', 'ILO-123']) {
      await expect(redeem('b-instance', code)).resolves.toEqual({
        ok: false,
        error: { code: 'code-format' },
      });
    }
    expect(requests).toHaveLength(0);
  });

  it('reports an Intent that went away or has no listener', async () => {
    await expect(setup([], { record: null }).redeem('b-instance', 'KTP82M')).resolves.toEqual({
      ok: false,
      error: { code: 'gone' },
    });
    const down = setup([], { record: { ...RECORD, port: null } });
    await expect(down.redeem('b-instance', 'KTP82M')).resolves.toEqual({
      ok: false,
      error: { code: 'not-listening' },
    });
    expect(down.requests).toHaveLength(0);
  });

  it.each([
    ['a different fingerprint', { fingerprint: 'AA'.repeat(32) }],
    ['a different port', { port: 1 }],
    ['a non-loopback host', { host: '192.168.1.5' }],
    ['a malformed token', { token: 'short' }],
    ['another version', { version: 2 }],
  ])('drops a grant with %s and saves nothing', async (_label, change) => {
    const { redeem, add } = setup([
      answer({ jsonrpc: '2.0', id: 1, result: { ...GRANT, ...change } }),
    ]);
    await expect(redeem('b-instance', 'KTP82M')).resolves.toEqual({
      ok: false,
      error: { code: 'certificate' },
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('drops a grant when the presented certificate differs from the record', async () => {
    const { redeem, add } = setup([answer({ jsonrpc: '2.0', id: 1, result: GRANT }, 'AB:CD')]);
    expect((await redeem('b-instance', 'KTP82M')).ok).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it.each<[LocalPairExchange, string]>([
    [{ kind: 'pin-mismatch' }, 'certificate'],
    [{ kind: 'http', status: 403 }, 'refused'],
    [{ kind: 'http', status: 404 }, 'unsupported'],
    [{ kind: 'http', status: 503 }, 'busy'],
    [{ kind: 'http', status: 500 }, 'unreachable'],
    [{ kind: 'timeout' }, 'unreachable'],
    [{ kind: 'dropped' }, 'unreachable'],
  ])('maps the exchange outcome %j to %s without a second try', async (outcome, code) => {
    const { redeem, requests } = setup([outcome]);
    await expect(redeem('b-instance', 'KTP82M')).resolves.toEqual({ ok: false, error: { code } });
    expect(requests).toHaveLength(1);
  });

  it('tries ::1 only when nothing listens on 127.0.0.1', async () => {
    const { redeem, requests } = setup([
      { kind: 'connect-failed' },
      answer({ jsonrpc: '2.0', id: 1, result: { ...GRANT, host: '::1' } }),
    ]);
    expect((await redeem('b-instance', 'KTP82M')).ok).toBe(true);
    expect(requests.map((r) => r.host)).toEqual(['127.0.0.1', '::1']);
    const none = setup([]);
    await expect(none.redeem('b-instance', 'KTP82M')).resolves.toEqual({
      ok: false,
      error: { code: 'unreachable' },
    });
    expect(none.requests).toHaveLength(2);
  });

  it('maps the contract errors from the daemon', async () => {
    const cases: [LocalPairExchange, unknown][] = [
      [
        rpcError(-32602, { code: 'local-code-invalid', attemptsRemaining: 3 }),
        { code: 'wrong-code', attemptsRemaining: 3 },
      ],
      [rpcError(-32602, { code: 'local-code-locked' }), { code: 'locked' }],
      [rpcError(-32602, { code: 'local-code-expired' }), { code: 'expired' }],
      [rpcError(-32602, { code: 'invalid-params' }), { code: 'code-format' }],
      [rpcError(-32001, { code: 'not-loopback' }), { code: 'refused' }],
      [rpcError(-32001), { code: 'unsupported' }],
      [rpcError(-32001, { code: 'tunnel-enabled' }), { code: 'remote-access-on' }],
      [rpcError(-32603, { code: 'something-new' }), { code: 'unknown' }],
    ];
    for (const [outcome, error] of cases) {
      const { redeem, add } = setup([outcome]);
      await expect(redeem('b-instance', 'KTP82M')).resolves.toEqual({ ok: false, error });
      expect(add).not.toHaveBeenCalled();
    }
  });

  it('reports a machine it could not save', async () => {
    const { redeem } = setup([answer({ jsonrpc: '2.0', id: 1, result: GRANT })], {
      add: async () => {
        throw new Error('disk full');
      },
    });
    await expect(redeem('b-instance', 'KTP82M')).resolves.toEqual({
      ok: false,
      error: { code: 'save-failed' },
    });
  });
});

describe('mapRedeemRpcError', () => {
  it.each([
    [{ code: -32601 }, { code: 'unsupported' }],
    [
      { code: -32602, data: { code: 'local-code-invalid', attemptsRemaining: 0 } },
      { code: 'wrong-code' },
    ],
    [{ code: -32003, data: { code: 'remote-access-on' } }, { code: 'remote-access-on' }],
    [{ code: -32603, data: { code: 'tunnel-active' } }, { code: 'remote-access-on' }],
    [{ code: -32000, data: { code: 'brand-new-refusal' } }, { code: 'unknown' }],
    ['garbage', { code: 'unknown' }],
  ])('maps %j', (error, expected) => {
    expect(mapRedeemRpcError(error)).toEqual(expected);
  });
});

// Self-signed EC (P-256) cert + key shared with backend-connection.test.ts.
const CERT_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJtVENDQVQrZ0F3SUJBZ0lVWVlzc05zWkxXdTZXZXdkb2p6UlpFY3k0LzRzd0NnWUlLb1pJemowRUF3SXcKRkRFU01CQUdBMVVFQXd3SmJHOWpZV3hvYjNOME1CNFhEVEkyTURnd056QXhOVGt6TkZvWERUTTJNRGd3TkRBeApOVGt6TkZvd0ZERVNNQkFHQTFVRUF3d0piRzlqWVd4b2IzTjBNRmt3RXdZSEtvWkl6ajBDQVFZSUtvWkl6ajBECkFRY0RRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUDZBREkKeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Y2TnZNRzB3SFFZRFZSME9CQllFRk80WTZBc2c2NEJVV1RhQgo2SzBUeDgvczR2S21NQjhHQTFVZEl3UVlNQmFBRk80WTZBc2c2NEJVV1RhQjZLMFR4OC9zNHZLbU1BOEdBMVVkCkV3RUIvd1FGTUFNQkFmOHdHZ1lEVlIwUkJCTXdFWUlKYkc5allXeG9iM04waHdSL0FBQUJNQW9HQ0NxR1NNNDkKQkFNQ0EwZ0FNRVVDSVFET3hKTXBKcy9DcmQwOG95U2tGdVRueVo0c3VqVklvL3BDK1RVWUpRMEY5UUlnU2pvagppWG56RlZ0Q1U0Wll2VWFtRkc0bFNUYmlQano5QXlubWxpSkI1a289Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K',
  'base64',
).toString('utf8');
const KEY_PEM = Buffer.from(
  'LS0tLS1CRUdJTiBFQyBQQVJBTUVURVJTLS0tLS0KQmdncWhrak9QUU1CQnc9PQotLS0tLUVORCBFQyBQQVJBTUVURVJTLS0tLS0KLS0tLS1CRUdJTiBFQyBQUklWQVRFIEtFWS0tLS0tCk1IY0NBUUVFSVBLTnFYZll2aEdqbDErMmNpMmEyOFZDNC9BbTVWLzBOV1JvS0cxeWlLbWFvQW9HQ0NxR1NNNDkKQXdFSG9VUURRZ0FFSlkvM2I0RHdRQXAyVVdIay84SGljZEFxaVdXL0pBVnRtMkRFbmUrZ3RBa0daVmo1VGlYUAo2QURJeXltbEc0bWRWU25QVUtXS2NUYmFxT3NWZVVGd2Z3PT0KLS0tLS1FTkQgRUMgUFJJVkFURSBLRVktLS0tLQo=',
  'base64',
).toString('utf8');

const nodeRequire = createRequire(import.meta.url);
const { WebSocketServer } = nodeRequire('ws') as typeof import('ws');

describe('exchangeOverLocalPair', () => {
  let server: https.Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function fakeHost(options: { refuse?: number } = {}) {
    const seen: { url?: string; origin?: string; authorization?: string; bodies: string[] } = {
      bodies: [],
    };
    server = https.createServer({ cert: CERT_PEM, key: KEY_PEM });
    const wss = new WebSocketServer({
      server,
      verifyClient: (info, done) => {
        seen.url = info.req.url;
        seen.origin = info.req.headers.origin;
        seen.authorization = info.req.headers.authorization;
        if (options.refuse) done(false, options.refuse);
        else done(true);
      },
    });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const text = String(data);
        seen.bodies.push(text);
        const request = JSON.parse(text) as { id: number };
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: GRANT }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const fingerprint = new crypto.X509Certificate(CERT_PEM).fingerprint256;
    return { port, fingerprint, seen };
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'pairing.redeemLocalCode',
    params: {},
  });

  it('sends one request on /local-pair with no Origin or Authorization to the pinned listener', async () => {
    const { port, fingerprint, seen } = await fakeHost();
    const outcome = await exchangeOverLocalPair({ host: '127.0.0.1', port, fingerprint, body });
    expect(outcome).toEqual({
      kind: 'response',
      message: { jsonrpc: '2.0', id: 1, result: GRANT },
      presentedFingerprint: fingerprint,
    });
    expect(seen.url).toBe('/local-pair');
    expect(seen.origin).toBeUndefined();
    expect(seen.authorization).toBeUndefined();
    expect(seen.bodies).toEqual([body]);
  });

  it('never sends the code to a listener with another certificate', async () => {
    const { port, seen } = await fakeHost();
    const outcome = await exchangeOverLocalPair({ host: '127.0.0.1', port, fingerprint: FP, body });
    expect(outcome).toEqual({ kind: 'pin-mismatch' });
    expect(seen.url).toBeUndefined();
    expect(seen.bodies).toEqual([]);
  });

  it('reports a refused upgrade by status', async () => {
    const { port, fingerprint } = await fakeHost({ refuse: 403 });
    await expect(
      exchangeOverLocalPair({ host: '127.0.0.1', port, fingerprint, body }),
    ).resolves.toEqual({ kind: 'http', status: 403 });
  });

  it('reports nothing listening as connect-failed', async () => {
    const { port, fingerprint } = await fakeHost();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    await expect(
      exchangeOverLocalPair({ host: '127.0.0.1', port, fingerprint, body }),
    ).resolves.toEqual({ kind: 'connect-failed' });
  });
});
