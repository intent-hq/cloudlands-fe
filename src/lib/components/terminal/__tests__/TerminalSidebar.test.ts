import {
  render,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/svelte';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const {
  mockDetect,
  mockExecute,
  mockDispatch,
  mockScriptCreate,
  mockScriptUpdate,
  mockScriptRemove,
  backgroundAgentOptions,
  scriptEntries,
  activeWorkspaceState,
  toast,
} = vi.hoisted(() => {
  const mockDetect = vi.fn();
  const mockExecute = vi.fn();
  const mockDispatch = vi.fn();
  return {
    mockDetect,
    mockExecute,
    mockDispatch,
    mockScriptCreate: vi.fn(),
    mockScriptUpdate: vi.fn(),
    mockScriptRemove: vi.fn(),
    backgroundAgentOptions: {
      value: null as { onResult: (result: string) => Promise<void> } | null,
    },
    scriptEntries: {
      value: [] as any[],
    },
    activeWorkspaceState: {
      value: { id: 'ws-1', path: '/repo' } as any,
    },
    toast: {
      success: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    },
  };
});

vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: {
    detect: mockDetect,
    create: mockScriptCreate,
    update: mockScriptUpdate,
    remove: mockScriptRemove,
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    saveToRepo: vi.fn(),
  },
}));

vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => ({
  selectScriptEntries: Object.assign(
    () => ({
      subscribe: (fn: (value: any) => void) => {
        fn(scriptEntries.value);
        return () => { };
      },
    }),
    { select: () => scriptEntries.value },
  ),
}));
vi.mock('$store/renderer/slices/scripts/scripts-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/scripts/scripts-slice')>()),
  refreshScripts: vi.fn((...args: any[]) => ({ type: 'scripts/refreshScripts', payload: args })),
  removeScript: vi.fn((...args: any[]) => ({ type: 'scripts/removeScript', payload: args })),
  upsertScript: vi.fn((...args: any[]) => ({ type: 'scripts/upsertScript', payload: args })),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({
      scripts: {
        byWorkspaceId: {
          'ws-1': {
            scripts: {},
            outputBuffers: {},
            initialized: true,
            loading: false,
          },
        },
      },
      workspace: { activeWorkspaceId: 'ws-1' },
    }),
    dispatch: mockDispatch,
  });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: () => ({
    subscribe: (fn: (value: any) => void) => {
      fn(activeWorkspaceState.value);
      return () => { };
    },
  }),
}));
vi.mock('$store/renderers/terminal-overlay.store.svelte', () => ({
  terminalsStore: { terminals: [], activeTerminalId: null },
}));
vi.mock('$lib/components/ui/toast', () => ({ toast }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('$lib/hooks/use-background-agent.svelte', () => ({
  useBackgroundAgent: (_name: string, options: any) => {
    backgroundAgentOptions.value = options;
    return {
      execute: mockExecute,
      cancel: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

vi.mock('$store/renderer/slices/background-agent-executor/background-agent-executor-selectors', () => ({
  selectExecutorIsRunning: Object.assign(
    () => ({ subscribe: (fn: any) => { fn(false); return () => { }; } }),
    { select: () => false },
  ),
  selectExecutorAgentId: Object.assign(
    () => ({ subscribe: (fn: any) => { fn(null); return () => { }; } }),
    { select: () => null },
  ),
}));
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectTerminals: () => ({ subscribe: (fn: any) => { fn([]); return () => { }; } }),
  selectUserTerminals: () => ({ subscribe: (fn: any) => { fn([]); return () => { }; } }),
  selectActiveTerminalId: () => ({ subscribe: (fn: any) => { fn(null); return () => { }; } }),
}));
vi.mock('$store/renderer/slices/terminals/terminals-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/terminals/terminals-slice')>()),
  removeTerminal: vi.fn(),
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatarWithState.svelte', async () => {
  const MockSimple = (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { default: MockSimple };
});

vi.mock('$lib/components/ui/skeleton', async () => {
  const MockSimple = (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { Skeleton: MockSimple };
});

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const MockButton = (await import('./mocks/MockButton.svelte')).default;
  return { default: MockButton };
});

import TerminalSidebar from '../TerminalSidebar.svelte';

describe('TerminalSidebar detection flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scriptEntries.value = [];
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
  });

  it('runs local detection first and shows scanning copy without starting the agent', async () => {
    // When scripts exist, the scan icon button triggers local detection
    scriptEntries.value = [
      {
        id: 'existing-1',
        name: 'build',
        command: 'npm run build',
        mode: 'command',
        category: 'build',
        source: 'user',
        runtime: { status: 'idle', exitCode: null },
      },
    ] as any[];

    let resolveDetect: (() => void) | undefined;
    mockDetect.mockReturnValue(
      new Promise((resolve) => {
        resolveDetect = () => resolve({ success: true, detected: 0 });
      }),
    );
    // mockDetect already configured via mockReturnValue above

    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByTitle('Scan local project files for scripts'));

    await waitFor(() => expect(mockDetect).toHaveBeenCalledWith('ws-1'));
    expect(mockExecute).not.toHaveBeenCalled();
    expect(screen.getByText('Scanning files…')).toBeTruthy();

    resolveDetect?.();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
  });

  it('offers manual agent-assisted detection after local detection finds no scripts', async () => {
    // When scripts exist and local detection finds nothing, agent assist is offered
    scriptEntries.value = [
      {
        id: 'existing-1',
        name: 'build',
        command: 'npm run build',
        mode: 'command',
        category: 'build',
        source: 'user',
        runtime: { status: 'idle', exitCode: null },
      },
    ] as any[];

    mockDetect.mockResolvedValue({ success: true, detected: 0 });

    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByTitle('Scan local project files for scripts'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /agent assist/i })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole('button', { name: /agent assist/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        activeWorkspaceState.value,
        expect.objectContaining({ message: expect.stringContaining('Read package.json') }),
      );
    });
  });

  it('keeps agent-assisted detection visible after a no-results local scan when user scripts already exist', async () => {
    scriptEntries.value = [
      {
        id: 'user-1',
        name: 'dev',
        command: 'npm run dev',
        mode: 'service',
        category: 'dev',
        source: 'user',
        runtime: { status: 'idle', exitCode: null },
      },
    ] as any[];

    mockDetect.mockResolvedValue({ success: true, detected: 0 });

    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByTitle('Scan local project files for scripts'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /agent assist/i })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole('button', { name: /agent assist/i }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        activeWorkspaceState.value,
        expect.objectContaining({ message: expect.stringContaining('Read package.json') }),
      );
    });
  });
});

