/**
 * Unit tests for the remote-machine relay (main process): the owner makes a
 * saved machine available to the current backend by minting an executor
 * credential on the machine and handing it to the backend. Clients are typed
 * mocks of the documented contract (PROTOCOL `methods/nodes.md` → remote
 * machines) — no sockets.
 */

import { describe, expect, it, vi } from 'vitest';
import { JsonRpcError } from './json-rpc-errors';
import {
  createRemoteMachineRelay,
  type RemoteMachineBackend,
  type RemoteMachineRelayDeps,
  type RemoteMachineRpcClient,
} from './remote-machine-relay';

const TOKEN = 'f'.repeat(64);

type Handler = (params: any) => unknown;
type Call = { method: string; params: any };

function client(handlers: Record<string, Handler>, calls: Call[] = []): RemoteMachineRpcClient {
  return {
    request: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new JsonRpcError({ code: -32601, message: 'Method not found' });
      return handler(params);
    }) as RemoteMachineRpcClient['request'],
  };
}

const MACHINE_ROW = {
  id: 'd-mac',
  name: 'Studio Mac',
  platform: { os: 'macos', arch: 'aarch64' },
  hosts: ['192.0.2.4'],
  port: 5179,
  tcAddress: 'tc-mac',
  fingerprint: 'AA:BB',
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-10-30T00:00:00Z',
};

function machineHandlers(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'principal.me': () => ({ id: 'owner', isAdministrator: true, hostRole: 'owner' }),
    'executor.mint': () => ({
      credentialId: 'cred-1',
      token: TOKEN,
      machine: {
        daemonId: 'd-mac',
        name: 'Studio Mac',
        platform: { os: 'macos', arch: 'aarch64' },
        port: 5179,
        hosts: ['192.0.2.4'],
        tcAddress: 'tc-mac',
        fingerprint: 'AA:BB',
      },
    }),
    'executor.revoke': () => ({ ok: true }),
    'server.pairingInfo': () => ({
      token: 'owner-token',
      certFingerprint: 'aa:bb',
      port: 5179,
      localIps: ['192.0.2.4'],
    }),
    ...overrides,
  };
}

function backendHandlers(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'remoteMachines.backendInfo': () => ({
      backendId: 'head-1',
      backendName: 'Build box',
      fingerprint: 'CC:DD',
    }),
    'remoteMachines.add': () => ({ machine: MACHINE_ROW }),
    'remoteMachines.remove': () => ({ ok: true, credentialId: 'cred-1' }),
    ...overrides,
  };
}

function setup(
  options: {
    machine?: Record<string, Handler>;
    backend?: Record<string, Handler>;
    supports?: boolean;
    owner?: boolean;
    connected?: boolean;
    backendConnectionId?: string;
  } = {},
) {
  const machineCalls: Call[] = [];
  const backendCalls: Call[] = [];
  const machine = client(machineHandlers(options.machine), machineCalls);
  const logger = { info: vi.fn(), warn: vi.fn() };
  const deps: RemoteMachineRelayDeps = {
    localConnectionId: 'local',
    getMachineClient: (id) => (options.connected === false ? undefined : id ? machine : undefined),
    isOwnerConnection: async () => options.owner !== false,
    logger,
  };
  const backend: RemoteMachineBackend = {
    connectionId: options.backendConnectionId ?? 'build-box',
    client: client(backendHandlers(options.backend), backendCalls),
    supportsRemoteMachines: options.supports !== false,
  };
  return { relay: createRemoteMachineRelay(deps), backend, machineCalls, backendCalls, logger };
}

