import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({
  request: vi.fn(),
  dispose: vi.fn(),
  config: undefined as unknown,
  bundledVersion: '0.9.137' as string | null,
}));
vi.mock('../intentd-version-pin', () => ({ readPinnedVersion: () => rpc.bundledVersion }));
vi.mock('../json-rpc-client', () => ({
  JsonRpcClient: class {
    constructor(options: { config: unknown }) {
      rpc.config = options.config;
    }
    request = rpc.request;
    dispose = rpc.dispose;
    on() {}
  },
}));
import { authenticateInvitedCredential, inspectPersonalCredential } from '../invited-principal';
import { JsonRpcError } from '../json-rpc-errors';
const candidate = {
  host: 'host.example',
  hosts: ['host.example'],
  port: 443,
  fingerprint: 'ab'.repeat(32),
  tcAddress: null,
  token: 'personal-secret',
  principalId: 'B',
};
const principal = {
  id: 'B',
  login: null,
  displayName: null,
  avatarUrl: null,
  isAdministrator: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  rpc.bundledVersion = '0.9.137';
  rpc.request.mockImplementation(async (method) =>
    method === 'client.hello' ? { server: { capabilities: {} } } : principal,
  );
});
describe('pinned remote personal identity (wire-shaped fixtures)', () => {
  it('rejects the reported old protocol before principal.me and names both daemon versions', async () => {
    rpc.request.mockResolvedValue({
      server: { version: '0.9.12', protocolVersion: '9.4', capabilities: { liveState: true } },
    });
    const error = await inspectPersonalCredential(candidate).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('0.9.12');
    expect((error as Error).message).toContain('0.9.137');
    expect(rpc.request.mock.calls.map(([method]) => method)).toEqual(['client.hello']);
    expect(rpc.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['0.9.137', '11.2'],
    ['0.9.136', '11.2'],
    ['0.9.86', '10.3'],
    [undefined, '11.2'],
  ])(
    'accepts identity-compatible daemon %s regardless of product version age',
    async (version, protocolVersion) => {
      rpc.request.mockImplementation(async (method) =>
        method === 'client.hello'
          ? { server: { version, protocolVersion, capabilities: {} } }
          : principal,
      );
      expect((await inspectPersonalCredential(candidate)).principal.id).toBe('B');
      expect(rpc.request.mock.calls.map(([method]) => method)).toEqual([
        'client.hello',
        'principal.me',
      ]);
    },
  );

  it.each([undefined, true, '1', 2, 0, null])(
    'rejects protocol 10.2 with unrecognized identity capability %s',
    async (capability) => {
      rpc.request.mockResolvedValue({
        server: {
          protocolVersion: '10.2',
          capabilities: { collaborationIdentity: capability, hostMembership: capability },
        },
      });
      await expect(inspectPersonalCredential(candidate)).rejects.toThrow('principal.me');
      expect(rpc.request).toHaveBeenCalledOnce();
    },
  );

  it.each(['collaborationIdentity', 'hostMembership'])(
    'still requires explicit authority when %s advertises the identity contract',
    async (capability) => {
      rpc.request.mockImplementation(async (method) =>
        method === 'client.hello'
          ? { server: { protocolVersion: '10.2', capabilities: { [capability]: 1 } } }
          : { ...principal, isAdministrator: undefined },
      );
      await expect(inspectPersonalCredential(candidate)).rejects.toThrow('identity unavailable');
      expect(rpc.request.mock.calls.map(([method]) => method)).toEqual([
        'client.hello',
        'principal.me',
      ]);
    },
  );

  it.each([
    undefined,
    null,
    {},
    { server: null },
    { server: { protocolVersion: 'unknown' } },
    { server: { protocolVersion: 9.4 } },
  ])('does not derive authority from malformed hello %j', async (hello) => {
    rpc.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return hello;
      throw new JsonRpcError({ code: -32601, message: 'untrusted raw payload' });
    });
    const error = await inspectPersonalCredential(candidate).catch((error: unknown) => error);
    expect(error).toMatchObject({ rpcCode: -32601 });
    expect((error as Error).message).not.toContain('untrusted raw payload');
    expect(rpc.request.mock.calls.map(([method]) => method)).toEqual([
      'client.hello',
      'principal.me',
    ]);
  });

  it.each([undefined, null, 12, 'not-a-version'])(
    'does not invent a target version for %s metadata',
    async (version) => {
      rpc.request.mockResolvedValue({ server: { version, protocolVersion: '9.4' } });
      const error = await inspectPersonalCredential(candidate).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('0.9.137');
      expect((error as Error).message).not.toContain('0.9.12');
      expect((error as Error).message).not.toContain('not-a-version');
      expect(rpc.request).toHaveBeenCalledOnce();
    },
  );

  it('does not fabricate an unavailable bundled pin', async () => {
    rpc.bundledVersion = null;
    rpc.request.mockResolvedValue({ server: { version: '0.9.12', protocolVersion: '9.4' } });
    const error = await inspectPersonalCredential(candidate).catch((error: unknown) => error);
    expect((error as Error).message).toContain('0.9.12');
    expect((error as Error).message).not.toContain('0.9.137');
    expect(rpc.request).toHaveBeenCalledOnce();
  });

  it('pins TLS and authenticates the remote bearer before asking for the current principal', async () => {
    expect(await authenticateInvitedCredential(candidate)).toEqual({
      principalId: 'B',
      login: null,
    });
    expect(rpc.config).toMatchObject({
      transport: 'wss',
      fingerprint: candidate.fingerprint,
      token: candidate.token,
    });
    expect(rpc.request.mock.calls.map(([method]) => method)).toEqual([
      'client.hello',
      'principal.me',
    ]);
    expect(rpc.dispose).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['another principal', { ...principal, id: 'C' }, {}],
    ['missing administrator authority', { ...principal, isAdministrator: undefined }, {}],
    [
      'unknown advertised role',
      { ...principal, hostRole: 'other', hostMembershipRevision: 1 },
      { hostMembership: 1 },
    ],
    [
      'contradictory owner role',
      { ...principal, hostRole: 'owner', hostMembershipRevision: 1 },
      { hostMembership: 1 },
    ],
  ])('refuses %s without re-keying the credential', async (_label, response, capabilities) => {
    rpc.request.mockImplementation(async (method) =>
      method === 'client.hello' ? { server: { capabilities } } : response,
    );
    await expect(authenticateInvitedCredential(candidate)).rejects.toThrow();
    expect(rpc.dispose).toHaveBeenCalledTimes(1);
  });
  it('returns owner authority for import classification but never admits it to invited sync', async () => {
    rpc.request.mockImplementation(async (method) =>
      method === 'client.hello' ? { server: {} } : { ...principal, isAdministrator: true },
    );
    expect((await inspectPersonalCredential(candidate)).principal.isAdministrator).toBe(true);
    expect(await authenticateInvitedCredential(candidate)).toBeNull();
  });
  it.each(['client.hello', 'principal.me'])(
    'preserves the missing-method code and identifies %s',
    async (method) => {
      rpc.request.mockImplementation(async (requested) => {
        if (requested === method)
          throw new JsonRpcError({ code: -32601, message: 'Method not found' });
        return { server: { capabilities: {} } };
      });
      const error = await inspectPersonalCredential(candidate).catch((error: unknown) => error);
      expect(error).toMatchObject({
        rpcCode: -32601,
        code: 'METHOD_NOT_FOUND',
        message: expect.stringContaining(method),
      });
      expect(rpc.dispose).toHaveBeenCalledOnce();
      expect(rpc.request).toHaveBeenCalledTimes(method === 'client.hello' ? 1 : 2);
    },
  );

  it.each([-32001, -32003, -32602, -32603])(
    'preserves non-missing RPC failure %s without a fallback',
    async (code) => {
      const error = new JsonRpcError({ code, message: 'request refused' });
      rpc.request.mockImplementation(async (method) => {
        if (method === 'client.hello') return { server: { capabilities: {} } };
        throw error;
      });
      await expect(inspectPersonalCredential(candidate)).rejects.toBe(error);
      expect(rpc.request.mock.calls.map(([method]) => method)).toEqual([
        'client.hello',
        'principal.me',
      ]);
      expect(rpc.dispose).toHaveBeenCalledOnce();
    },
  );

  it('closes the one-shot transport on pin/auth/RPC failure', async () => {
    rpc.request.mockRejectedValue(new Error('authentication unavailable'));
    await expect(inspectPersonalCredential(candidate)).rejects.toThrow();
    expect(rpc.dispose).toHaveBeenCalledOnce();
    expect(rpc.request).toHaveBeenCalledOnce();
  });
  it('never dials an unpinned legacy candidate', async () => {
    await expect(inspectPersonalCredential({ ...candidate, fingerprint: '' })).rejects.toThrow();
    expect(rpc.request).not.toHaveBeenCalled();
  });
});
