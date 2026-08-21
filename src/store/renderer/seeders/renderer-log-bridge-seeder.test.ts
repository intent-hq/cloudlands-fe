import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockInvoke,
  resetMockIpcRouter,
  UNBRIDGED_INVOKE_ALLOWLIST,
  UnbridgedMockIpcChannelError,
} from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { registerRendererLogBridge } from './renderer-log-bridge-seeder';

const CHANNEL = IPC_CHANNELS.LOG.PERSIST_RENDERER_LOGS;
const originalElectronAPI = (window as any).electronAPI;

describe('renderer-log-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('removes the obsolete no-op allowlist entry', async () => {
    expect(UNBRIDGED_INVOKE_ALLOWLIST.has(CHANNEL)).toBe(false);
    await expect(mockInvoke(CHANNEL, [])).rejects.toBeInstanceOf(UnbridgedMockIpcChannelError);
  });

  it('forwards the complete log batch unchanged to the preload bridge', async () => {
    const invokeSpy = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerRendererLogBridge();
    const batch = [
      {
        timestamp: '2026-08-21T16:00:00.000Z',
        level: 'INFO',
        category: 'agent',
        message: 'stream-lifecycle',
        context: { event: 'agent-failed-received', turnCorrelation: 'abc123' },
      },
    ];

    await expect(mockInvoke(CHANNEL, batch)).resolves.toEqual({ success: true });
    expect(invokeSpy).toHaveBeenCalledExactlyOnceWith(CHANNEL, batch);
    expect(invokeSpy.mock.calls[0]?.[1]).toBe(batch);
  });

  it('resolves undefined when the preload bridge is absent', async () => {
    (window as any).electronAPI = undefined;
    registerRendererLogBridge();

    await expect(mockInvoke(CHANNEL, [{ message: 'stream-lifecycle' }])).resolves.toBeUndefined();
  });
});
