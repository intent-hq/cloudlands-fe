import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDetect,
  mockExecute,
  mockDispatch,
  mockScriptCreate,
  mockScriptUpdate,
  mockScriptRemove,
  backgroundAgentOptions,
  scriptEntries,
  terminalEntries,
  activeTerminalIds,
  activeWorkspaceState,
  selectorWorkspaceArgs,
  executorState,
  mockGetNavigationContext,
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
      byWorkspaceId: {} as Record<string, any[]>,
    },
    terminalEntries: {
      byWorkspaceId: {} as Record<string, any[]>,
    },
    activeTerminalIds: {
      byWorkspaceId: {} as Record<string, string | null>,
    },
    activeWorkspaceState: {
      value: { id: 'ws-1', path: '/repo' } as any,
      byWorkspaceId: {} as Record<string, any>,
    },
    executorState: { isRunning: false, agentId: null as string | null },
    mockGetNavigationContext: vi.fn(),
    selectorWorkspaceArgs: [] as unknown[],
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
    (workspaceArg: any) => {
      selectorWorkspaceArgs.push(workspaceArg);
      return {
        subscribe: (fn: (value: any) => void) =>
          typeof workspaceArg === 'string'
            ? (fn(scriptEntries.byWorkspaceId[workspaceArg] ?? scriptEntries.value), () => {})
            : workspaceArg.subscribe((workspaceId: string) =>
                fn(scriptEntries.byWorkspaceId[workspaceId] ?? scriptEntries.value),
              ),
      };
    },
    {
      select: (_state: unknown, workspaceId: string) =>
        scriptEntries.byWorkspaceId[workspaceId] ?? scriptEntries.value,
    },
  ),
}));
vi.mock('$store/renderer/slices/scripts/scripts-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/scripts/scripts-slice')>()),
  refreshScripts: vi.fn((...args: any[]) => ({ type: 'scripts/refreshScripts', payload: args })),
  removeScript: vi.fn((...args: any[]) => ({ type: 'scripts/removeScript', payload: args })),
  upsertScript: vi.fn((...args: any[]) => ({ type: 'scripts/upsertScript', payload: args })),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

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
    }),
    dispatch: mockDispatch,
  });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: (workspaceArg: any) => {
    selectorWorkspaceArgs.push(workspaceArg);
    return {
      subscribe: (fn: (value: any) => void) =>
        typeof workspaceArg === 'string'
          ? (fn(activeWorkspaceState.byWorkspaceId[workspaceArg] ?? activeWorkspaceState.value),
            () => {})
          : workspaceArg.subscribe((workspaceId: string) =>
              fn(activeWorkspaceState.byWorkspaceId[workspaceId] ?? activeWorkspaceState.value),
            ),
    };
  },
}));
vi.mock('$store/renderers/terminal-overlay.store.svelte', () => ({
  terminalsStore: { terminals: [], activeTerminalId: null },
}));
vi.mock('$lib/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/components/ui/toast')>()),
  toast,
}));
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

vi.mock(
  '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors',
  () => ({
    selectExecutorIsRunning: Object.assign(
      (workspaceArg: any) => {
        selectorWorkspaceArgs.push(workspaceArg);
        return {
          subscribe: (fn: any) => workspaceArg.subscribe(() => fn(executorState.isRunning)),
        };
      },
      { select: () => executorState.isRunning },
    ),
    selectExecutorAgentId: Object.assign(
      (workspaceArg: any) => {
        selectorWorkspaceArgs.push(workspaceArg);
        return {
          subscribe: (fn: any) => workspaceArg.subscribe(() => fn(executorState.agentId)),
        };
      },
      { select: () => executorState.agentId },
    ),
  }),
);
vi.mock('$lib/components/layout/panel-system/panel-context', () => ({
  getNavigationContext: mockGetNavigationContext,
}));
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectUserTerminals: (workspaceArg: any) => {
    selectorWorkspaceArgs.push(workspaceArg);
    return {
      subscribe: (fn: any) =>
        workspaceArg.subscribe((workspaceId: string) =>
          fn(terminalEntries.byWorkspaceId[workspaceId] ?? []),
        ),
    };
  },
  selectActiveTerminalId: (workspaceArg: any) => {
    selectorWorkspaceArgs.push(workspaceArg);
    return {
      subscribe: (fn: any) =>
        workspaceArg.subscribe((workspaceId: string) =>
          fn(activeTerminalIds.byWorkspaceId[workspaceId] ?? null),
        ),
    };
  },
}));
vi.mock('$store/renderer/slices/terminals/terminals-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/terminals/terminals-slice')>()),
  removeTerminal: vi.fn(),
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => {
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
import { warmImport } from '../../../../test/warm-import';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('./mocks/MockButton.svelte'));

beforeEach(() => {
  Element.prototype.getAnimations = () => [];
  scriptEntries.byWorkspaceId = {};
  terminalEntries.byWorkspaceId = {};
  activeTerminalIds.byWorkspaceId = {};
  activeWorkspaceState.byWorkspaceId = {};
  executorState.isRunning = false;
  executorState.agentId = null;
  mockGetNavigationContext.mockReset();
  selectorWorkspaceArgs.length = 0;
});

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

