import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendError, type BackendErrorPayload } from '$lib/client/live/backend-transport-types';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const originalBridge = window.electronAPI;
const payload = {
  workspaceId: 'workspace',
  agentId: 'agent',
  requestId: 'request',
  decision: 'allow_once',
};
const channel = IPC_CHANNELS.BACKEND.DESKTOP_PERMISSIONS;

async function register() {
  vi.resetModules();
  await import('./backend-status-bridge-seeder');
  return (await import('$shared/ipc-mock-router')).mockInvoke;
}
afterEach(() => {
  window.electronAPI = originalBridge;
});
describe('desktop permission native bridge', () => {
  it.each([undefined, '0.0.0-browser'])('fails closed without Electron (%s)', async (version) => {
    const invoke = vi.fn();
    window.electronAPI = (
      version ? { versions: { electron: version }, invoke } : undefined
    ) as typeof window.electronAPI;
    const call = await register();
    const response = await call<{ ok: false; error: BackendErrorPayload }>(channel, payload);
    const error = new BackendError(response.error);
    expect(error.code).toBe('desktop-unsupported');
    expect(error.data).toMatchObject({ code: 'desktop-unsupported', execution: 'not_started' });
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'desktop-unsupported',
        data: { code: 'desktop-unsupported', execution: 'not_started' },
      },
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('forwards the explicit decision and preserves native permission results', async () => {
    const result = {
      ok: true,
      result: { platform: 'macos', accessibility: false, screenRecording: true },
    };
    const invoke = vi.fn().mockResolvedValue(result);
    window.electronAPI = {
      versions: { electron: '35.0.0' },
      invoke,
    } as unknown as typeof window.electronAPI;
    const call = await register();
    await expect(call(channel, payload)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(channel, payload);
  });
});
