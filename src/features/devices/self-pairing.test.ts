import { describe, expect, it, vi } from 'vitest';
import { readSelfPairing } from './self-pairing';
const wire = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: wire }));
const principal = {
  id: 'member-b',
  login: null,
  displayName: null,
  avatarUrl: null,
  isAdministrator: false,
  hostRole: 'member',
  hostMembershipRevision: 4,
} as const;
const reply = {
  version: 1,
  uri: 'intent://pair?v=1&host=192.0.2.8&port=5181&fp=AB&token=synthetic',
  hosts: ['192.0.2.8'],
  port: 5181,
  fingerprint: 'AB',
  token: 'synthetic',
  principal,
};
describe('current-person pairing wire contract', () => {
  it('calls only the connected host without target identity or local fallback and preserves reusable bytes', async () => {
    wire.mockResolvedValue(reply);
    expect(await readSelfPairing(principal)).toBe(reply.uri);
    expect(await readSelfPairing(principal)).toBe(reply.uri);
    expect(wire.mock.calls).toEqual([['pairing.getSelfInfo'], ['pairing.getSelfInfo']]);
  });
  it.each([
    { ...reply, principal: { ...principal, id: 'owner' } },
    { ...reply, token: 'different' },
    { ...reply, principal: { ...principal, hostRole: 'guest' } },
    { ...reply, version: 2 },
  ])('refuses mismatched identity, URI or contract', async (bad) => {
    wire.mockResolvedValue(bad);
    await expect(readSelfPairing(principal)).rejects.toThrow();
  });
  it('propagates revocation without trying the administrator endpoint', async () => {
    wire.mockReset().mockRejectedValue(new Error('access-revoked'));
    await expect(readSelfPairing(principal)).rejects.toThrow();
    expect(wire.mock.calls).toEqual([['pairing.getSelfInfo']]);
  });
});
