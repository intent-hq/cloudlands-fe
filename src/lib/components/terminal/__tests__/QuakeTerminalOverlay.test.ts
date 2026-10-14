import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDispatch,
  mockGet,
  selectedScript,
  scriptEntries,
  selectorSubscribers,
  terminalState,
  asyncUpdate,
  workflowOutcomes,
  notify,
} = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockGet: vi.fn(),
  selectedScript: { id: null as string | null },
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
  asyncUpdate: {
    handler: null as ((action: any) => void) | null,
  },
  workflowOutcomes: new Map<string, any>(),
  notify: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('$lib/client', () => ({ appClient: { scripts: { get: mockGet } } }));

vi.mock('$store/renderer/store', async () => {
  const { get } = await import('svelte/store');
  const { scriptsReducer, emptyWorkspaceState } =
    await import('$store/renderer/slices/scripts/scripts-slice');
  let scripts = scriptsReducer(undefined, { type: '@@init' });
  const store: any = {
    get state() {
      return {
        scripts: {
          byWorkspaceId: Object.fromEntries(
            ['ws-1', 'ws-a', 'ws-b'].map((id) => [
              id,
              {
                ...emptyWorkspaceState,
                ...scripts.byWorkspaceId[id],
                scripts: Object.fromEntries(
                  scriptEntries.value.map((script) => [script.id, script]),
                ),
              },
            ]),
          ),
        },
      };
    },
    dispatch: (action: any) => {
      mockDispatch(action);
      scripts = scriptsReducer(scripts, action);
      const finishWorkflow = (
        consumer: any,
        workspaceId: string,
        status: string,
        result?: unknown,
        error?: string,
      ) => {
        if (!consumer) return;
        workflowOutcomes.set(consumer.consumerId, {
          ...consumer,
          workspaceId,
          status,
          result,
          error,
          consumed: false,
        });
        for (const notifySelector of selectorSubscribers) notifySelector();
      };
      if (action.type === 'scripts/updateScriptDefinitionRequested') {
        const [workspaceId, _scriptId, _updates, consumer] = action.payload;
        const success = action.success;
        const failure = action.failure;
        action.success = (result: unknown) => {
          const next = success(result);
          finishWorkflow(consumer, workspaceId, 'success', result);
          return next;
        };
        action.failure = (error: unknown) => {
          const next = failure(error);
          finishWorkflow(
            consumer,
            workspaceId,
            'failure',
            undefined,
            error instanceof Error ? error.message : String(error),
          );
          return next;
        };
        if (asyncUpdate.handler) asyncUpdate.handler(action);
        else {
          const [, scriptId, updates] = action.payload;
          action.success({ id: scriptId, workspaceId, ...updates });
        }
      } else if (action.type === 'scripts/getScriptDefinitionRequested') {
        const [workspaceId, scriptId, consumer] = action.payload;
        void mockGet(workspaceId, scriptId).then(
          (result) => finishWorkflow(consumer, workspaceId, 'success', result),
          (error) => finishWorkflow(consumer, workspaceId, 'failure', undefined, String(error)),
        );
      }
    },
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
        scopedReadable(workspaceIdStore, () => ({ selectedScriptId: selectedScript.id })),
      { select: () => ({ selectedScriptId: selectedScript.id }) },
    ),
    selectTerminalCreationOutcome: () => readable(() => undefined),
  };
});

vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  openTerminalOverlay: (...payload: any[]) => ({ type: 'terminals/open', payload }),
  closeTerminalOverlay: (...payload: any[]) => ({ type: 'terminals/close', payload }),
  selectTerminal: (...payload: any[]) => ({ type: 'terminals/select', payload }),
  selectScript: (...payload: any[]) => ({ type: 'terminals/selectScript', payload }),
  addTerminal: (...payload: any[]) => ({ type: 'terminals/add', payload }),
  createOverlayTerminalRequested: (...payload: any[]) => ({
    type: 'terminals/createOverlayTerminalRequested',
    payload,
  }),
  removeTerminal: (...payload: any[]) => ({ type: 'terminals/remove', payload }),
  setTerminalOverlayHeight: (...payload: any[]) => ({ type: 'terminals/setHeight', payload }),
  renameTerminal: (...payload: any[]) => ({ type: 'terminals/rename', payload }),
  clearTerminalCreationOutcome: (...payload: any[]) => ({
    type: 'terminals/clearCreation',
    payload,
  }),
  clearScriptSelection: (...payload: any[]) => ({
    type: 'terminals/clearScriptSelection',
    payload,
  }),
}));

