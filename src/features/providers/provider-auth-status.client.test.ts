import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  reconnect: undefined as undefined | (() => void),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: () => () => {},
  onBackendReconnected: (fn: () => void) => {
    mocks.reconnect = fn;
    return () => {};
  },
}));
import {
  getProviderAuthVerdicts,
  invalidateProviderAuthStatus,
  __resetProviderAuthStatusForTests,
} from './provider-auth-status.client';
afterEach(() => {
  __resetProviderAuthStatusForTests();
  vi.clearAllMocks();
});
it('separates workspace inflight auth and drops every context on global invalidation or reconnect', async () => {
  let releaseA!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    releaseA = resolve;
  });
  mocks.request.mockImplementation(async (_method, params) =>
    params.workspaceId === 'A' ? pending : { providers: [{ id: 'codex', authenticated: true }] },
  );
  const a = getProviderAuthVerdicts({ workspaceId: 'A', providerId: 'codex' });
  const b = await getProviderAuthVerdicts({ workspaceId: 'B', providerId: 'codex' });
  expect(b.codex.authenticated).toBe(true);
  releaseA({ providers: [{ id: 'codex', authenticated: false }] });
  expect((await a).codex.authenticated).toBe(false);
  expect(
    (await getProviderAuthVerdicts({ workspaceId: 'B', providerId: 'codex' })).codex.authenticated,
  ).toBe(true);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  invalidateProviderAuthStatus('codex');
  await getProviderAuthVerdicts({ workspaceId: 'B', providerId: 'codex' });
  expect(mocks.request).toHaveBeenCalledTimes(3);
  mocks.reconnect?.();
  await getProviderAuthVerdicts({ workspaceId: 'B', providerId: 'codex' });
  expect(mocks.request).toHaveBeenCalledTimes(4);
  expect(mocks.request).toHaveBeenLastCalledWith('host.providerAuthStatus', {
    workspaceId: 'B',
    providerId: 'codex',
  });
});