describe('remote machine relay — expose', () => {
  it('mints on the machine, then adds to the backend with the minted routes and token', async () => {
    const { relay, backend, machineCalls, backendCalls } = setup();
    const result = await relay.expose({ machineConnectionId: 'mac' }, backend);
    expect(result).toEqual({ success: true, machine: expect.objectContaining({ id: 'd-mac' }) });
    expect(machineCalls.map((c) => c.method)).toEqual(['principal.me', 'executor.mint']);
    expect(machineCalls[1].params).toEqual({
      backendId: 'head-1',
      backendName: 'Build box',
      backendFingerprint: 'CC:DD',
    });
    expect(backendCalls.map((c) => c.method)).toEqual([
      'remoteMachines.backendInfo',
      'remoteMachines.add',
    ]);
    expect(backendCalls[1].params).toEqual({
      machineId: 'd-mac',
      name: 'Studio Mac',
      hosts: ['192.0.2.4'],
      port: 5179,
      tcAddress: 'tc-mac',
      fingerprint: 'AA:BB',
      credentialId: 'cred-1',
      token: TOKEN,
    });
  });

  it('never returns or logs the executor token', async () => {
    const { relay, backend, logger } = setup({
      backend: {
        'remoteMachines.add': () => {
          throw new JsonRpcError({
            code: -32603,
            message: 'unreachable',
            data: { code: 'machine-unreachable', attempts: [] },
          });
        },
      },
    });
    const result = await relay.expose({ machineConnectionId: 'mac' }, backend);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    for (const fn of [logger.info, logger.warn])
      expect(JSON.stringify(fn.mock.calls)).not.toContain(TOKEN);
  });

  it('revokes the fresh credential when the backend probe fails, naming the routes tried', async () => {
    const { relay, backend, machineCalls } = setup({
      backend: {
        'remoteMachines.add': () => {
          throw new JsonRpcError({
            code: -32603,
            message: 'Could not reach Studio Mac',
            data: {
              code: 'machine-unreachable',
              attempts: [{ route: '192.0.2.4:5179', error: 'node-link-certificate-mismatch' }],
            },
          });
        },
      },
    });
    const result = await relay.expose({ machineConnectionId: 'mac' }, backend);
    expect(result).toMatchObject({
      success: false,
      code: 'machine-unreachable',
      attempts: [{ route: '192.0.2.4:5179', error: 'node-link-certificate-mismatch' }],
    });
    expect(machineCalls.at(-1)).toEqual({
      method: 'executor.revoke',
      params: { credentialId: 'cred-1' },
    });
  });

  it('reports an update-required backend probe and still revokes', async () => {
    const { relay, backend, machineCalls } = setup({
      backend: {
        'remoteMachines.add': () => {
          throw new JsonRpcError({
            code: -32602,
            message: 'Update Intent on Studio Mac',
            data: {
              code: 'machine-update-required',
              machineVersion: '0.9.0',
              backendVersion: '1.2.0',
              update: 'machine',
            },
          });
        },
      },
    });
    const result = await relay.expose({ machineConnectionId: 'mac' }, backend);
    expect(result).toMatchObject({
      success: false,
      code: 'machine-update-required',
      update: 'machine',
      machineVersion: '0.9.0',
      backendVersion: '1.2.0',
    });
    expect(machineCalls.map((c) => c.method)).toContain('executor.revoke');
  });

  it('maps a machine without executor.* (-32601) to update-required on the machine', async () => {
    const { relay, backend, backendCalls } = setup({
      machine: {
        'executor.mint': () => {
          throw new JsonRpcError({ code: -32601, message: 'Method not found' });
        },
      },
    });
    const result = await relay.expose({ machineConnectionId: 'mac' }, backend);
    expect(result).toMatchObject({
      success: false,
      code: 'machine-update-required',
      update: 'machine',
    });
    expect(backendCalls.map((c) => c.method)).not.toContain('remoteMachines.add');
  });

  it('revokes and reports listener-off when the machine advertises no route at all', async () => {
    const { relay, backend, machineCalls, backendCalls } = setup({
      machine: {
        'executor.mint': () => ({
          credentialId: 'cred-1',
          token: TOKEN,
          machine: {
            daemonId: 'd-mac',
            name: 'Studio Mac',
            port: 5179,
            hosts: [],
            fingerprint: 'AA:BB',
          },
        }),
      },
    });
    expect(await relay.expose({ machineConnectionId: 'mac' }, backend)).toEqual({
      success: false,
      code: 'listener-off',
    });
    expect(backendCalls.map((call) => call.method)).not.toContain('remoteMachines.add');
    expect(machineCalls.at(-1)).toEqual({
      method: 'executor.revoke',
      params: { credentialId: 'cred-1' },
    });
  });

  it('adds a tailcat-only machine (no LAN hosts) with its tunnel address', async () => {
    const { relay, backend, backendCalls, machineCalls } = setup({
      machine: {
        'executor.mint': () => ({
          credentialId: 'cred-1',
          token: TOKEN,
          machine: {
            daemonId: 'd-mac',
            name: 'Studio Mac',
            port: 5179,
            hosts: [],
            tcAddress: 'tc-mac',
            fingerprint: 'AA:BB',
          },
        }),
      },
    });
    expect(await relay.expose({ machineConnectionId: 'mac' }, backend)).toMatchObject({
      success: true,
    });
    expect(backendCalls.at(-1)).toMatchObject({
      method: 'remoteMachines.add',
      params: { machineId: 'd-mac', hosts: [], tcAddress: 'tc-mac' },
    });
    expect(machineCalls.map((call) => call.method)).not.toContain('executor.revoke');
  });

  it('treats a blank tailcat address as no route', async () => {
    const { relay, backend, backendCalls } = setup({
      machine: {
        'executor.mint': () => ({
          credentialId: 'cred-1',
          token: TOKEN,
          machine: {
            daemonId: 'd-mac',
            name: 'Mac',
            port: 5179,
            hosts: [],
            tcAddress: '  ',
            fingerprint: 'AA:BB',
          },
        }),
      },
    });
    expect(await relay.expose({ machineConnectionId: 'mac' }, backend)).toEqual({
      success: false,
      code: 'listener-off',
    });
    expect(backendCalls.map((call) => call.method)).not.toContain('remoteMachines.add');
  });

  it('treats an unknown daemon code (the removed remote-agents-disabled) as a generic failure', async () => {
    const { relay, backend } = setup({
      machine: {
        'executor.mint': () => {
          throw new JsonRpcError({
            code: -32602,
            message: 'Remote agents are off',
            data: { code: 'remote-agents-disabled' },
          });
        },
      },
    });
    expect(await relay.expose({ machineConnectionId: 'mac' }, backend)).toEqual({
      success: false,
      code: 'failed',
      message: 'Remote agents are off',
    });
  });

  it('revokes the replaced credential after a successful re-expose', async () => {
    const { relay, backend, machineCalls } = setup({
      backend: {
        'remoteMachines.add': () => ({ machine: MACHINE_ROW, replacedCredentialId: 'cred-old' }),
      },
    });
    await relay.expose({ machineConnectionId: 'mac' }, backend);
    expect(machineCalls.at(-1)).toEqual({
      method: 'executor.revoke',
      params: { credentialId: 'cred-old' },
    });
  });

  it('refuses when the backend does not advertise remoteMachines', async () => {
    const { relay, backend, machineCalls } = setup({ supports: false });
    expect(await relay.expose({ machineConnectionId: 'mac' }, backend)).toMatchObject({
      success: false,
      code: 'unsupported-backend',
    });
    expect(machineCalls).toEqual([]);
  });

  it('refuses to expose the current backend to itself', async () => {
    const { relay, backend } = setup({ backendConnectionId: 'mac' });
    expect(await relay.expose({ machineConnectionId: 'mac' }, backend)).toMatchObject({
      code: 'same-machine',
    });
  });

  it('refuses guest sessions and non-owner principals before minting', async () => {
    const guest = setup({ owner: false });
    expect(await guest.relay.expose({ machineConnectionId: 'mac' }, guest.backend)).toMatchObject({
      code: 'not-owner',
    });
    expect(guest.machineCalls).toEqual([]);

    const member = setup({
      machine: {
        'principal.me': () => ({ id: 'm', isAdministrator: false, hostRole: 'member' }),
      },
    });
    expect(await member.relay.expose({ machineConnectionId: 'mac' }, member.backend)).toMatchObject(
      { code: 'not-owner' },
    );
    expect(member.machineCalls.map((c) => c.method)).toEqual(['principal.me']);
  });

  it('refuses a machine that is not connected', async () => {
    const { relay, backend } = setup({ connected: false });
    expect(await relay.expose({ machineConnectionId: 'mac' }, backend)).toMatchObject({
      code: 'machine-not-connected',
    });
  });

  describe('local machine listener', () => {
    const off = {
      'server.pairingInfo': () => ({
        token: 'owner-token',
        certFingerprint: 'aa:bb',
        port: null,
        localIps: ['127.0.0.1'],
      }),
    };

    it('asks to turn on a listener when neither WSS nor tailcat is reachable', async () => {
      const { relay, backend, machineCalls } = setup({ machine: off });
      expect(await relay.expose({ machineConnectionId: 'local' }, backend)).toMatchObject({
        success: false,
        code: 'listener-off',
      });
      expect(machineCalls.map((c) => c.method)).not.toContain('executor.mint');
    });

    it('turns on WSS when the user confirmed, then exposes', async () => {
      let enabled = false;
      const { relay, backend, machineCalls } = setup({
        machine: {
          'server.pairingInfo': () => ({
            token: 'owner-token',
            certFingerprint: 'aa:bb',
            port: enabled ? 5179 : null,
            localIps: ['192.0.2.4'],
          }),
          'settings.update': (params) => {
            enabled = true;
            return { applied: params.changes };
          },
        },
      });
      const result = await relay.expose(
        { machineConnectionId: 'local', enableListener: 'wss' },
        backend,
      );
      expect(result.success).toBe(true);
      expect(machineCalls.find((c) => c.method === 'settings.update')?.params).toEqual({
        changes: [{ path: 'server.wsApi.enabled', value: true }],
      });
    });

    it('turns on tailcat (and WSS) when the user picked tailcat', async () => {
      let tunnel = false;
      const { relay, backend, machineCalls } = setup({
        machine: {
          'server.pairingInfo': () => ({
            token: 'owner-token',
            certFingerprint: 'aa:bb',
            port: 5179,
            localIps: [],
            ...(tunnel ? { tcAddress: 'tc-mac' } : {}),
          }),
          'settings.list': () => ({
            settings: [{ path: 'server.tunnel.enabled', value: tunnel }],
          }),
          'settings.update': (params) => {
            if (params.changes.some((c: { path: string }) => c.path === 'server.tunnel.enabled'))
              tunnel = true;
            return { applied: params.changes };
          },
        },
      });
      const result = await relay.expose(
        { machineConnectionId: 'local', enableListener: 'tailcat' },
        backend,
      );
      expect(result.success).toBe(true);
      expect(
        machineCalls.filter((c) => c.method === 'settings.update').map((c) => c.params.changes[0]),
      ).toEqual([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.tunnel.enabled', value: true },
      ]);
    });
  });
});

