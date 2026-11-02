/**
 * Wire test for the profile sign-in terminal: runs the setup saga with its
 * DEFAULT deps through the real `terminal:createWithCommand` renderer bridge
 * and the live terminals client, asserting the `terminal.create` request the
 * daemon receives carries the profile folder env (PROTOCOL §5.13). Only the
 * JSON-RPC transport is faked.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { ProviderProfile } from '$shared/provider-profiles';

// test-setup stubs electron-bridge globally; this test needs the real
// `invoke` → mock IPC router → seeder path.
vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());

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

vi.mock('$features/providers/provider-auth-status.client', () => ({
  getProviderAuthVerdicts: vi.fn(async () => ({})),
  invalidateProviderAuthStatus: vi.fn(),
}));
vi.mock('$features/providers/provider-test-prompt.client', () => ({
  runProviderTestPrompt: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import '../../../seeders/terminals-scripts-seeder';
import {
  initialState,
  providerProfileSavedFolderSignInRequested,
  providerProfilesLoaded,
  providerSettingsReducer,
  providerSettingsSessionOpened,
} from '../provider-settings-slice';
import { terminalsReducer } from '../../terminals/terminals-slice';
import { providerProfileSetupSaga } from './provider-profile-setup-saga';

function profile(base: 'claude-code' | 'codex', key: string, value: string): ProviderProfile {
  return {
    id: 'p1',
    providerRef: `${base}@p1`,
    baseProviderId: base,
    name: 'Work',
    env: [{ key, kind: 'set', value }],
    settingsFingerprint: 'fp',
    createdAt: '2026-10-30T10:00:00Z',
    updatedAt: '2026-10-30T10:00:00Z',
  };
}

let task: Task | undefined;
afterEach(() => {
  task?.cancel();
  vi.clearAllMocks();
});

it.each([
  ['claude-code', 'CLAUDE_CONFIG_DIR', '~/.claude-work', 'claude auth login'],
  ['codex', 'CODEX_HOME', '~/.codex-work', 'codex login'],
] as const)(
  '%s sign-in reaches daemon terminal.create with its folder env',
  async (base, key, folder, command) => {
    const expanded = folder.replace('~', '/home/me');
    const calls: [string, unknown][] = [];
    vi.mocked(backendRequest).mockImplementation(async (method: string, params?: unknown) => {
      calls.push([method, params]);
      if (method === 'host.createDirectory') return { path: expanded } as never;
      if (method === 'terminal.create') return { terminalId: 'login-terminal' } as never;
      if (method === 'terminal.write') return { ok: true } as never;
      return { providers: [] } as never;
    });
    let state = {
      providerSettings: providerSettingsReducer(initialState, providerSettingsSessionOpened('s1')),
      terminals: terminalsReducer(undefined as never, { type: '@@init' } as never),
      daemonHealth: { transport: { mode: 'sidecar-uds' } },
    };
    const channel = stdChannel();
    const dispatch = (action: any) => {
      state = {
        ...state,
        providerSettings: providerSettingsReducer(state.providerSettings, action),
        terminals: terminalsReducer(state.terminals, action),
      };
      channel.put(action);
    };
    task = runSaga({ channel, dispatch, getState: () => state }, providerProfileSetupSaga);
    dispatch(providerProfilesLoaded([profile(base, key, folder)], 1));
    dispatch(providerProfileSavedFolderSignInRequested({ setupId: 'e1', profileId: 'p1' }));

    await vi.waitFor(() => expect(calls.map(([m]) => m)).toContain('terminal.write'));
    expect(calls.find(([m]) => m === 'terminal.create')).toEqual([
      'terminal.create',
      { workspaceId: '__root__', cols: 80, rows: 24, env: { [key]: expanded } },
    ]);
    const write = calls.find(([m]) => m === 'terminal.write')?.[1] as { data: string };
    expect(atob(write.data)).toBe(`${command}\r`);
  },
);