describe('TerminalSidebar agent detection result handling (running-script guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
    // §5.8 script.list shape: camelCase definition + merged runtime block.
    scriptEntries.value = [
      {
        id: 'auto-running',
        name: 'dev',
        command: 'pnpm dev',
        mode: 'service',
        category: 'dev',
        source: 'auto-detected',
        runtime: { status: 'running', pid: 4242, restartCount: 0 },
      },
      {
        id: 'auto-idle',
        name: 'build',
        command: 'pnpm build',
        mode: 'command',
        category: 'build',
        source: 'auto-detected',
        runtime: { status: 'idle', exitCode: null },
      },
      {
        id: 'auto-stale',
        name: 'stale',
        command: 'pnpm stale',
        mode: 'command',
        category: 'other',
        source: 'auto-detected',
        runtime: { status: 'idle', exitCode: null },
      },
    ] as any[];
    mockScriptUpdate.mockResolvedValue({ success: true });
    mockScriptCreate.mockResolvedValue({
      success: true,
      data: { id: 'auto-lint', name: 'lint', command: 'pnpm lint', mode: 'command' },
    });
    mockScriptRemove.mockResolvedValue({ success: true });
  });

  it('skips the running script in the update loop, surfaces the skipped-running toast, and still applies other entries', async () => {
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    // The daemon-side scriptId upsert tears down the live PTY group, so the
    // update entry targeting the running auto-detected script must not upsert.
    await backgroundAgentOptions.value!.onResult(
      JSON.stringify({
        add: [{ name: 'lint', command: 'pnpm lint', mode: 'command', category: 'lint' }],
        update: [
          { id: 'auto-running', command: 'pnpm dev --host' },
          { id: 'auto-idle', command: 'pnpm build --clean' },
        ],
        remove: ['auto-stale'],
      }),
    );

    expect(mockScriptUpdate).toHaveBeenCalledTimes(1);
    expect(mockScriptUpdate).toHaveBeenCalledWith('ws-1', 'auto-idle', {
      command: 'pnpm build --clean',
    });
    expect(mockScriptCreate).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ name: 'lint', command: 'pnpm lint', mode: 'command' }),
    );
    expect(mockScriptRemove).toHaveBeenCalledWith('ws-1', 'auto-stale');
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('"dev"'));
    expect(toast.success).toHaveBeenCalled();
  });
});


describe('TerminalSidebar context menu Escape handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scriptEntries.value = [
      {
        id: 'script-1',
        name: 'build',
        command: 'npm run build',
        mode: 'command',
        category: 'build',
        source: 'user',
        runtime: { status: 'idle', exitCode: null },
      },
    ] as any[];
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
  });

  function pressEscape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event;
  }

  it('closes the context menu on Escape via the escape-layer stack', async () => {
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.contextMenu(screen.getByText('build'));
    await waitFor(() => expect(screen.getByText('Edit')).toBeTruthy());

    const event = pressEscape();

    await waitFor(() => expect(screen.queryByText('Edit')).toBeNull());
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not consume Escape while the context menu is closed', async () => {
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    const event = pressEscape();

    expect(event.defaultPrevented).toBe(false);
  });
});