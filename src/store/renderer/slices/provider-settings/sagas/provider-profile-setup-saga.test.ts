import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { all, call } from 'typed-redux-saga';
import type { ProviderProfile } from '$shared/provider-profiles';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    providers: {
      listProfiles: mocks.list,
      createProfile: mocks.create,
      updateProfile: mocks.update,
      deleteProfile: vi.fn(),
      reorderProfiles: vi.fn(),
      updateDefault: vi.fn(),
      catalog: vi.fn(),
    },
  },
}));
vi.mock('$features/providers/provider-auth-status.client', () => ({
  getProviderAuthVerdicts: vi.fn(async () => ({})),
  invalidateProviderAuthStatus: vi.fn(),
}));
vi.mock('$features/providers/provider-test-prompt.client', () => ({
  runProviderTestPrompt: vi.fn(),
}));

import {
  initialState,
  providerProfileFolderSetupRequested,
  providerProfileSavedFolderSignInRequested,
  providerProfileSecretEditRequested,
  providerProfileSecretRetryRequested,
  providerProfileSecretSetupRequested,
  providerProfileSetupDismissed,
  providerProfileSignInRetryRequested,
  providerProfilesLoaded,
  providerSettingsReducer,
  providerSettingsSessionOpened,
} from '../provider-settings-slice';
import {
  initialState as catalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '../../provider-catalog/provider-catalog-slice';
import {
  closeTerminalOverlay,
  openTerminalOverlay,
  terminalsReducer,
} from '../../terminals/terminals-slice';
import {
  selectProviderProfileMutations,
  selectProviderProfileSetups,
  selectProviderProfileStatusMap,
} from '../provider-settings-selectors';
import { providerProfilesSaga } from './provider-profiles-saga';
import {
  chooseProfileFolder,
  providerProfileSetupSaga,
  SIGN_IN_POLL_MS,
  SIGN_IN_TIMEOUT_MS,
  type ProviderProfileSetupDeps,
} from './provider-profile-setup-saga';

const row = (id: string) => ({
  id,
  displayName: id,
  shortName: id,
  command: id,
  canBeDisabled: true,
  visible: true,
  supportsProfiles: true,
});

function savedProfile(
  id: string,
  base: 'claude-code' | 'codex',
  env: ProviderProfile['env'],
): ProviderProfile {
  return {
    id,
    providerRef: `${base}@${id}`,
    baseProviderId: base,
    name: 'Work',
    env,
    settingsFingerprint: `fp-${id}`,
    createdAt: '2026-10-30T10:00:00Z',
    updatedAt: '2026-10-30T10:00:00Z',
  };
}

/** Records every dep call (and create/update requests) in one ordered log. */
function harness({ appOwned = true, deps = {} as Partial<ProviderProfileSetupDeps> } = {}) {
  const log: unknown[][] = [];
  let clock = 0;
  const fullDeps: ProviderProfileSetupDeps = {
    listDirectory: vi.fn(async (path: string) => {
      log.push(['listDirectory', path]);
      return [];
    }),
    createDirectory: vi.fn(async (path: string) => {
      log.push(['createDirectory', path]);
      return path.replace('~', '/home/me');
    }),
    openTerminal: vi.fn(async (command: string, env: Record<string, string>) => {
      log.push(['openTerminal', command, env]);
      return 'term-1';
    }),
    authStatus: vi.fn(async (ref: string) => {
      log.push(['authStatus', ref]);
      return { authenticated: false };
    }),
    testPrompt: vi.fn(async (ref: string) => {
      log.push(['testPrompt', ref]);
      return true;
    }),
    now: () => clock,
    random: () => 0,
    ...deps,
  };
  mocks.create.mockImplementation(async (params: unknown) => {
    log.push(['providers.profiles.create', params]);
    return { profile: created, revision: 2 };
  });
  mocks.update.mockImplementation(async (params: unknown) => {
    log.push(['providers.profiles.update', params]);
    return { profile: created, revision: 3, activation: { envChanged: true } };
  });
  let created = savedProfile('p1', 'claude-code', []);
  let current = {
    providerSettings: providerSettingsReducer(initialState, providerSettingsSessionOpened('s1')),
    providerCatalog: providerCatalogReducer(
      catalogInitialState,
      providerCatalogLoaded({ providers: [row('codex'), row('claude-code')] }),
    ),
    terminals: terminalsReducer(undefined as never, { type: '@@init' } as never),
    daemonHealth: { transport: { mode: appOwned ? 'sidecar-uds' : 'remote-tcp' } },
  };
  const dispatched: { type: string; payload?: unknown }[] = [];
  const channel = stdChannel();
  const dispatch = (action: any) => {
    dispatched.push(action);
    current = {
      ...current,
      providerSettings: providerSettingsReducer(current.providerSettings, action),
      terminals: terminalsReducer(current.terminals, action),
    };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => current }, function* () {
    yield* all([
      call(providerProfilesSaga, { authStatus: async () => undefined }),
      call(providerProfileSetupSaga, fullDeps),
    ]);
  });
  return {
    task,
    dispatch,
    dispatched,
    log,
    deps: fullDeps,
    state: () => current as never,
    current: () => current,
    setCreated: (profile: ProviderProfile) => (created = profile),
    advance: (ms: number) => (clock += ms),
  };
}

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

