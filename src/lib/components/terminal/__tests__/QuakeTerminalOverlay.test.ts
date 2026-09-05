import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch, mockUpdate, scriptEntries, selectorSubscribers, terminalState, toast } =
  vi.hoisted(() => ({
    mockDispatch: vi.fn(),
    mockUpdate: vi.fn(),
    scriptEntries: { value: [] as any[] },
    selectorSubscribers: new Set<() => void>(),
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

vi.mock('$store/renderer/store', async () => {
  const { get } = await import('svelte/store');
  const store: any = {
    state: {},
    dispatch: mockDispatch,
    createSelector: (fn: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => ({
          subscribe: (listener: (value: any) => void) => {
            listener(fn(store.state, ...args.map((arg) => (arg?.subscribe ? get(arg) : arg))));
            return () => {};
          },
        }),
        { select: fn },
      ),
  };
  return { store };
});

vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => {
  const readable = <T>(read: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      const emit = () => listener(read());
      emit();
      selectorSubscribers.add(emit);
      return () => selectorSubscribers.delete(emit);
    },
  });
  const scopedReadable = <T>(
    workspaceIdStore: { subscribe: (listener: (workspaceId: string) => void) => () => void },
    read: (workspaceId: string) => T,
  ) => ({
    subscribe: (listener: (value: T) => void) => {
      let currentWorkspaceId = '';
      const unsubscribeWorkspace = workspaceIdStore.subscribe((workspaceId) => {
        currentWorkspaceId = workspaceId;
        listener(read(workspaceId));
      });
      const emit = () => listener(read(currentWorkspaceId));
      selectorSubscribers.add(emit);
      return () => {
        selectorSubscribers.delete(emit);
        unsubscribeWorkspace();
      };
    },
  });
  const workspaceState = (workspaceId: string) =>
    terminalState.byWorkspace[workspaceId] ?? terminalState;
  return {
    selectIsTerminalOverlayOpenForWorkspace: (workspaceId: any) =>
      typeof workspaceId === 'string'
        ? readable(() => workspaceState(workspaceId).isOpen)
        : scopedReadable(workspaceId, (id) => workspaceState(id).isOpen),
    selectTerminalOverlayHeight: () => readable(() => terminalState.height),
    selectActiveTerminalIdForWorkspace: (workspaceId: any) =>
      typeof workspaceId === 'string'
        ? readable(() => workspaceState(workspaceId).activeId)
        : scopedReadable(workspaceId, (id) => workspaceState(id).activeId),
    selectTerminalsForWorkspace: (workspaceId: any) =>
      typeof workspaceId === 'string'
        ? readable(() => workspaceState(workspaceId).terminals)
        : scopedReadable(workspaceId, (id) => workspaceState(id).terminals),
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
  const component = (await import('./mocks/MockTerminalSidebar.svelte')).default;
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
import RootQuakeTerminalOverlay from '../RootQuakeTerminalOverlay.svelte';

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
  async function notifyTerminalState() {
    for (const notify of selectorSubscribers) notify();
    await tick();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ success: true });
    scriptEntries.value = [runningScript];
    terminalState.activeId = 'terminal-1';
    terminalState.height = 50;
    terminalState.isOpen = true;
    terminalState.terminals = [{ id: 'terminal-1', name: 'Terminal 1' }];
    terminalState.byWorkspace = {};
    selectorSubscribers.clear();
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

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'Running dev' }));
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

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'Running dev' }));
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

  it('retains terminal and sidebar DOM identity while collapsed and inert', async () => {
    const { container } = render(QuakeTerminalOverlay, {
      props: { workspaceId: 'ws-1' as any, showDockWhenClosed: false },
    });
    await waitFor(() => expect(container.querySelector('.terminal-panel')).toBeTruthy());
    const panel = container.querySelector<HTMLElement>('.terminal-panel')!;
    const terminalNode = container.querySelector(
      '[data-terminal-content] [data-testid="mock-component"]',
    );
    const sidebarButton = screen.getByRole('button', { name: 'Direct select ws-1' });
    const sidebarState = screen.getByRole('textbox', { name: 'Sidebar state' }) as HTMLInputElement;
    await fireEvent.input(sidebarState, { target: { value: 'kept state' } });
    sidebarButton.focus();

    terminalState.isOpen = false;
    await notifyTerminalState();
    expect(container.querySelector('.terminal-panel')).toBe(panel);
    expect(container.querySelector('[data-terminal-content] [data-testid="mock-component"]')).toBe(
      terminalNode,
    );
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect((panel as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(document.activeElement).not.toBe(sidebarButton);

    terminalState.isOpen = true;
    await notifyTerminalState();
    expect(container.querySelector('.terminal-panel')).toBe(panel);
    expect((screen.getByRole('textbox', { name: 'Sidebar state' }) as HTMLInputElement).value).toBe(
      'kept state',
    );
    expect(panel.getAttribute('aria-hidden')).toBe('false');
  });

  it.each([
    [
      'workspace',
      () => render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } }),
      'ws-1',
    ],
    ['root', () => render(RootQuakeTerminalOverlay), '__root__'],
  ])(
    'flushes %s resize and releases global state when destroyed',
    async (_, renderOverlay, wsId) => {
      const removeListener = vi.spyOn(document, 'removeEventListener');
      document.body.style.cursor = 'crosshair';
      document.body.style.userSelect = 'text';
      const { container, unmount } = renderOverlay();
      const resizeHandle = container.querySelector<HTMLElement>('[data-resize-axis="y"]');
      expect(resizeHandle).toBeTruthy();

      await fireEvent.mouseDown(resizeHandle!);
      await fireEvent.mouseMove(document, { clientY: 0 });
      expect(document.body.style.cursor).toBe('ns-resize');
      expect(document.body.style.userSelect).toBe('none');

      unmount();

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'terminals/setHeight',
        payload: [wsId, 90],
      });
      expect(document.body.style.cursor).toBe('crosshair');
      expect(document.body.style.userSelect).toBe('text');
      expect(removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
      mockDispatch.mockClear();
      await fireEvent.mouseMove(document, { clientY: 100 });
      expect(mockDispatch).not.toHaveBeenCalled();
      removeListener.mockRestore();
    },
  );

  it.each([
    [
      'workspace',
      () => render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } }),
      'ws-1',
    ],
    ['root', () => render(RootQuakeTerminalOverlay), '__root__'],
  ])(
    'previews %s resize locally and commits one clamped height on release',
    async (_, renderOverlay, wsId) => {
      const { container } = renderOverlay();
      const panel = container.querySelector<HTMLElement>('.terminal-panel');
      const resizeHandle = container.querySelector<HTMLElement>('[data-resize-axis="y"]');
      expect(panel).toBeTruthy();
      expect(resizeHandle).toBeTruthy();
      mockDispatch.mockClear();

      await fireEvent.mouseDown(resizeHandle!);
      await fireEvent.mouseMove(document, { clientY: window.innerHeight / 2 });
      await fireEvent.mouseMove(document, { clientY: 0 });

      expect(panel?.style.height).toBe('90vh');
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'terminals/setHeight' }),
      );

      await fireEvent.mouseUp(document);

      expect(
        mockDispatch.mock.calls.filter(([action]) => action.type === 'terminals/setHeight'),
      ).toEqual([[{ type: 'terminals/setHeight', payload: [wsId, 90] }]]);
    },
  );
});
