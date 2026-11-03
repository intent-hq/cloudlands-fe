// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, deriveSessionToken } from '../../browser-access/main/browser-access-auth';
import { createIntentWebServer } from './intent-web-server';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
async function start(localSocket: string | null = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-web-api-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = 'test-key';
  const probe = vi.fn(async () => ({
    ok: true as const,
    fingerprint: 'AA:BB',
    tokenValid: true,
    connected: true,
  }));
  const server = await createIntentWebServer({
    dataDir: dir,
    webRoot: dir,
    getAccessKey: () => key,
    localSocket,
    tailcatAvailable: false,
    capture: probe,
  });
  const port = await server.listen(0);
  cleanups.push(() => server.close());
  const origin = `http://127.0.0.1:${port}`;
  const call = (
    route: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(origin + route, {
      method,
      headers: {
        Cookie: `${SESSION_COOKIE}=${deriveSessionToken(key)}`,
        Origin: origin,
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { call, dir, probe };
}
const machine = {
  label: 'Remote',
  host: '127.0.0.1',
  port: 47100,
  fingerprint: 'AA:BB',
  token: 'never-return-this',
};
it('requires authentication, JSON and same-origin requests before changing machines', async () => {
  const { call } = await start();
  expect((await call('/__intent-web/connections', 'POST', machine, { Cookie: '' })).status).toBe(
    401,
  );
  expect(
    (
      await call('/__intent-web/connections', 'POST', machine, {
        Origin: 'https://attacker.invalid',
      })
    ).status,
  ).toBe(403);
  expect(
    (await call('/__intent-web/connections', 'POST', machine, { 'Content-Type': 'text/plain' }))
      .status,
  ).toBe(415);
  expect((await (await call('/__intent-web/connections')).json()).connections).toEqual([]);
});
it('persists machines with plaintext tokens but never returns their secrets', async () => {
  const { call, dir } = await start();
  const added = await call('/__intent-web/connections', 'POST', machine);
  expect(added.status).toBe(200);
  const result = await added.json();
  expect(result.connection.label).toBe('Remote');
  expect(JSON.stringify(result)).not.toContain(machine.token);
  const list = await (await call('/__intent-web/connections')).json();
  expect(list.connections).toHaveLength(1);
  expect(JSON.stringify(list)).not.toContain(machine.token);
  const saved = fs.readFileSync(path.join(dir, 'connections.json'), 'utf8');
  expect(saved).toContain(machine.token);
  expect(saved).toContain('"encrypted": false');
  expect(
    (await call(`/__intent-web/connections/${result.connection.id}`, 'DELETE', {})).status,
  ).toBe(200);
  expect((await (await call('/__intent-web/connections')).json()).connections).toEqual([]);
});
it('publishes standalone capabilities and no local backend when none is available', async () => {
  const { call } = await start();
  const source = await (await call('/runtime-config.js')).text();
  expect(source).toContain('connections.manage');
  expect(source).toContain('localAvailable');
  expect((await (await call('/__intent-web/connections')).json()).windowBackendId).toBeNull();
});
it('lists a present local daemon first, defaults to it and refuses to forget it', async () => {
  const { call } = await start('/tmp/intentd-test.sock');
  const list = await (await call('/__intent-web/connections')).json();
  expect(list.connections.map((c: { id: string }) => c.id)).toEqual(['local']);
  expect(list.windowBackendId).toBe('local');
  expect(await (await call('/runtime-config.js')).text()).toContain('localAvailable:true');
  expect((await call('/__intent-web/connections/local', 'DELETE', {})).status).toBe(404);
  const { connection } = await (await call('/__intent-web/connections', 'POST', machine)).json();
  expect((await (await call('/__intent-web/connections')).json()).windowBackendId).toBe('local');
  expect(
    (await (await call(`/__intent-web/connections?backend=${connection.id}`)).json())
      .windowBackendId,
  ).toBe(connection.id);
});
it('validates updates and secret rotations before persistence', async () => {
  const { call, probe } = await start();
  const { connection } = await (await call('/__intent-web/connections', 'POST', machine)).json();
  const route = `/__intent-web/connections/${connection.id}`;
  expect(
    await (await call(route, 'PATCH', { label: 'Renamed', accent: null })).json(),
  ).toMatchObject({ status: 'updated', connection: { label: 'Renamed' } });
  expect(
    await (await call(route + '/test', 'POST', { host: '127.0.0.2', port: 47101 })).json(),
  ).toMatchObject({ status: 'success' });
  expect(probe).toHaveBeenLastCalledWith(
    expect.objectContaining({ token: machine.token, expectedFingerprint: 'AA:BB' }),
  );
  expect(
    await (await call(route + '/rotate-secret', 'POST', { token: 'replacement' })).json(),
  ).toMatchObject({ status: 'updated' });
  await call(route + '/test', 'POST', { host: '127.0.0.2', port: 47101 });
  expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'replacement' }));
});
it('never sends a saved token to an unconfirmed replacement certificate', async () => {
  const { call, probe } = await start();
  const { connection } = await (await call('/__intent-web/connections', 'POST', machine)).json();
  probe.mockResolvedValue({ ok: true, fingerprint: 'CC:DD', tokenValid: true, connected: true });
  const result = await (
    await call(`/__intent-web/connections/${connection.id}/test`, 'POST', {
      host: '127.0.0.2',
      port: 47101,
    })
  ).json();
  expect(result).toMatchObject({
    status: 'fingerprint-confirmation-required',
    actualFingerprint: 'CC:DD',
  });
  expect(probe).toHaveBeenCalledExactlyOnceWith({ host: '127.0.0.2', port: 47101 });
});
it('reads and updates tunnel settings with the canonical daemon request shape', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-web-tunnel-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rpc = vi.fn(async (_id: string, method: string, params?: unknown) => {
    if (method === 'settings.list')
      return { settings: [{ path: 'server.tunnel.enabled', value: false }] };
    if (method === 'server.pairingInfo') return {};
    expect(params).toEqual({ changes: [{ path: 'server.tunnel.enabled', value: true }] });
    return { applied: [{ path: 'server.tunnel.enabled', value: true }] };
  });
  const server = await createIntentWebServer({
    dataDir: dir,
    webRoot: dir,
    getAccessKey: () => 'key',
    localSocket: null,
    tailcatAvailable: false,
    rpc,
  });
  const port = await server.listen(0);
  cleanups.push(() => server.close());
  const origin = `http://127.0.0.1:${port}`;
  const headers = {
    Cookie: `${SESSION_COOKIE}=${deriveSessionToken('key')}`,
    Origin: origin,
    'Content-Type': 'application/json',
  };
  const { connection } = await (
    await fetch(origin + '/__intent-web/connections', {
      method: 'POST',
      headers,
      body: JSON.stringify(machine),
    })
  ).json();
  const route = origin + `/__intent-web/connections/${connection.id}/tunnel`;
  expect(await (await fetch(route, { headers })).json()).toEqual({
    supported: true,
    enabled: false,
  });
  expect(
    await (
      await fetch(route, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) })
    ).json(),
  ).toEqual({ supported: true, enabled: true });
  expect(rpc.mock.calls.map((c) => c[1])).toEqual([
    'settings.list',
    'settings.list',
    'settings.update',
    'server.pairingInfo',
  ]);
});
it('persists the advertised tunnel route after enabling the tunnel', async () => {
  const { tunnelRaceAttempt } = await import('../../backend/main/backend-connection');
  const { buildConfigForRecord } = await import('../../backend/main/connection-config');
  const tcAddress = 'tc' + 'A'.repeat(52);
  for (const pairingFails of [false, true]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-web-tunnel-route-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const rpc = vi.fn(async (_id: string, method: string) => {
      if (method === 'settings.list')
        return { settings: [{ path: 'server.tunnel.enabled', value: false }] };
      if (method === 'settings.update')
        return { applied: [{ path: 'server.tunnel.enabled', value: true }] };
      if (method === 'server.pairingInfo') {
        if (pairingFails) throw new Error('server.* methods are local-only');
        return { tcAddress, localIps: ['10.0.0.5'] };
      }
      if (method === 'system.status') return { tcAddress, localIps: ['127.0.0.1', '10.0.0.6'] };
      throw new Error(`unexpected ${method}`);
    });
    const server = await createIntentWebServer({
      dataDir: dir,
      webRoot: dir,
      getAccessKey: () => 'key',
      localSocket: null,
      tailcatAvailable: true,
      tailcatBinary: '/usr/bin/tailcat',
      rpc,
    });
    const port = await server.listen(0);
    cleanups.push(() => server.close());
    const origin = `http://127.0.0.1:${port}`;
    const headers = {
      Cookie: `${SESSION_COOKIE}=${deriveSessionToken('key')}`,
      Origin: origin,
      'Content-Type': 'application/json',
    };
    const { connection } = await (
      await fetch(origin + '/__intent-web/connections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...machine, detectHosts: true }),
      })
    ).json();
    await fetch(origin + `/__intent-web/connections/${connection.id}/tunnel`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    const { connections } = await (
      await fetch(origin + '/__intent-web/connections', { headers })
    ).json();
    const record = connections.find((c: { id: string }) => c.id === connection.id);
    expect(record.tcAddress).toBe(tcAddress);
    expect(record.hosts).toEqual([pairingFails ? '10.0.0.6' : '10.0.0.5']);
    const { config } = await buildConfigForRecord({
      ...record,
      tcAddress: record.tcAddress,
      getToken: async () => 'token',
    });
    expect(tunnelRaceAttempt({ ...config, tailcatBinary: '/usr/bin/tailcat' })).toMatchObject({
      via: 'tunnel',
    });
  }
});
it('preserves optional machine presentation settings and rejects invalid values', async () => {
  const { call } = await start();
  const result = await (
    await call('/__intent-web/connections', 'POST', {
      ...machine,
      accent: 'teal',
      deviceIcon: 'robot',
      detectHosts: false,
    })
  ).json();
  expect(result.connection).toMatchObject({ accent: 'teal', deviceIcon: 'robot' });
  expect(
    (await call('/__intent-web/connections', 'POST', { ...machine, accent: 'invalid' })).status,
  ).toBe(400);
});
