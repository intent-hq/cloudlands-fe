import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for `SentryAuthService` daemon persistence
 * (PROTOCOL.md §5.12). The legacy `sentry-auth` electron-store is retired;
 * credentials are pushed to `accounts.sentry.token` (secret) +
 * `accounts.sentry.organization` (string) via `settings.update` using the
 * batched `{ changes: [{ path, value }] }` shape (router.rs:1922 /
 * settings.rs:852 reject the top-level `{ path, value }` form with -32602),
 * and cleared via `settings.reset` on logout.
 */

const requestMock = vi.hoisted(() => vi.fn(async () => ({ path: '', value: null })));

vi.mock('../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

describe('SentryAuthService ↔ daemon settings.* (PROTOCOL.md §5.12)', () => {
  beforeEach(() => {
    requestMock.mockClear();
    vi.resetModules();
  });

  it('saveConfig pushes token + organization via settings.update { changes: [...] }', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'Acme' }),
    })) as unknown as typeof fetch;
    const { SentryAuthService } = await import('./main/sentry-auth.service');
    const svc = new SentryAuthService();
    const result = await svc.saveConfig('acme', 'sntrys_dummy');
    expect(result.success).toBe(true);
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'accounts.sentry.token', value: 'sntrys_dummy' }],
    });
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'accounts.sentry.organization', value: 'acme' }],
    });
  });

  it('saveConfig pushes exactly the { changes: [{ path, value }] } wire shape (regression for B1)', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'Acme' }),
    })) as unknown as typeof fetch;
    const { SentryAuthService } = await import('./main/sentry-auth.service');
    const svc = new SentryAuthService();
    await svc.saveConfig('acme', 'sntrys_dummy');
    const updateCalls = requestMock.mock.calls.filter(([method]) => method === 'settings.update');
    expect(updateCalls).toHaveLength(2);
    for (const [, params] of updateCalls) {
      // Top-level params MUST be { changes: [...] } — never { path, value }.
      expect(params).toHaveProperty('changes');
      expect(params).not.toHaveProperty('path');
      expect(params).not.toHaveProperty('value');
      const body = params as { changes: { path: string; value: unknown }[] };
      expect(Array.isArray(body.changes)).toBe(true);
      expect(body.changes).toHaveLength(1);
      expect(typeof body.changes[0].path).toBe('string');
    }
  });

  it('logs settings.update failures so daemon RPC errors (e.g. -32602) are visible', async () => {
    const errorSpy = vi.fn();
    vi.doMock('../../shared/logger', () => ({
      Logger: class {
        info() {}
        warn() {}
        debug() {}
        error = errorSpy;
      },
    }));
    vi.resetModules();
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'Acme' }),
    })) as unknown as typeof fetch;
    const rpcError = Object.assign(new Error('invalid params'), { code: -32602 });
    requestMock.mockRejectedValueOnce(rpcError);
    const { SentryAuthService } = await import('./main/sentry-auth.service');
    const svc = new SentryAuthService();
    await svc.saveConfig('acme', 'sntrys_dummy');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist Sentry config on daemon'),
      rpcError,
    );
    vi.doUnmock('../../shared/logger');
  });

  it('logout resets both settings paths on the daemon', async () => {
    const { SentryAuthService } = await import('./main/sentry-auth.service');
    const svc = new SentryAuthService();
    await svc.logout();
    expect(requestMock).toHaveBeenCalledWith('settings.reset', {
      path: 'accounts.sentry.token',
    });
    expect(requestMock).toHaveBeenCalledWith('settings.reset', {
      path: 'accounts.sentry.organization',
    });
  });

  it('getApiToken reflects in-memory state only (no daemon round-trip)', async () => {
    const { SentryAuthService } = await import('./main/sentry-auth.service');
    const svc = new SentryAuthService();
    expect(svc.getApiToken()).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
