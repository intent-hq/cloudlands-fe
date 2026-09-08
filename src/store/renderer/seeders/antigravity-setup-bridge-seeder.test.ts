import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeAntigravitySetup,
  requestAntigravitySetup,
} from '$features/antigravity/antigravity-setup.client';
import { resetMockIpcRouter } from '$shared/ipc-mock-router';
import type { AntigravitySetupResult } from '$shared/types/antigravity-setup';
import { registerAntigravitySetupBridge } from './antigravity-setup-bridge-seeder';

// The global test setup stubs this module; this regression needs its real route.
vi.unmock('$lib/electron-bridge');

describe('Antigravity setup renderer-to-preload bridge', () => {
  beforeEach(() => {
    resetMockIpcRouter();
    registerAntigravitySetupBridge();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetMockIpcRouter();
  });

  // Exercise the real setup client, generated invoke and router. Only the
  // Electron preload boundary is replaced; status must not start setup.
  it.each([
    ['status', undefined, 'idle'],
    ['start', undefined, 'checking'],
    ['login', 'operation-1', 'signingIn'],
    ['cancel', 'operation-1', 'cancelled'],
  ] as const)(
    'forwards %s and returns the main-process status',
    async (action, operationId, phase) => {
      const response: AntigravitySetupResult = {
        ok: true,
        status: {
          operationId: phase === 'idle' ? null : 'operation-1',
          supported: true,
          cliDetected: true,
          runtimeInstalled: false,
          phase,
        },
      };
      const invoke = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('window', { electronAPI: { invoke } });

      await expect(requestAntigravitySetup(action, operationId)).resolves.toEqual(response);
      expect(invoke).toHaveBeenCalledExactlyOnceWith('antigravity:setup', { action, operationId });
    },
  );

  it('closes the main-process session without a payload', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { electronAPI: { invoke } });

    await expect(closeAntigravitySetup()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('antigravity:close-setup');
  });

  it.each([undefined, {}, { electronAPI: {} }])(
    'reports setup unavailable and makes close harmless without a callable preload bridge: %j',
    async (browserWindow) => {
      vi.stubGlobal('window', browserWindow);

      await expect(requestAntigravitySetup('status')).resolves.toEqual({
        ok: false,
        code: 'unsupportedHost',
      });
      await expect(requestAntigravitySetup('start')).resolves.toEqual({
        ok: false,
        code: 'unsupportedHost',
      });
      await expect(closeAntigravitySetup()).resolves.toBeUndefined();
    },
  );

  it('preserves main-process refusal instead of reporting successful setup', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: false, code: 'remoteHost' });
    vi.stubGlobal('window', { electronAPI: { invoke } });

    await expect(requestAntigravitySetup('start')).resolves.toEqual({
      ok: false,
      code: 'remoteHost',
    });
  });

  it('propagates rejected setup and close calls to the existing saga error handling', async () => {
    const error = new Error('IPC unavailable');
    const invoke = vi.fn().mockRejectedValue(error);
    vi.stubGlobal('window', { electronAPI: { invoke } });

    await expect(requestAntigravitySetup('status')).rejects.toBe(error);
    await expect(closeAntigravitySetup()).rejects.toBe(error);
  });
});
