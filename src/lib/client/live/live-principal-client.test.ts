import { beforeEach, describe, expect, it, vi } from 'vitest';

const wire = vi.hoisted(() => ({ request: vi.fn(), capabilities: vi.fn() }));
vi.mock('./backend-transport', () => ({
  backendRequest: wire.request,
  observeBackendNodeCapabilities: wire.capabilities,
}));

import { BackendError } from './backend-transport-types';
import { readConnectedPrincipal } from './live-principal-client';

const principal = {
  id: 'caller',
  login: null,
  displayName: null,
  avatarUrl: null,
  isAdministrator: false,
  hostRole: 'member',
  hostMembershipRevision: 2,
};

describe('principal discovery on the confirmed connection', () => {
  beforeEach(() => {
    wire.request.mockReset().mockResolvedValue(principal);
    wire.capabilities.mockReset().mockResolvedValue({
      server: {
        capabilities: {
          hostMembership: 1,
          collaborationIdentity: 1,
          personalPairing: 1,
          authenticatedDevices: 1,
          gitlabCheckout: 1,
          submissionCorrelation: 1,
          invitationAccountSearch: 1,
        },
      },
    });
  });

  it('observes confirmed capabilities without renewing the event session', async () => {
    const result = await readConnectedPrincipal();
    expect(wire.capabilities).toHaveBeenCalledTimes(1);
    expect(wire.request.mock.calls).toEqual([['principal.me', {}]]);
    expect(result.capabilities).toEqual({
      hostMembership: true,
      collaborationIdentity: true,
      personalPairing: true,
      authenticatedDevices: true,
      gitlabCheckout: true,
      submissionCorrelation: 1,
      invitationAccountSearch: true,
    });
  });

  it('accepts explicitly confirmed legacy capabilities', async () => {
    wire.capabilities.mockResolvedValue({ server: { capabilities: {} } });
    wire.request.mockResolvedValue({ ...principal, hostRole: undefined });
    expect((await readConnectedPrincipal()).capabilities.hostMembership).toBe(false);
  });

  it('never downgrades an unconfirmed connection to legacy authority', async () => {
    const error = new Error('Connection identity is not confirmed');
    wire.capabilities.mockRejectedValue(error);
    await expect(readConnectedPrincipal()).rejects.toBe(error);
  });

  it('preserves a principal refusal when capability observation also fails', async () => {
    wire.capabilities.mockRejectedValue(new Error('Connection changed'));
    const error = new BackendError({
      code: 'TRANSPORT_ERROR',
      message: 'Forbidden',
      rpcCode: -32003,
    });
    wire.request.mockRejectedValue(error);
    await expect(readConnectedPrincipal()).rejects.toBe(error);
  });
});