describe('remote machine relay — unexpose', () => {
  it('removes from the backend, then revokes on the machine', async () => {
    const { relay, backend, machineCalls, backendCalls } = setup();
    const result = await relay.unexpose(
      { machineId: 'd-mac', machineConnectionId: 'mac' },
      backend,
    );
    expect(result).toEqual({ success: true, revoked: true });
    expect(backendCalls.at(-1)).toEqual({
      method: 'remoteMachines.remove',
      params: { machineId: 'd-mac' },
    });
    expect(machineCalls.at(-1)).toEqual({
      method: 'executor.revoke',
      params: { credentialId: 'cred-1' },
    });
  });

  it('reports machine-in-use with the running agent count', async () => {
    const { relay, backend, machineCalls } = setup({
      backend: {
        'remoteMachines.remove': () => {
          throw new JsonRpcError({
            code: -32602,
            message: 'in use',
            data: { code: 'machine-in-use', runningAgents: 2 },
          });
        },
      },
    });
    expect(
      await relay.unexpose({ machineId: 'd-mac', machineConnectionId: 'mac' }, backend),
    ).toMatchObject({ success: false, code: 'machine-in-use', runningAgents: 2 });
    expect(machineCalls).toEqual([]);
  });

  it('passes stopAgents through when confirmed', async () => {
    const { relay, backend, backendCalls } = setup();
    await relay.unexpose({ machineId: 'd-mac', stopAgents: true }, backend);
    expect(backendCalls.at(-1)?.params).toEqual({ machineId: 'd-mac', stopAgents: true });
  });

  it('waits past the 30 s stop-acknowledgement window when stopping agents', async () => {
    const { relay, backend } = setup();
    await relay.unexpose({ machineId: 'd-mac', stopAgents: true }, backend);
    const request = vi.mocked(backend.client.request);
    const [, , options] = request.mock.calls.at(-1) ?? [];
    expect(options?.timeoutMs).toBeGreaterThan(30_000);
  });

  it('reports unconfirmed stops, removes nothing and does not revoke', async () => {
    const { relay, backend, machineCalls } = setup({
      backend: {
        'remoteMachines.remove': () => {
          throw new JsonRpcError({
            code: -32603,
            message: 'Studio Mac did not confirm 2 stops',
            data: {
              code: 'machine-unreachable',
              attempts: [],
              unconfirmedStops: ['agent-1', 'agent-2', 7],
            },
          });
        },
      },
    });
    expect(
      await relay.unexpose(
        { machineId: 'd-mac', machineConnectionId: 'mac', stopAgents: true },
        backend,
      ),
    ).toEqual({
      success: false,
      code: 'machine-unreachable',
      message: 'Studio Mac did not confirm 2 stops',
      attempts: [],
      unconfirmedStops: ['agent-1', 'agent-2'],
    });
    expect(machineCalls).toEqual([]);
  });

  it('still succeeds, unrevoked, when the machine is not reachable', async () => {
    const offline = setup({ connected: false });
    expect(
      await offline.relay.unexpose(
        { machineId: 'd-mac', machineConnectionId: 'mac' },
        offline.backend,
      ),
    ).toEqual({ success: true, revoked: false });

    const failing = setup({
      machine: {
        'executor.revoke': () => {
          throw new Error('socket closed');
        },
      },
    });
    expect(
      await failing.relay.unexpose(
        { machineId: 'd-mac', machineConnectionId: 'mac' },
        failing.backend,
      ),
    ).toEqual({ success: true, revoked: false });
  });
});

describe('remote machine relay — machine fingerprint', () => {
  it('reads the local machine certificate fingerprint, normalized', async () => {
    const { relay } = setup();
    expect(await relay.machineFingerprint('local')).toBe('AA:BB');
  });
});
