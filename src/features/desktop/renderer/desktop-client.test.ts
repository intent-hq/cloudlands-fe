import { describe, expect, it, vi } from 'vitest';
const backendRequest = vi.hoisted(() => vi.fn());
const localPermissions = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest,
  electronAPI: () => ({ invoke: localPermissions }),
}));
import { desktopClient, parseDesktopEvent } from './desktop-client';
import { permission, request } from './desktop-test-fixtures';
describe('desktop wire validation', () => {
  it('reads the documented pending snapshot', async () => {
    const response = {
      state: {
        status: 'pending_permission',
        requestId: request.requestId,
        computerName: request.computerName,
      },
      permission,
      pending: request,
    };
    backendRequest
      .mockResolvedValueOnce({ server: { capabilities: { desktopControl: 1 } } })
      .mockResolvedValueOnce(response);
    expect(await desktopClient.getState('workspace', 'agent')).toEqual(response);
    expect(backendRequest).toHaveBeenLastCalledWith('desktop.getState', {
      workspaceId: 'workspace',
      agentId: 'agent',
    });
  });
  it('accepts candidate-specific claims with an unnamed shared pending state', async () => {
    const response = {
      state: { status: 'pending_permission', requestId: request.requestId },
      permission,
      pending: { ...request, claimsPrimary: true },
    };
    backendRequest
      .mockResolvedValueOnce({ server: { capabilities: { desktopControl: 1 } } })
      .mockResolvedValueOnce(response);
    expect(await desktopClient.getState('workspace', 'agent')).toEqual(response);
  });
  it('requires explicit claim semantics on permission events', () => {
    expect(
      parseDesktopEvent({
        id: 'missing-claim',
        type: 'desktop:permission-requested',
        data: { ...request, claimsPrimary: undefined },
      }),
    ).toBeUndefined();
  });
  it('rejects mismatched decision acknowledgements', async () => {
    backendRequest.mockResolvedValue({ accepted: true, requestId: 'other' });
    await expect(desktopClient.respond('workspace', 'request', 'allow_once')).rejects.toThrow(
      'Desktop control could not start',
    );
  });
  it('validates event identity, request expiry, and decision options', () => {
    const event = { id: 'event', type: 'desktop:permission-requested', data: request };
    expect(parseDesktopEvent(event)).toEqual(event);
    expect(parseDesktopEvent({ ...event, id: undefined })).toBeUndefined();
    expect(
      parseDesktopEvent({ ...event, data: { ...request, expiresAt: 'invalid' } }),
    ).toBeUndefined();
    expect(
      parseDesktopEvent({
        ...event,
        data: { ...request, options: [{ id: 'approve_all', label: 'Approve' }] },
      }),
    ).toBeUndefined();
  });
  it('accepts ownership revocation so active control can be cleared', () => {
    const event = {
      id: 'owner-change',
      type: 'desktop:session-changed',
      data: {
        workspaceId: 'workspace',
        agentId: 'agent',
        sessionId: 'session',
        computerId: 'computer',
        computerName: 'Windows workstation',
        status: 'ended',
        reason: 'owner_changed',
      },
    };
    expect(parseDesktopEvent(event)).toEqual(event);
  });
  it.each([undefined, 2, true])(
    'fails closed for unsupported capability %s',
    async (desktopControl) => {
      backendRequest.mockReset();
      backendRequest.mockResolvedValue({ server: { capabilities: { desktopControl } } });
      await expect(desktopClient.getState('workspace', 'agent')).rejects.toThrow();
      expect(backendRequest).toHaveBeenCalledExactlyOnceWith('client.hello', {});
    },
  );
});

describe('native permission check responses', () => {
  it.each([
    [true, false, 'Screen Recording'],
    [false, true, 'Accessibility'],
  ] as const)(
    'names only the missing permission (%s, %s)',
    async (accessibility, screenRecording, missing) => {
      localPermissions.mockResolvedValue({
        ok: true,
        result: { platform: 'macos', accessibility, screenRecording, screenCapture: 'ready' },
      });
      const text = await desktopClient.requestPermissions(
        'workspace',
        'agent',
        'request',
        'allow_once',
      );
      expect(text).toContain(`macOS ${missing} access is missing.`);
      expect(text).not.toContain(
        `macOS ${missing === 'Accessibility' ? 'Screen Recording' : 'Accessibility'} access is missing.`,
      );
    },
  );
  it.each([
    null,
    {},
    { platform: 'macos', accessibility: true },
    { platform: 'macos', accessibility: true, screenRecording: 'granted' },
  ])('rejects malformed permission checks %j', async (result) => {
    localPermissions.mockResolvedValue({ ok: true, result });
    await expect(
      desktopClient.requestPermissions('workspace', 'agent', 'request', 'allow_once'),
    ).rejects.toThrow();
  });
});
