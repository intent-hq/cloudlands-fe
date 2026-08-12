import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch, mockUpdate, scriptEntries, terminalState, toast } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockUpdate: vi.fn(),
  scriptEntries: { value: [] as any[] },
  terminalState: {
    activeId: 'terminal-1' as string | null,
    height: 50,
    isOpen: true,
    terminals: [{ id: 'terminal-1', name: 'Terminal 1' }] as any[],
    byWorkspace: {} as Record<
      string,
      { activeId: string | null; isOpen: boolean; terminals: any[] }
    >,
  },
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('$store/renderer/store', () => ({
  store: { state: {}, dispatch: mockDispatch },
}));

vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => {
  const readable = <T>(read: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      listener(read());
      return () => {};
    },
  });
  const scopedReadable = <T>(
    workspaceIdStore: { subscribe: (listener: (workspaceId: string) => void) => () => void },
    read: (workspaceId: string) => T,
  ) => ({
    subscribe: (listener: (value: T) => void) =>
      workspaceIdStore.subscribe((workspaceId) => listener(read(workspaceId))),
  });
  const workspaceState = (workspaceId: string) =>
    terminalState.byWorkspace[workspaceId] ?? terminalState;
  return {
    selectIsTerminalOverlayOpenForWorkspace: (workspaceIdStore: any) =>
      scopedReadable(workspaceIdStore, (workspaceId) => workspaceState(workspaceId).isOpen),
    selectTerminalOverlayHeight: () => readable(() => terminalState.height),
    selectActiveTerminalIdForWorkspace: (workspaceIdStore: any) =>
      scopedReadable(workspaceIdStore, (workspaceId) => workspaceState(workspaceId).activeId),
    selectTerminalsForWorkspace: (workspaceIdStore: any) =>
      scopedReadable(workspaceIdStore, (workspaceId) => workspaceState(workspaceId).terminals),
    selectWorkspaceTerminalState: Object.assign(
      (workspaceIdStore: any) =>
        scopedReadable(workspaceIdStore, () => ({ selectedScriptId: null })),
      { select: () => ({ selectedScriptId: null }) },
    ),
  };
});

vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  openTerminalOverlay: (...payload: any[]) => ({ type: 'terminals/open', payload }),
  closeTerminalOverlay: (...payload: any[]) => ({ type: 'terminals/close', payload }),
  selectTerminal: (...payload: any[]) => ({ type: 'terminals/select', payload }),
  selectScript: (...payload: any[]) => ({ type: 'terminals/selectScript', payload }),
  addTerminal: (...payload: any[]) => ({ type: 'terminals/add', payload }),
  removeTerminal: (...payload: any[]) => ({ type: 'terminals/remove', payload }),
  setTerminalOverlayHeight: (...payload: any[]) => ({ type: 'terminals/setHeight', payload }),
  renameTerminal: (...payload: any[]) => ({ type: 'terminals/rename', payload }),
  clearScriptSelection: (...payload: any[]) => ({
    type: 'terminals/clearScriptSelection',
    payload,
  }),
  terminalCreated: (...payload: any[]) => ({ type: 'terminals/terminalCreated', payload }),
}));

vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => {
  const readable = <T>(read: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      listener(read());
      return () => {};
    },
  });
  return {
    selectWorkspaceScriptEntries: Object.assign(() => readable(() => scriptEntries.value), {
      select: () => scriptEntries.value,
    }),
    selectWorkspaceScriptsInitialized: () => readable(() => true),
  };
});

vi.mock('$store/renderer/slices/scripts/scripts-slice', () => ({
  refreshScripts: (...payload: any[]) => ({ type: 'scripts/refresh', payload }),
  initializeScripts: (...payload: any[]) => ({ type: 'scripts/initialize', payload }),
  disposeScripts: (...payload: any[]) => ({ type: 'scripts/dispose', payload }),
  removeScript: (...payload: any[]) => ({ type: 'scripts/remove', payload }),
}));

vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: {
    detect: vi.fn().mockResolvedValue({ success: true }),
    update: mockUpdate,
    remove: vi.fn().mockResolvedValue({ success: true }),
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    restart: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('$lib/components/ui/toast', () => ({ toast }));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { clearTerminal: vi.fn(), disposeTerminal: vi.fn() },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: { getLastCommand: vi.fn(() => null) },
}));

vi.mock('../Terminal.svelte', async () => {
  const component = (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { default: component };
});
vi.mock('../SetupScriptBanner.svelte', async () => {
  const component = (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { default: component };
});
vi.mock('../ScriptOutputViewer.svelte', async () => {
  const component = (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { default: component };
});
vi.mock('../TerminalSidebar.svelte', async () => {
  const component = (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { default: component };
});
vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/MockFa.svelte')).default,
}));
vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('./mocks/MockButton.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => {
  const component = (await import('./mocks/MockTooltip.svelte')).default;
  return { Tooltip: component, TooltipRich: component };
});
vi.mock('svelte/transition', () => ({ slide: () => ({}) }));

