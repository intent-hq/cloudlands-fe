import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, data: unknown) => Promise<unknown>>();
  const shells: Array<{
    connectionId: string;
    close: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    isAlive: ReturnType<typeof vi.fn>;
    options: any;
  }> = [];

  return {
    handlers,
    shells,
    ipcHandle: vi.fn((channel: string, handler: (event: unknown, data: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    openInteractiveShell: vi.fn(async (connectionId: string, options: any) => {
      const shell = {
        connectionId,
        close: vi.fn(),
        resize: vi.fn(),
        write: vi.fn(),
        isAlive: vi.fn(() => true),
        options,
      };
      shells.push(shell);
      return shell;
    }),
    getWorkspace: vi.fn(),
    mainDispatch: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.ipcHandle,
  },
}));

vi.mock('../MainProcessTerminalManager', () => ({
  TerminalManager: class {
    getTerminal = vi.fn(() => null);
    getWorkspaceTerminals = vi.fn(() => []);
    disposeTerminal = vi.fn().mockResolvedValue(undefined);
    disposeAll = vi.fn().mockResolvedValue(undefined);
    disposeAllSync = vi.fn();
    createTerminal = vi.fn();
  },
}));

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: mocks.mainDispatch,
}));

vi.mock('../../../store/main/slices/terminal-events/terminal-events-slice', () => ({
  terminalProfessionalData: vi.fn((payload) => ({ type: 'data', payload })),
  terminalProfessionalExit: vi.fn((payload) => ({ type: 'exit', payload })),
  terminalProfessionalCommandStart: vi.fn((payload) => ({ type: 'command:start', payload })),
  terminalProfessionalCommandExecuted: vi.fn((payload) => ({ type: 'command:executed', payload })),
  terminalProfessionalCommandFinished: vi.fn((payload) => ({ type: 'command:finished', payload })),
  terminalProfessionalCwdChanged: vi.fn((payload) => ({ type: 'cwd:changed', payload })),
  terminalDisposed: vi.fn((payload) => ({ type: 'disposed', payload })),
  terminalCreated: vi.fn((payload) => ({ type: 'created', payload })),
}));

vi.mock('$shared/main/ssh-manager', () => ({
  sshManager: {
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    openInteractiveShell: mocks.openInteractiveShell,
    executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  },
}));

vi.mock('$features/workspace/main/workspace.service', () => ({
  workspaceService: {
    getWorkspace: mocks.getWorkspace,
  },
}));

vi.mock('../../../main/ipc-validation-middleware', () => ({
  createSafeValidatedHandler: (_schema: unknown, handler: (event: unknown, validated: any) => Promise<unknown>) =>
    async (event: unknown, data: unknown) => handler(event, data),
}));

vi.mock('../../../shared/logger', () => ({
  Logger: class {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

function remoteWorkspace(workspaceId: string) {
  return {
    ok: true,
    data: {
      id: workspaceId,
      isRemote: true,
      worktreePath: `/remote/${workspaceId}`,
      environmentConfig: {
        ssh: {
          host: 'host.example',
          user: 'dev',
          port: 22,
        },
      },
    },
  };
}

async function loadTerminalIpc() {
  vi.resetModules();
  mocks.handlers.clear();
  mocks.shells.length = 0;
  mocks.getWorkspace.mockImplementation(async (workspaceId: string) => remoteWorkspace(workspaceId));
  const module = await import('../main/terminal.ipc');
  module.registerTerminalHandlers();
  return module;
}

async function createRemoteTerminal(workspaceId: string, terminalId: string) {
  const handler = mocks.handlers.get('terminal:professional:create');
  expect(handler).toBeDefined();
  return handler!({}, { workspaceId, terminalId, cols: 80, rows: 24 });
}

describe('terminal IPC remote cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockImplementation(async (workspaceId: string) => remoteWorkspace(workspaceId));
  });

  it('disconnects the SSH connection when a remote terminal exits', async () => {
    await loadTerminalIpc();
    const result = await createRemoteTerminal('alpha-workspace', 'term-1');
    expect(result).toMatchObject({ success: true });

    mocks.shells[0].options.onExit(0);

    await vi.waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledWith('terminal-alpha-workspace-term-1');
    });
  });

  it('closes and disconnects a remote terminal replaced by the same id from another workspace', async () => {
    await loadTerminalIpc();
    expect(await createRemoteTerminal('alpha-workspace', 'term-1')).toMatchObject({ success: true });
    expect(await createRemoteTerminal('beta-workspace', 'term-1')).toMatchObject({ success: true });

    expect(mocks.shells[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledWith('terminal-alpha-workspace-term-1');
    expect(mocks.connect).toHaveBeenCalledWith('terminal-beta-workspace-term-1', expect.any(Object));
  });

  it('disconnects the SSH connection when a backend-created remote terminal exits', async () => {
    const { createTerminalFromBackend } = await loadTerminalIpc();

    const result = await createTerminalFromBackend({
      workspaceId: 'alpha-workspace' as any,
      cwd: '/remote/alpha-workspace',
    });

    mocks.shells[0].options.onExit(0);

    await vi.waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledWith(`backend-terminal-alpha-workspace-${result.terminalId}`);
    });
  });
});