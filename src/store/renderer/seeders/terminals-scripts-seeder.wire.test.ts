import { afterEach, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn().mockResolvedValue({ subscriptionId: 'terminal-subscription' }),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/client', async () => {
  const { LiveTerminalsClient } = await import('$lib/client/live/live-terminals-client');
  return { appClient: { terminals: new LiveTerminalsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import './terminals-scripts-seeder';

afterEach(() => vi.clearAllMocks());

it('routes root Claude login through a default shell and base64-framed terminal input', async () => {
  vi.mocked(backendRequest)
    .mockResolvedValueOnce({ terminalId: 'login-terminal' })
    .mockResolvedValueOnce({ ok: true });

  const result = await mockInvoke('terminal:createWithCommand', {
    workspaceId: '__root__',
    command: 'claude auth login',
  });

  expect(vi.mocked(backendRequest).mock.calls).toEqual([
    ['terminal.create', { workspaceId: '__root__', cols: 80, rows: 24 }],
    ['terminal.write', { terminalId: 'login-terminal', data: 'Y2xhdWRlIGF1dGggbG9naW4N' }],
  ]);
  expect(result).toEqual({ ok: true, terminalId: 'login-terminal' });
});