import QuakeTerminalOverlay from '../QuakeTerminalOverlay.svelte';

const runningScript = {
  id: 'script-1',
  workspaceId: 'ws-1',
  name: 'dev',
  command: 'pnpm dev',
  mode: 'service',
  source: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  runtime: { status: 'running', restartCount: 0 },
};

describe('QuakeTerminalOverlay lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ success: true });
    scriptEntries.value = [runningScript];
    terminalState.activeId = 'terminal-1';
    terminalState.height = 50;
    terminalState.isOpen = true;
    terminalState.terminals = [{ id: 'terminal-1', name: 'Terminal 1' }];
    terminalState.byWorkspace = {};
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('awaits a script rename and keeps the editor open when the mutation fails in-band', async () => {
    let resolveUpdate!: (result: { success: boolean; error?: string }) => void;
    mockUpdate.mockImplementationOnce(() => new Promise((resolve) => (resolveUpdate = resolve)));
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'dev' }));
    const input = screen.getByPlaceholderText('Name');
    await fireEvent.input(input, { target: { value: 'renamed dev' } });
    await fireEvent.blur(input);

    expect(mockUpdate).toHaveBeenCalledWith('ws-1', 'script-1', { name: 'renamed dev' });
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/refresh' }),
    );
    expect(screen.getByPlaceholderText('Name')).toBeTruthy();

    resolveUpdate({ success: false, error: 'Rename rejected' });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Rename rejected'));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/refresh' }),
    );
    expect(screen.getByPlaceholderText('Name')).toBeTruthy();
  });

  it('reconciles a deferred rename to its captured workspace without closing B editing UI', async () => {
    let resolveUpdate!: (result: { success: boolean; error?: string }) => void;
    mockUpdate.mockImplementationOnce(() => new Promise((resolve) => (resolveUpdate = resolve)));
    const { rerender } = render(QuakeTerminalOverlay, {
      props: { workspaceId: 'ws-a' as any },
    });

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'dev' }));
    const input = screen.getByPlaceholderText('Name');
    await fireEvent.input(input, { target: { value: 'renamed in A' } });
    await fireEvent.blur(input);
    expect(mockUpdate).toHaveBeenCalledWith('ws-a', 'script-1', { name: 'renamed in A' });

    await rerender({ workspaceId: 'ws-b' as any });
    resolveUpdate({ success: true });

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'scripts/refresh',
        payload: ['ws-a'],
      }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith({
      type: 'scripts/refresh',
      payload: ['ws-b'],
    });
    expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe('renamed in A');
  });

  it('cancels the delayed terminal-tab action when destroyed', async () => {
    vi.useFakeTimers();
    const { unmount } = render(QuakeTerminalOverlay, {
      props: { workspaceId: 'ws-1' as any },
    });

    await fireEvent.click(screen.getByRole('tab', { name: 'Terminal 1' }));
    unmount();
    mockDispatch.mockClear();
    vi.advanceTimersByTime(250);

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('expands only the workspace whose terminal overlay is open', async () => {
    terminalState.isOpen = false;
    terminalState.byWorkspace = {
      'ws-open': {
        activeId: 'terminal-open',
        isOpen: true,
        terminals: [{ id: 'terminal-open', name: 'Open terminal' }],
      },
      'ws-closed': {
        activeId: 'terminal-closed',
        isOpen: false,
        terminals: [{ id: 'terminal-closed', name: 'Closed terminal' }],
      },
    };

    const openOverlay = render(QuakeTerminalOverlay, {
      props: { workspaceId: 'ws-open' as any, showDockWhenClosed: false },
    });
    const closedOverlay = render(QuakeTerminalOverlay, {
      props: { workspaceId: 'ws-closed' as any, showDockWhenClosed: false },
    });

    await waitFor(() =>
      expect(openOverlay.container.querySelector('.terminal-panel')).toBeTruthy(),
    );
    expect(closedOverlay.container.querySelector('.terminal-panel')).toBeNull();
  });

  it('releases active resize listeners and global body styles when destroyed', async () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'text';
    const { container, unmount } = render(QuakeTerminalOverlay, {
      props: { workspaceId: 'ws-1' as any },
    });
    const resizeHandle = container.querySelector<HTMLElement>('[data-resize-axis="y"]');
    expect(resizeHandle).toBeTruthy();

    await fireEvent.mouseDown(resizeHandle!);
    expect(document.body.style.cursor).toBe('ns-resize');
    expect(document.body.style.userSelect).toBe('none');

    unmount();

    expect(document.body.style.cursor).toBe('crosshair');
    expect(document.body.style.userSelect).toBe('text');
    expect(removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    mockDispatch.mockClear();
    await fireEvent.mouseMove(document, { clientY: 100 });
    expect(mockDispatch).not.toHaveBeenCalled();
    removeListener.mockRestore();
  });
});
