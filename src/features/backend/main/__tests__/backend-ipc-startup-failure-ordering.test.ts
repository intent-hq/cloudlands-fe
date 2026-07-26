/**
 * Regression test for PR #402 (blocking review comment): boot-time sidecar
 * startup failures must survive the REAL boot ordering. `src/main/index.ts`
 * awaits `startIntentdSidecar()` BEFORE `registerBackendHandlers()` and before
 * any window exists, so the `onSidecarStartupFailed` notification fires with
 * zero listeners and the `backend:status` broadcast reaches zero windows.
 *
 * The fix latches the failure in intentd-sidecar module state and exposes it
 * on the `backend:get-status` response (`sidecarStartupFailed?: true;
 * sidecarStartupFailedReason?: string` — spec addendum under "Pinned IPC
 * contract"), making delivery ordering-independent. This suite uses the REAL
 * intentd-sidecar module (only fs + the JSON-RPC client are mocked).
 */

import * as fs from 'node:fs';
import { ipcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Binary resolution fails everywhere: existsSync is false for every path, so
// startIntentdSidecar takes the binary-not-found branch (no real spawn).
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(() => false) };
});

vi.mock('../json-rpc-client', () => ({
  JsonRpcClient: class {
    on(): this {
      return this;
    }
    start(): void {}
    dispose(): void {}
    request = vi.fn(async () => ({}));
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return { transport: 'uds', socketPath: '/tmp/test.sock' };
    }
    getStatus(): string {
      return 'disconnected';
    }
  },
}));

vi.mock('../client-identity', () => ({
  getOrCreateClientId: vi.fn(async () => 'cli-test'),
  persistClientId: vi.fn(async () => {}),
}));

vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));

import { __resetIntentdSidecarForTesting, startIntentdSidecar } from '../intentd-sidecar';
import { __resetConnectionModeForTesting } from '../connection-mode';
import { registerBackendHandlers } from '../backend.ipc';

describe('boot-time sidecar startup failure survives handler registration ordering', () => {
  beforeEach(() => {
    __resetIntentdSidecarForTesting();
    __resetConnectionModeForTesting();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    __resetIntentdSidecarForTesting();
    __resetConnectionModeForTesting();
  });

  it('backend:get-status carries the latched failure when the spawn failed before registerBackendHandlers()', async () => {
    // Real boot ordering: the sidecar fails to start FIRST — no IPC handlers
    // registered yet, no onSidecarStartupFailed listener, zero windows.
    await startIntentdSidecar({ INTENTD_SIDECAR: '1' }, false, '/resources', '/cwd');

    // Handlers register afterwards, exactly as src/main/index.ts does.
    registerBackendHandlers();

    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'backend:get-status');
    expect(call).toBeDefined();
    const handler = call![1] as () => Promise<Record<string, unknown>>;

    await expect(handler()).resolves.toEqual(
      expect.objectContaining({
        status: 'disconnected',
        sidecarStartupFailed: true,
        sidecarStartupFailedReason: 'intentd binary not found',
      }),
    );
  });
});
