import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDetect, mockExecute, mockDispatch, scriptEntries, activeWorkspaceState, toast } = vi.hoisted(() => {
  const mockDetect = vi.fn();
  const mockExecute = vi.fn();
  const mockDispatch = vi.fn();
  return {
    mockDetect,
    mockExecute,
    mockDispatch,
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
    },
  };
});

vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: {
    detect: mockDetect,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    saveToRepo: vi.fn(),
  },
}));

vi.mock('$lib/store/slices/scripts/scripts-selectors', () => ({
  selectScriptEntries: Object.assign(
    () => ({
      subscribe: (fn: (value: any) => void) => {
        fn(scriptEntries.value);
        return () => {};
      },
    }),
    { select: () => scriptEntries.value },
  ),
}));
vi.mock('$lib/store/slices/scripts/scripts-slice', () => ({
  refreshScripts: vi.fn((...args: any[]) => ({ type: 'scripts/refreshScripts', payload: args })),
  removeScript: vi.fn((...args: any[]) => ({ type: 'scripts/removeScript', payload: args })),
  upsertScript: vi.fn((...args: any[]) => ({ type: 'scripts/upsertScript', payload: args })),
}));
vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    getState: () => ({
      scripts: {
        byWorkspaceId: {
          'ws-1': {
            scripts: {},
            runtimeStates: {},
            outputBuffers: {},
            initialized: true,
            loading: false,
          },
        },
      },
      workspace: { activeWorkspaceId: 'ws-1' },
    }),
  }),
}));
vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: () => ({
    subscribe: (fn: (value: any) => void) => {
      fn(activeWorkspaceState.value);
      return () => {};
    },
  }),
}));
vi.mock('$lib/stores/terminal-overlay.store.svelte', () => ({
  terminalsStore: { terminals: [], activeTerminalId: null },
}));
vi.mock('$lib/components/ui/toast', () => ({ toast }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('$lib/hooks/use-background-agent.svelte', () => ({
  useBackgroundAgent: () => ({
    execute: mockExecute,
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('$lib/store/utils/utils', () => ({
  getDispatch: () => mockDispatch,
}));
vi.mock('$lib/store/slices/background-agent-executor/background-agent-executor-selectors', () => ({
  selectExecutorIsRunning: Object.assign(
    () => ({ subscribe: (fn: any) => { fn(false); return () => {}; } }),
    { select: () => false },
  ),
  selectExecutorAgentId: Object.assign(
    () => ({ subscribe: (fn: any) => { fn(null); return () => {}; } }),
    { select: () => null },
  ),
}));
vi.mock('$lib/store/slices/terminals/terminals-selectors', () => ({
  selectTerminals: () => ({ subscribe: (fn: any) => { fn([]); return () => {}; } }),
  selectUserTerminals: () => ({ subscribe: (fn: any) => { fn([]); return () => {}; } }),
  selectActiveTerminalId: () => ({ subscribe: (fn: any) => { fn(null); return () => {}; } }),
}));
vi.mock('$lib/store/slices/terminals/terminals-slice', () => ({
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