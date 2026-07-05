import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for `SentryAuthService` daemon persistence
 * (PROTOCOL.md §5.12). The legacy `sentry-auth` electron-store is retired;
 * credentials are pushed to `accounts.sentry.token` (secret) +
 * `accounts.sentry.organization` (string) via `settings.update`, and
 * cleared via `settings.reset` on logout.
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

  it('saveConfig pushes token + organization via settings.update', async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'Acme' }),
    })) as unknown as typeof fetch;
    const { SentryAuthService } = await import('./main/sentry-auth.service');
    const svc = new SentryAuthService();
    const result = await svc.saveConfig('acme', 'sntrys_dummy');
    expect(result.success).toBe(true);
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      path: 'accounts.sentry.token',
      value: 'sntrys_dummy',
    });
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      path: 'accounts.sentry.organization',
      value: 'acme',
    });
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
