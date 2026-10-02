import { describe, expect, it, vi } from 'vitest';
const backendRequest = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest }));
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
