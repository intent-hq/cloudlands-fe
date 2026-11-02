/**
 * Main/renderer path parity for the terminal channels (cloudlands-fe#3918).
 *
 * Each scenario sends the same params through the main-process handler
 * (`main/terminal.ipc.ts`) and through the renderer path the app actually
 * uses — the real `$lib/electron-bridge` `invoke` → mock IPC router →
 * `terminals-scripts-seeder` → live terminals client — and asserts the daemon
 * `terminal.create` / `terminal.write` requests match. Only the two daemon
 * transports are faked.
 */
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  mainRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClientForId: () => ({ request: mocks.mainRequest, on: vi.fn() }),
  getBackendIdForIpcSender: () => 'local',
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$features/workspace/main/workspace-path.service', () => ({
  getWorkspacePathInfo: vi.fn(async () => null),
  isWorkspacePathDeterministicallyNull: vi.fn(() => true),
}));

// test-setup stubs the bridge globally; parity needs the real invoke hop.
vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn().mockResolvedValue({ subscriptionId: 'terminal-subscription' }),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { TERMINAL_CHANNELS } from '$shared/ipc/channels';
import {
  TerminalCreateWithCommandSchema,
  TerminalProfessionalWriteSchema,
} from '../../main/ipc-schemas';
import '$store/renderer/seeders/terminals-scripts-seeder';
import {
  contractCalls,
  describeParity,
  expectSameDaemonRequests,
  expectSchemaKeysCovered,
  type DaemonCall,
} from '../../test/ipc-path-parity';
import { registerTerminalHandlers } from './main/terminal.ipc';

const CONTRACT_METHODS = ['terminal.create', 'terminal.write'] as const;
const WS = 'ws-parity';
const CWD = os.tmpdir();

async function daemon(method: string): Promise<unknown> {
  switch (method) {
    case 'terminal.create':
      return { terminalId: 'daemon-pty-1' };
    case 'events.subscribe':
      return { subscriptionId: 'sub-1' };
    default:
      return {};
  }
}

/** One step: a channel and its params, optionally built from the previous step's result. */
interface Step {
  channel: string;
  params:
    Record<string, unknown> | ((previous: { terminalId?: string }) => Record<string, unknown>);
}

function paramsFor(step: Step, previous: unknown): Record<string, unknown> {
  return typeof step.params === 'function'
    ? step.params((previous ?? {}) as { terminalId?: string })
    : step.params;
}

/** Run the steps through the main-process handlers; return the daemon requests. */
async function runMain(steps: Step[]): Promise<DaemonCall[]> {
  mocks.handlers.clear();
  registerTerminalHandlers();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    let previous: unknown;
    for (const step of steps) {
      const handler = mocks.handlers.get(step.channel);
      if (!handler) throw new Error(`main registered no handler for ${step.channel}`);
      previous = await handler({ sender: { id: 1 } }, paramsFor(step, previous));
      // The main path types the initial command after a prompt delay.
      await vi.runAllTimersAsync();
    }
  } finally {
    vi.useRealTimers();
  }
  return contractCalls(mocks.mainRequest.mock.calls, CONTRACT_METHODS);
}

/** Run the steps through the real renderer bridge; return the daemon requests. */
async function runRenderer(steps: Step[]): Promise<DaemonCall[]> {
  let previous: unknown;
  for (const step of steps) {
    previous = await invoke(step.channel, paramsFor(step, previous));
  }
  return contractCalls(vi.mocked(backendRequest).mock.calls, CONTRACT_METHODS);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mainRequest.mockImplementation(daemon);
  vi.mocked(backendRequest).mockImplementation(daemon as typeof backendRequest);
});

afterEach(() => {
  vi.useRealTimers();
});

const ENV = { CLAUDE_CONFIG_DIR: '/profiles/work/claude', CODEX_HOME: '/profiles/work/codex' };

const CREATE_SCENARIOS: Record<string, Record<string, unknown>> = {
  'interactive login with a profile env (the #3918 regression)': {
    workspaceId: WS,
    command: 'claude auth login',
    cwd: CWD,
    env: ENV,
    interactive: true,
    title: 'Sign in',
  },
  'paste-only install command': {
    workspaceId: WS,
    command: 'npm install -g @openai/codex',
    cwd: CWD,
    pasteOnly: true,
  },
};

describeParity(TERMINAL_CHANNELS.CREATE_WITH_COMMAND, () => {
  it.each(Object.entries(CREATE_SCENARIOS))('%s', async (_name, params) => {
    const steps = [{ channel: TERMINAL_CHANNELS.CREATE_WITH_COMMAND, params }];
    const main = await runMain(steps);
    const renderer = await runRenderer(steps);
    expectSameDaemonRequests(TERMINAL_CHANNELS.CREATE_WITH_COMMAND, main, renderer);
  });

  it('scenarios set every field the main-process schema accepts', () => {
    expectSchemaKeysCovered(
      TERMINAL_CHANNELS.CREATE_WITH_COMMAND,
      TerminalCreateWithCommandSchema,
      Object.values(CREATE_SCENARIOS),
    );
  });

  // Known, intentional divergences. Each asserts the paths still DIFFER, so a
  // change that brings them together fails here and should move the case into
  // CREATE_SCENARIOS instead.
  it.each([
    [
      'a non-interactive command: main types it into a login shell, the renderer runs it as the PTY command',
      { workspaceId: WS, command: 'true', cwd: CWD },
    ],
    [
      'no cwd: main resolves a local directory, the renderer lets the daemon resolve it',
      { workspaceId: '__root__', command: 'claude auth login', interactive: true },
    ],
  ])('known divergence — %s', async (_name, params) => {
    const steps = [{ channel: TERMINAL_CHANNELS.CREATE_WITH_COMMAND, params }];
    const main = await runMain(steps);
    const renderer = await runRenderer(steps);
    expect(renderer).not.toEqual(main);
  });
});

describeParity(TERMINAL_CHANNELS.PROFESSIONAL_WRITE, () => {
  const create: Step = {
    channel: TERMINAL_CHANNELS.CREATE_WITH_COMMAND,
    params: { workspaceId: WS, command: 'bash', cwd: CWD, interactive: true },
  };
  const write: Step = {
    channel: TERMINAL_CHANNELS.PROFESSIONAL_WRITE,
    params: ({ terminalId }) => ({ terminalId, workspaceId: WS, data: 'ls -la\r' }),
  };

  it('writes to a terminal created on the same path', async () => {
    const main = await runMain([create, write]);
    const renderer = await runRenderer([create, write]);
    expectSameDaemonRequests(TERMINAL_CHANNELS.PROFESSIONAL_WRITE, main, renderer);
  });

  it('scenarios set every field the main-process schema accepts', () => {
    expectSchemaKeysCovered(TERMINAL_CHANNELS.PROFESSIONAL_WRITE, TerminalProfessionalWriteSchema, [
      { terminalId: 't', workspaceId: WS, data: 'ls -la\r' },
    ]);
  });
});