let task: Task | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  task?.cancel();
  vi.useRealTimers();
});

describe('chooseProfileFolder', () => {
  it('keeps the previewed folder when it is free', () => {
    expect(chooseProfileFolder('claude', 'Work account', 'k3f9', ['other-aaaa'])).toBe(
      '~/intent/profiles/claude/work-account-k3f9',
    );
  });

  it('never reuses an existing folder (case-insensitive), picking another suffix', () => {
    const sequence = [0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99];
    let i = 0;
    const folder = chooseProfileFolder(
      'codex',
      'Work',
      'k3f9',
      ['WORK-K3F9', 'work-aaaa'],
      () => sequence[i++ % sequence.length],
    );
    expect(folder).toBe('~/intent/profiles/codex/work-9999');
  });
});

describe('Different login setup', () => {
  it('lists, creates the profile, creates the folder, opens the terminal with env, then signs in', async () => {
    const h = harness();
    task = h.task;
    const folderProfile = savedProfile('p1', 'claude-code', [
      { key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '~/intent/profiles/claude/work-k3f9' },
    ]);
    h.setCreated(folderProfile);
    (h.deps.authStatus as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async (ref: string) => {
        h.log.push(['authStatus', ref]);
        return { authenticated: false };
      })
      .mockImplementationOnce(async (ref: string) => {
        h.log.push(['authStatus', ref]);
        return { authenticated: true, email: 'work@acme.com' };
      });

    h.dispatch(
      providerProfileFolderSetupRequested({
        setupId: 's1',
        provider: 'claude',
        name: 'Work',
        backup: true,
        suffix: 'k3f9',
      }),
    );
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).s1).toMatchObject({
      phase: 'waiting',
      profileId: 'p1',
      folder: '~/intent/profiles/claude/work-k3f9',
      deviceAuth: false,
    });
    expect(h.dispatched.map((a) => a.type)).toContain(openTerminalOverlay.type);

    await vi.advanceTimersByTimeAsync(SIGN_IN_POLL_MS);
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(SIGN_IN_POLL_MS);
    await settle();

    expect(h.log).toEqual([
      ['listDirectory', '~/intent/profiles/claude'],
      [
        'providers.profiles.create',
        {
          baseProviderId: 'claude-code',
          name: 'Work',
          backup: true,
          env: [
            { key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '~/intent/profiles/claude/work-k3f9' },
            { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
            { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
            { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
          ],
        },
      ],
      ['createDirectory', '~/intent/profiles/claude/work-k3f9'],
      [
        'openTerminal',
        'claude auth login',
        { CLAUDE_CONFIG_DIR: '/home/me/intent/profiles/claude/work-k3f9' },
      ],
      ['authStatus', 'claude-code@p1'],
      ['authStatus', 'claude-code@p1'],
    ]);
    expect(selectProviderProfileSetups.select(h.state()).s1).toMatchObject({
      phase: 'signedIn',
      email: 'work@acme.com',
    });
    expect(selectProviderProfileStatusMap.select(h.state()).p1).toBe('ready');
    // The terminal panel still showed the sign-in terminal, so it hides.
    expect(h.dispatched.map((a) => a.type)).toContain(closeTerminalOverlay.type);
    // The create outcome is recorded on the setup, not left in mutations.
    expect(selectProviderProfileMutations.select(h.state()).s1).toBeUndefined();
  });

  it('uses another suffix when the previewed folder already exists', async () => {
    const h = harness({
      deps: {
        listDirectory: vi.fn(async () => ['work-k3f9']),
      },
    });
    task = h.task;
    h.dispatch(
      providerProfileFolderSetupRequested({
        setupId: 's1',
        provider: 'codex',
        name: 'Work',
        backup: false,
        suffix: 'k3f9',
      }),
    );
    await settle();
    const params = mocks.create.mock.calls[0][0];
    expect(params.env[0]).toEqual({
      key: 'CODEX_HOME',
      kind: 'set',
      value: '~/intent/profiles/codex/work-aaaa',
    });
    expect(params).not.toHaveProperty('backup');
    expect(selectProviderProfileSetups.select(h.state()).s1.folder).toBe(
      '~/intent/profiles/codex/work-aaaa',
    );
  });

  it('runs codex login locally and codex login --device-auth on any other daemon', async () => {
    for (const [appOwned, command] of [
      [true, 'codex login'],
      [false, 'codex login --device-auth'],
    ] as const) {
      const h = harness({ appOwned });
      task = h.task;
      h.setCreated(savedProfile('p1', 'codex', []));
      h.dispatch(
        providerProfileFolderSetupRequested({
          setupId: 's1',
          provider: 'codex',
          name: 'Work',
          backup: false,
          suffix: 'k3f9',
        }),
      );
      await settle();
      const terminal = h.log.find(([step]) => step === 'openTerminal');
      expect(terminal).toEqual([
        'openTerminal',
        command,
        { CODEX_HOME: '/home/me/intent/profiles/codex/work-k3f9' },
      ]);
      // The folder never rides inside the command string.
      expect(terminal![1]).not.toContain('CODEX_HOME');
      expect(selectProviderProfileSetups.select(h.state()).s1.deviceAuth).toBe(!appOwned);
      task.cancel();
    }
  });

  it('offers "Still waiting?" after 10 minutes and Try again reopens the same folder', async () => {
    const h = harness();
    task = h.task;
    h.dispatch(
      providerProfileFolderSetupRequested({
        setupId: 's1',
        provider: 'claude',
        name: 'Work',
        backup: false,
        suffix: 'k3f9',
      }),
    );
    await settle();
    h.advance(SIGN_IN_TIMEOUT_MS - 1);
    await vi.advanceTimersByTimeAsync(SIGN_IN_POLL_MS);
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('waiting');
    h.advance(1);
    await vi.advanceTimersByTimeAsync(SIGN_IN_POLL_MS);
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('stillWaiting');
    const polls = h.log.filter(([step]) => step === 'authStatus').length;
    await vi.advanceTimersByTimeAsync(SIGN_IN_POLL_MS * 4);
    expect(h.log.filter(([step]) => step === 'authStatus')).toHaveLength(polls);

    h.dispatch(providerProfileSignInRetryRequested('s1'));
    await settle();
    expect(h.log.filter(([step]) => step === 'listDirectory')).toHaveLength(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(h.log.filter(([step]) => step === 'createDirectory')).toEqual([
      ['createDirectory', '~/intent/profiles/claude/work-k3f9'],
      ['createDirectory', '~/intent/profiles/claude/work-k3f9'],
    ]);
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('waiting');
  });

  it('a rejected save creates no folder and records the failure', async () => {
    const h = harness();
    task = h.task;
    mocks.create.mockRejectedValueOnce({
      data: {
        code: 'invalid-params',
        fieldErrors: [{ field: 'name', code: 'duplicate', message: 'taken' }],
      },
    });
    h.dispatch(
      providerProfileFolderSetupRequested({
        setupId: 's1',
        provider: 'claude',
        name: 'Work',
        backup: false,
        suffix: 'k3f9',
      }),
    );
    await settle();
    expect(h.deps.createDirectory).not.toHaveBeenCalled();
    expect(h.deps.openTerminal).not.toHaveBeenCalled();
    expect(selectProviderProfileSetups.select(h.state()).s1).toMatchObject({
      phase: 'failed',
      failure: { kind: 'saveFailed', failure: { kind: 'fieldErrors' } },
    });
  });

  it('reports folder and terminal failures with the profile still saved', async () => {
    const h = harness({
      deps: {
        createDirectory: vi.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    task = h.task;
    h.dispatch(
      providerProfileFolderSetupRequested({
        setupId: 's1',
        provider: 'claude',
        name: 'Work',
        backup: false,
        suffix: 'k3f9',
      }),
    );
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).s1).toMatchObject({
      phase: 'failed',
      profileId: 'p1',
      failure: { kind: 'folderFailed', path: '~/intent/profiles/claude/work-k3f9' },
    });
    expect(h.deps.openTerminal).not.toHaveBeenCalled();

    (h.deps.createDirectory as ReturnType<typeof vi.fn>).mockResolvedValue('/home/me/x');
    (h.deps.openTerminal as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no pty'));
    h.dispatch(providerProfileSignInRetryRequested('s1'));
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).s1).toMatchObject({
      phase: 'failed',
      failure: { kind: 'terminalFailed' },
    });
  });

  it('dismissing the setup stops the sign-in wait', async () => {
    const h = harness();
    task = h.task;
    h.dispatch(
      providerProfileFolderSetupRequested({
        setupId: 's1',
        provider: 'claude',
        name: 'Work',
        backup: false,
        suffix: 'k3f9',
      }),
    );
    await settle();
    h.dispatch(providerProfileSetupDismissed('s1'));
    await vi.advanceTimersByTimeAsync(SIGN_IN_POLL_MS * 3);
    expect(h.deps.authStatus).not.toHaveBeenCalled();
    expect(selectProviderProfileSetups.select(h.state()).s1).toBeUndefined();
  });
});

describe('API key / Token setup', () => {
  const claudeKeyEnv = [
    { key: 'ANTHROPIC_API_KEY', kind: 'set' as const, value: 'sk-ant-secret' },
    { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' as const },
    { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' as const },
  ];

  it('creates with the kind payload, then runs the test prompt (Key works)', async () => {
    const h = harness();
    task = h.task;
    h.dispatch(
      providerProfileSecretSetupRequested({
        setupId: 's1',
        baseProviderId: 'claude-code',
        name: 'Key',
        backup: false,
        env: claudeKeyEnv,
      }),
    );
    await settle();
    expect(h.log).toEqual([
      [
        'providers.profiles.create',
        { baseProviderId: 'claude-code', name: 'Key', env: claudeKeyEnv },
      ],
      ['testPrompt', 'claude-code@p1'],
    ]);
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('keyWorks');
    // The secret never rode on an action or entered state.
    expect(JSON.stringify(h.dispatched)).not.toContain('sk-ant-secret');
    expect(JSON.stringify(h.current().providerSettings)).not.toContain('sk-ant-secret');
  });

  it('shows Key was rejected, then saves a replacement and checks again', async () => {
    const h = harness({
      deps: { testPrompt: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) },
    });
    task = h.task;
    h.dispatch(
      providerProfileSecretSetupRequested({
        setupId: 's1',
        baseProviderId: 'claude-code',
        name: 'Key',
        backup: false,
        env: claudeKeyEnv,
      }),
    );
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('keyRejected');

    const replacement = [{ key: 'ANTHROPIC_API_KEY', kind: 'set' as const, value: 'sk-new' }];
    h.dispatch(providerProfileSecretRetryRequested({ setupId: 's1', env: replacement }));
    await settle();
    expect(mocks.update).toHaveBeenCalledWith({ profileId: 'p1', env: replacement });
    expect(h.deps.testPrompt).toHaveBeenCalledTimes(2);
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('keyWorks');
    expect(JSON.stringify(h.dispatched)).not.toContain('sk-new');
  });

  it('a test prompt that throws reads as Key was rejected', async () => {
    const h = harness({ deps: { testPrompt: vi.fn().mockRejectedValue(new Error('gone')) } });
    task = h.task;
    h.dispatch(
      providerProfileSecretSetupRequested({
        setupId: 's1',
        baseProviderId: 'codex',
        name: 'Token',
        backup: true,
        env: [{ key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: 'a.b.c' }],
      }),
    );
    await settle();
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ backup: true });
    expect(selectProviderProfileSetups.select(h.state()).s1.phase).toBe('keyRejected');
  });
});

describe('Edit: replaced key and saved-folder sign-in', () => {
  it('saves a replaced key with name/backup, then runs the key check', async () => {
    const h = harness({ deps: { testPrompt: vi.fn().mockResolvedValueOnce(false) } });
    task = h.task;
    const env = [
      { key: 'ANTHROPIC_API_KEY', kind: 'set' as const, value: 'sk-replaced' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' as const },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' as const },
    ];
    h.dispatch(
      providerProfileSecretEditRequested({
        setupId: 'e1',
        profileId: 'p1',
        name: 'Renamed',
        backup: true,
        env,
      }),
    );
    await settle();
    expect(mocks.update).toHaveBeenCalledWith({
      profileId: 'p1',
      name: 'Renamed',
      backup: true,
      env,
    });
    expect(h.deps.testPrompt).toHaveBeenCalledWith('claude-code@p1');
    expect(selectProviderProfileSetups.select(h.state()).e1).toMatchObject({
      phase: 'keyRejected',
      profileId: 'p1',
    });
    expect(JSON.stringify(h.dispatched)).not.toContain('sk-replaced');
    expect(selectProviderProfileMutations.select(h.state()).e1).toBeUndefined();
  });

  it('a rejected edit save records the failure and runs no key check', async () => {
    const h = harness();
    task = h.task;
    mocks.update.mockRejectedValueOnce({
      data: {
        code: 'invalid-params',
        fieldErrors: [{ field: 'name', code: 'duplicate', message: 'taken' }],
      },
    });
    h.dispatch(
      providerProfileSecretEditRequested({
        setupId: 'e1',
        profileId: 'p1',
        env: [{ key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: 'a.b.c' }],
      }),
    );
    await settle();
    expect(selectProviderProfileSetups.select(h.state()).e1).toMatchObject({
      phase: 'failed',
      failure: { kind: 'saveFailed' },
    });
    expect(h.deps.testPrompt).not.toHaveBeenCalled();
  });

  it('signs in to the folder saved on the profile (never a new one)', async () => {
    const h = harness({ appOwned: false });
    task = h.task;
    h.dispatch(
      providerProfilesLoaded(
        [savedProfile('p9', 'codex', [{ key: 'CODEX_HOME', kind: 'set', value: '~/.codex-work' }])],
        1,
      ),
    );
    h.dispatch(providerProfileSavedFolderSignInRequested({ setupId: 'e1', profileId: 'p9' }));
    await settle();
    expect(h.log).toEqual([
      ['createDirectory', '~/.codex-work'],
      ['openTerminal', 'codex login --device-auth', { CODEX_HOME: '/home/me/.codex-work' }],
    ]);
    expect(h.deps.listDirectory).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(selectProviderProfileSetups.select(h.state()).e1).toMatchObject({
      phase: 'waiting',
      profileId: 'p9',
      folder: '~/.codex-work',
      deviceAuth: true,
    });
  });

  it('a masked folder (older daemon) fails without opening a terminal', async () => {
    const h = harness();
    task = h.task;
    h.dispatch(
      providerProfilesLoaded(
        [
          savedProfile('p9', 'claude-code', [
            { key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '********' },
          ]),
        ],
        1,
      ),
    );
    h.dispatch(providerProfileSavedFolderSignInRequested({ setupId: 'e1', profileId: 'p9' }));
    await settle();
    expect(h.log).toEqual([]);
    expect(selectProviderProfileSetups.select(h.state()).e1.phase).toBe('failed');
  });
});