vi.mock('$store/renderer/slices/scripts/scripts-selectors', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$store/renderer/slices/scripts/scripts-selectors')>();
  const readable = <T>(read: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      const emit = () => listener(read());
      emit();
      selectorSubscribers.add(emit);
      return () => selectorSubscribers.delete(emit);
    },
  });
  return {
    ...actual,
    selectAllWorkspaceScriptEntries: Object.assign(() => readable(() => scriptEntries.value), {
      select: () => scriptEntries.value,
    }),
    selectWorkspaceScriptEntries: Object.assign(() => readable(() => scriptEntries.value), {
      select: () => scriptEntries.value,
    }),
    selectWorkspaceScriptsInitialized: () => readable(() => true),
    selectCanDeleteScript: () => readable(() => false),
    selectScriptWorkflowOutcome: (consumerId: string, workspaceArg: any, resourceArg: any) => ({
      subscribe: (listener: (value: any) => void) => {
        let workspaceId = typeof workspaceArg === 'string' ? workspaceArg : '';
        let resourceId = typeof resourceArg === 'string' ? resourceArg : '';
        const emit = () => {
          const outcome = workflowOutcomes.get(consumerId);
          listener(
            outcome?.workspaceId === workspaceId && outcome.resourceId === resourceId
              ? outcome
              : undefined,
          );
        };
        const unsubWorkspace = workspaceArg?.subscribe?.((value: string) => {
          workspaceId = value;
          emit();
        });
        const unsubResource = resourceArg?.subscribe?.((value: string) => {
          resourceId = value;
          emit();
        });
        selectorSubscribers.add(emit);
        emit();
        return () => {
          selectorSubscribers.delete(emit);
          unsubWorkspace?.();
          unsubResource?.();
        };
      },
    }),
  };
});

vi.mock('$store/renderer/slices/scripts/scripts-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/scripts/scripts-slice')>()),
  refreshScripts: (...payload: any[]) => ({ type: 'scripts/refresh', payload }),
  disposeScripts: (...payload: any[]) => ({ type: 'scripts/dispose', payload }),
  removeScript: (...payload: any[]) => ({ type: 'scripts/remove', payload }),
}));

vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: {
    detect: vi.fn().mockResolvedValue({ success: true }),
    remove: vi.fn().mockResolvedValue({ success: true }),
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    restart: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('$lib/components/patterns/notify', () => ({ notify }));
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

import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
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
    selectedScript.id = null;
    mockGet.mockReset().mockResolvedValue(runningScript);
    asyncUpdate.handler = null;
    workflowOutcomes.clear();
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

  it('keeps a known off-page selection visible without loading its definition', async () => {
    selectedScript.id = 'off-page-script';
    scriptEntries.value = [];
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });
    expect(await screen.findByText('off-page-script')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('reads the selected full command only when opening its editor', async () => {
    selectedScript.id = 'script-1';
    const { command: _command, ...summary } = runningScript;
    scriptEntries.value = [{ ...summary, commandPreview: 'pnpm…', commandTruncated: true }];
    mockGet.mockResolvedValue({ ...runningScript, command: 'pnpm full-command --long-argument' });
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });
    expect(mockGet).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByText('pnpm…'));
    const input = (await screen.findByPlaceholderText('npm run dev')) as HTMLInputElement;
    expect(input.value).toBe('pnpm full-command --long-argument');
    expect(mockGet).toHaveBeenCalledExactlyOnceWith('ws-1', 'script-1');
  });

  it('discards command detail superseded by a same-ID definition event', async () => {
    selectedScript.id = 'script-1';
    let resolve!: (value: typeof runningScript) => void;
    mockGet.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });
    await fireEvent.click(screen.getByText(runningScript.command));
    const newer = { ...runningScript, command: 'newer committed command' };
    scriptEntries.value = [newer];
    await notifyTerminalState();
    expect(screen.getByText(newer.command)).toBeTruthy();
    resolve({ ...runningScript });
    await tick();
    await new Promise((done) => setTimeout(done, 0));
    expect(screen.queryByPlaceholderText('npm run dev')).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/updateScriptDefinitionRequested' }),
    );

    mockGet.mockResolvedValueOnce(newer);
    await fireEvent.click(screen.getByText(newer.command));
    const input = (await screen.findByPlaceholderText('npm run dev')) as HTMLTextAreaElement;
    expect(input.value).toBe(newer.command);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('discards a command-detail reply when a newer editor request has completed', async () => {
    selectedScript.id = 'script-1';
    let resolve!: (value: typeof runningScript) => void;
    mockGet.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    mockGet.mockResolvedValueOnce({ ...runningScript, command: 'latest full command' });
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });
    await fireEvent.click(screen.getByText(runningScript.command));
    await fireEvent.click(screen.getByText(runningScript.command));
    const input = (await screen.findByPlaceholderText('npm run dev')) as HTMLTextAreaElement;
    expect(input.value).toBe('latest full command');
    resolve({ ...runningScript, command: 'obsolete full command' });
    await tick();
    await new Promise((done) => setTimeout(done, 0));
    expect(input.value).toBe('latest full command');
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it.each(['ctrlKey', 'metaKey'])(
    'keeps unchanged compact command saves read-only with %s',
    async (modifier) => {
      selectedScript.id = 'script-1';
      const { command: _command, ...summary } = runningScript;
      scriptEntries.value = [{ ...summary, commandPreview: 'pnpm…', commandTruncated: true }];
      mockGet.mockResolvedValue({ ...runningScript, command: 'pnpm full-command --long-argument' });
      render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });
      await fireEvent.click(screen.getByText('pnpm…'));
      const input = await screen.findByPlaceholderText('npm run dev');
      await fireEvent.keyDown(input, { key: 's', [modifier]: true });
      await tick();
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scripts/updateScriptDefinitionRequested' }),
      );
      expect(mockGet).toHaveBeenCalledExactlyOnceWith('ws-1', 'script-1');
      expect(screen.queryByPlaceholderText('npm run dev')).toBeNull();
    },
  );

  it('saves an actual compact command edit against the loaded full baseline', async () => {
    selectedScript.id = 'script-1';
    const { command: _command, ...summary } = runningScript;
    scriptEntries.value = [{ ...summary, commandPreview: 'pnpm…', commandTruncated: true }];
    mockGet.mockResolvedValue({ ...runningScript, command: 'pnpm full-command --long-argument' });
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });
    await fireEvent.click(screen.getByText('pnpm…'));
    const input = await screen.findByPlaceholderText('npm run dev');
    await fireEvent.input(input, { target: { value: 'pnpm edited-command' } });
    await fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/updateScriptDefinitionRequested',
          payload: [
            'ws-1',
            'script-1',
            { command: 'pnpm edited-command' },
            expect.objectContaining({ resourceId: 'script-1' }),
          ],
        }),
      ),
    );
  });

  it('awaits a script rename and keeps the editor open when the mutation fails in-band', async () => {
    let rejectUpdate!: (error: Error) => void;
    asyncUpdate.handler = (action) => {
      rejectUpdate = (error) => action.failure(error);
    };
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'Running dev' }));
    const input = screen.getByPlaceholderText('Name');
    await fireEvent.input(input, { target: { value: 'renamed dev' } });
    await fireEvent.blur(input);

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/updateScriptDefinitionRequested',
        payload: [
          'ws-1',
          'script-1',
          { name: 'renamed dev' },
          expect.objectContaining({ resourceId: 'script-1' }),
        ],
      }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/refresh' }),
    );
    expect(screen.getByPlaceholderText('Name')).toBeTruthy();

    rejectUpdate(new Error('Rename rejected'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Rename rejected'));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/refresh' }),
    );
    expect(screen.getByPlaceholderText('Name')).toBeTruthy();
  });

  it('submits an Enter-plus-blur rename only once and closes from that outcome', async () => {
    let resolveUpdate!: () => void;
    let updateCount = 0;
    asyncUpdate.handler = (action) => {
      updateCount += 1;
      resolveUpdate = () => action.success({ id: 'script-1', workspaceId: 'ws-1' });
    };
    render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } });

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'Running dev' }));
    const input = screen.getByPlaceholderText('Name');
    await fireEvent.input(input, { target: { value: 'renamed once' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.blur(input);

    expect(updateCount).toBe(1);
    resolveUpdate();
    await waitFor(() => expect(screen.queryByPlaceholderText('Name')).toBeNull());
  });

  it('reconciles a deferred rename to its captured workspace without closing B editing UI', async () => {
    let resolveUpdate!: () => void;
    asyncUpdate.handler = (action) => {
      const [workspaceId, scriptId, updates] = action.payload;
      resolveUpdate = () => action.success({ id: scriptId, workspaceId, ...updates });
    };
    const { rerender } = render(QuakeTerminalOverlay, {
      props: { workspaceId: 'ws-a' as any },
    });

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'Running dev' }));
    const input = screen.getByPlaceholderText('Name');
    await fireEvent.input(input, { target: { value: 'renamed in A' } });
    await fireEvent.blur(input);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/updateScriptDefinitionRequested',
        payload: [
          'ws-a',
          'script-1',
          { name: 'renamed in A' },
          expect.objectContaining({ resourceId: 'script-1' }),
        ],
      }),
    );

    await rerender({ workspaceId: 'ws-b' as any });
    resolveUpdate();

    await tick();
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
    ['workspace', () => render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } })],
    ['root', () => render(RootQuakeTerminalOverlay)],
  ])(
    'renders the %s overlay resize handle on the shared app-resize-handle contract',
    (_, renderOverlay) => {
      const { container } = renderOverlay();
      const panel = container.querySelector<HTMLElement>('.terminal-panel');
      const resizeHandle = container.querySelector<HTMLElement>('[data-resize-axis="y"]');

      expect(panel).toBeTruthy();
      expect(resizeHandle).toBeTruthy();
      expect(panel!.contains(resizeHandle)).toBe(true);
      expect(resizeHandle!.classList.contains('app-resize-handle')).toBe(true);
      expect(resizeHandle!.getAttribute('data-resize-indicator')).toBe('short');
    },
  );

  it.each([
    [
      'workspace',
      () => render(QuakeTerminalOverlay, { props: { workspaceId: 'ws-1' as any } }),
      'ws-1',
    ],
    ['root', () => render(RootQuakeTerminalOverlay), ROOT_WORKSPACE_ID],
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
    ['root', () => render(RootQuakeTerminalOverlay), ROOT_WORKSPACE_ID],
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
