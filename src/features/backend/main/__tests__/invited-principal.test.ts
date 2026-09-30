import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({
  request: vi.fn(),
  dispose: vi.fn(),
  config: undefined as unknown,
}));
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
  rpc.request.mockImplementation(async (method) =>
    method === 'client.hello' ? { server: { capabilities: {} } } : principal,
  );
});
describe('pinned remote personal identity (wire-shaped fixtures)', () => {
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