describe('TerminalSidebar workspace prop changes', () => {
  it('renders and mutates the rerendered workspace instead of the initial workspace', async () => {
    scriptEntries.byWorkspaceId = {
      'ws-a': [
        {
          id: 'script-a',
          name: 'Script A',
          command: 'pnpm a',
          mode: 'command',
          source: 'user',
          runtime: { status: 'idle', exitCode: null },
        },
      ],
      'ws-b': [
        {
          id: 'script-b',
          name: 'Script B',
          command: 'pnpm b',
          mode: 'command',
          source: 'user',
          runtime: { status: 'idle', exitCode: null },
        },
      ],
    };
    terminalEntries.byWorkspaceId = {
      'ws-a': [{ id: 'terminal-a', name: 'Terminal A' }],
      'ws-b': [{ id: 'terminal-b', name: 'Terminal B' }],
    };
    activeWorkspaceState.byWorkspaceId = {
      'ws-a': { id: 'ws-a', path: '/repo/a' },
      'ws-b': { id: 'ws-b', path: '/repo/b' },
    };

    const { rerender } = render(TerminalSidebar, { props: { workspaceId: 'ws-a' } });
    expect(screen.getByText('Script A')).toBeTruthy();
    expect(screen.getByText('Terminal A')).toBeTruthy();

    await rerender({ workspaceId: 'ws-b' });

    await waitFor(() => {
      expect(screen.getByText('Script B')).toBeTruthy();
      expect(screen.getByText('Terminal B')).toBeTruthy();
    });
    expect(screen.queryByText('Script A')).toBeNull();
    expect(screen.queryByText('Terminal A')).toBeNull();
    expect(selectorWorkspaceArgs).toHaveLength(6);
    expect(selectorWorkspaceArgs.every((arg: any) => typeof arg?.subscribe === 'function')).toBe(
      true,
    );

    await fireEvent.contextMenu(screen.getByText('Script B'));
    await fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => expect(mockScriptRemove).toHaveBeenCalledWith('ws-b', 'script-b'));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'scripts/removeScript',
      payload: ['ws-b', 'script-b'],
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

describe('TerminalSidebar script inline rename', () => {
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
    mockScriptUpdate.mockResolvedValue({ success: true });
  });

  it('shows a prefilled rename input on double-click and restores the row on Escape', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.doubleClick(screen.getByText('build'));

    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    expect(input).toBeTruthy();
    expect(input!.value).toBe('build');

    await fireEvent.keyDown(input!, { key: 'Escape' });
    expect(container.querySelector('[data-edit-script="script-1"]')).toBeNull();
    expect(screen.getByText('build')).toBeTruthy();
    expect(mockScriptUpdate).not.toHaveBeenCalled();
  });

  it('commits a non-empty rename with Enter', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.doubleClick(screen.getByText('build'));
    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    await fireEvent.input(input!, { target: { value: 'compile' } });
    await fireEvent.keyDown(input!, { key: 'Enter' });

    await waitFor(() =>
      expect(mockScriptUpdate).toHaveBeenCalledWith('ws-1', 'script-1', { name: 'compile' }),
    );
    expect(container.querySelector('[data-edit-script="script-1"]')).toBeNull();
  });

  it('commits a non-empty rename on blur', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.doubleClick(screen.getByText('build'));
    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    await fireEvent.input(input!, { target: { value: 'bundle' } });

    await fireEvent.blur(input!);

    await waitFor(() =>
      expect(mockScriptUpdate).toHaveBeenCalledWith('ws-1', 'script-1', { name: 'bundle' }),
    );
    expect(screen.getByText('build')).toBeTruthy();
  });

  it('never leaves the script row empty when an empty rename is submitted', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.doubleClick(screen.getByText('build'));
    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    await fireEvent.input(input!, { target: { value: '   ' } });

    await fireEvent.keyDown(input!, { key: 'Enter' });

    expect(mockScriptUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('build')).toBeTruthy();
  });
});

describe('TerminalSidebar agent navigation context', () => {
  it.each([
    ['unmodified', {}, false],
    ['Cmd', { metaKey: true }, true],
    ['Ctrl', { ctrlKey: true }, true],
  ])('forwards %s agent navigation intent', async (_name, modifier, openInAdjacentPanel) => {
    executorState.isRunning = true;
    executorState.agentId = 'agent-detect';
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
    mockGetNavigationContext.mockImplementation((event: MouseEvent) => ({
      sourcePanelId: 'panel-1',
      openInAdjacentPanel: event.metaKey || event.ctrlKey,
    }));

    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    const detectionAgentButton = await screen.findByTitle('View detection agent');
    await fireEvent.click(detectionAgentButton, modifier);

    expect(mockGetNavigationContext).toHaveBeenCalledWith(expect.any(MouseEvent));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'appLayout/openAgentTabRequested',
      payload: [
        'ws-1',
        {
          agentId: 'agent-detect',
          sourcePanelId: 'panel-1',
          openInAdjacentPanel,
        },
      ],
    });
  });
});

describe('TerminalSidebar resize handle', () => {
  it('uses the shared horizontal resize contract and reports drag state', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    const handle = container.querySelector('.app-resize-handle');

    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('data-resize-axis')).toBe('x');
    expect(handle?.getAttribute('data-resizing')).toBe('false');

    await fireEvent.mouseDown(handle!);
    expect(handle?.getAttribute('data-resizing')).toBe('true');

    await fireEvent.mouseUp(document);
    expect(handle?.getAttribute('data-resizing')).toBe('false');
  });
});
