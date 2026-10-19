import { scriptsClient } from '$features/scripts/scripts.client';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', async () => {
  const { appClient } = await import('$lib/client');
  return {
    backendRequest: vi.fn(
      async (method: string, params: { workspaceId: string; scriptId?: string }) => {
        if (method === 'script.remove') {
          const result = await mockWireRemove(params.workspaceId, params.scriptId);
          if (!result.success) throw new Error(result.error);
          return { ok: true };
        }
        const { workspaceId, ...definition } = params;
        const result = await appClient.scripts.create(workspaceId, definition as never);
        if (!result.success) throw new Error(result.error);
        return result.script;
      },
    ),
  };
});

vi.mock('$lib/client', () => ({
  appClient: { scripts: { list: vi.fn(), get: vi.fn(), create: vi.fn() } },
}));

const {
  mockDetect,
  mockDispatch,
  mockScriptCreate,
  mockScriptUpdate,
  mockScriptRemove,
  mockScriptRestoreSnapshot,
  mockWireRemove,
  scriptEntries,
  terminalEntries,
  activeTerminalIds,
  activeWorkspaceState,
  selectorWorkspaceArgs,
  asyncActionHandlers,
  executorState,
  mockGetNavigationContext,
  notify,
} = vi.hoisted(() => {
  const mockDetect = vi.fn();
  const mockDispatch = vi.fn();
  return {
    mockDetect,
    mockDispatch,
    mockScriptCreate: vi.fn(),
    mockScriptUpdate: vi.fn(),
    mockScriptRemove: vi.fn(),
    mockScriptRestoreSnapshot: vi.fn(),
    mockWireRemove: vi.fn(),
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
    asyncActionHandlers: {
      agentDetect: null as ((action: any) => void) | null,
      detect: null as ((action: any) => void) | null,
      apply: null as ((action: any) => void) | null,
      remove: null as ((action: any) => void) | null,
    },
    notify: {
      success: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    },
  };
});

vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: {
    list: vi.fn(async () => ({ success: true, data: scriptEntries.value })),
    detect: mockDetect,
    create: mockScriptCreate,
    update: mockScriptUpdate,
    remove: mockScriptRemove,
    restoreSnapshot: mockScriptRestoreSnapshot,
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    saveToRepo: vi.fn(),
  },
}));

vi.mock('$store/renderer/slices/scripts/scripts-selectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/scripts/scripts-selectors')>()),
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
  const { scriptsReducer, emptyWorkspaceState, scriptWorkflowFinished } =
    await import('$store/renderer/slices/scripts/scripts-slice');
  let scripts = scriptsReducer(undefined, { type: '@@init' });
  let module: ReturnType<typeof createAppStoreMockModule>;
  const finishWorkflow = (
    action: any,
    status: 'success' | 'failure',
    result?: unknown,
    error?: string,
  ) => {
    const payload = action.payload as any[];
    const consumer =
      action.type === 'scripts/createScriptDefinitionRequested'
        ? payload[2]
        : action.type === 'scripts/updateScriptDefinitionRequested'
          ? payload[3]
          : action.type === 'scripts/removeScriptDefinitionRequested' ||
              action.type === 'scripts/getScriptDefinitionRequested'
            ? payload[2]
            : action.type === 'scripts/detectScriptDefinitionsRequested' ||
                action.type === 'scripts/detectScriptsWithAgentRequested' ||
                action.type === 'scripts/saveScriptDefinitionsToRepoRequested'
              ? payload[1]
              : action.type === 'scripts/applyScriptDefinitionChangesRequested'
                ? payload[3]
                : action.type === 'scripts/removeScriptDefinitionsRequested'
                  ? payload[3]
                  : action.type === 'scripts/restoreScriptDefinitionsRequested' ||
                      action.type === 'scripts/listScriptDefinitionsRequested'
                    ? payload[2]
                    : undefined;
    if (consumer)
      module.store.dispatch(
        scriptWorkflowFinished(payload[0], consumer, status, result as never, error),
      );
  };
  module = createAppStoreMockModule({
    state: () => ({
      scripts: {
        byWorkspaceId: Object.fromEntries(
          [...new Set(['ws-1', ...Object.keys(scriptEntries.byWorkspaceId)])].map((id) => [
            id,
            {
              ...emptyWorkspaceState,
              ...scripts.byWorkspaceId[id],
              scripts: Object.fromEntries(
                (scriptEntries.byWorkspaceId[id] ?? scriptEntries.value).map((script) => [
                  script.id,
                  script,
                ]),
              ),
              initialized: true,
            },
          ]),
        ),
      },
    }),
    dispatch: (action) => {
      mockDispatch(action);
      scripts = scriptsReducer(scripts, action);
      if (action?.asyncActionType) {
        const success = action.success;
        const failure = action.failure;
        action.success = (result: unknown) => {
          const next = success(result);
          finishWorkflow(action, 'success', result);
          return next;
        };
        action.failure = (error: unknown) => {
          const next = failure(error);
          finishWorkflow(action, 'failure', undefined, String(error));
          return next;
        };
      }
      if (
        action.type === 'scripts/detectScriptsWithAgentRequested' &&
        asyncActionHandlers.agentDetect
      ) {
        asyncActionHandlers.agentDetect(action);
      } else if (
        action.type === 'scripts/detectScriptDefinitionsRequested' &&
        asyncActionHandlers.detect
      ) {
        asyncActionHandlers.detect(action);
      } else if (action.type === 'scripts/createScriptDefinitionRequested') {
        const [workspaceId, input] = action.payload;
        action.success({ id: 'new-command', workspaceId, ...input });
      } else if (action.type === 'scripts/updateScriptDefinitionRequested') {
        const [workspaceId, scriptId, updates] = action.payload;
        action.success({ id: scriptId, workspaceId, ...updates });
      } else if (action.type === 'scripts/removeScriptDefinitionRequested') {
        action.success(undefined);
      } else if (action.type === 'scripts/removeScriptDefinitionsRequested') {
        if (asyncActionHandlers.remove) asyncActionHandlers.remove(action);
        else
          action.success({
            removed: action.payload[1].map((script: { id: string }) => script.id),
            failed: [],
          });
      } else if (action.type === 'scripts/detectScriptDefinitionsRequested') {
        action.success({ detected: 0, added: 0, updated: 0, removed: 0, skippedRunning: [] });
      } else if (action.type === 'scripts/applyScriptDefinitionChangesRequested') {
        const changes = action.payload[1];
        if (asyncActionHandlers.apply) {
          asyncActionHandlers.apply(action);
          return;
        }
        const skippedRunning = changes.update.some(
          (entry: { id: string }) => entry.id === 'auto-running',
        )
          ? ['dev']
          : [];
        action.success({
          detected: 0,
          added: changes.add.length,
          updated: changes.update.length - skippedRunning.length,
          removed: changes.remove.length,
          skippedRunning,
          snapshot: scriptEntries.byWorkspaceId[action.payload[0]] ?? scriptEntries.value,
        });
      } else if (action.type === 'scripts/listScriptDefinitionsRequested') {
        const [workspaceId] = action.payload;
        void scriptsClient.list(workspaceId).then((result) => {
          if (result.success) action.success(result.data);
          else action.failure(result.error);
        });
      } else if (
        action.type === 'scripts/restoreScriptDefinitionsRequested' ||
        action.type === 'scripts/saveScriptDefinitionsToRepoRequested'
      ) {
        action.success(undefined);
      }
      module.store.emitState();
    },
  });
  return module;
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActionContext: { select: () => 'owner' },
  selectWorkspaceById: Object.assign(
    (workspaceArg: any) => {
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
    {
      select: (_state: unknown, workspaceId: string) =>
        activeWorkspaceState.byWorkspaceId[workspaceId] ?? activeWorkspaceState.value,
    },
  ),
}));
vi.mock('$store/renderers/terminal-overlay.store.svelte', () => ({
  terminalsStore: { terminals: [], activeTerminalId: null },
}));
vi.mock('$lib/components/patterns/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/components/patterns/notify')>()),
  notify,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
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
  asyncActionHandlers.agentDetect = null;
  asyncActionHandlers.detect = null;
  asyncActionHandlers.apply = null;
  asyncActionHandlers.remove = null;
  mockGetNavigationContext.mockReset();
  selectorWorkspaceArgs.length = 0;
});

describe('TerminalSidebar detection flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scriptEntries.value = [];
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
  });

  it.each([
    ['idle', 'Start', 'scripts/startScriptRequested'],
    ['running', 'Restart', 'scripts/restartScriptRequested'],
  ])('tracks %s lifecycle requests so deletion sees pending work', async (status, label, type) => {
    scriptEntries.value = [
      {
        id: 'check',
        name: 'Check',
        command: 'true',
        mode: 'command',
        runtime: { status, restartCount: 0 },
      },
    ];
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type, payload: ['ws-1', 'check', expect.any(String)] }),
    );
  });

  it('routes mixed finished/live Stop all through shared operations without changing selection', async () => {
    scriptEntries.value = ['exited', 'running'].map((status) => ({
      id: status,
      name: status,
      command: 'true',
      mode: 'command',
      purpose: 'saved',
      runtime: { status, restartCount: 0 },
    }));
    const onSelectScript = vi.fn();
    const { container } = render(TerminalSidebar, {
      props: {
        workspaceId: 'ws-1',
        selectedScriptId: 'exited',
        onSelectScript,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^exited(?:\s|$)/ }), {
      ctrlKey: true,
    });
    await fireEvent.click(screen.getByRole('button', { name: /^running(?:\s|$)/ }), {
      ctrlKey: true,
    });
    await fireEvent.contextMenu(screen.getByRole('button', { name: /^exited(?:\s|$)/ }));
    await fireEvent.click(screen.getByText('Stop All', { exact: true }));
    const stops = mockDispatch.mock.calls
      .map(([a]) => a)
      .filter((a) => a.type === 'scripts/stopScriptRequested');
    expect(stops.map((a) => a.payload.slice(0, 2))).toEqual([
      ['ws-1', 'exited'],
      ['ws-1', 'running'],
    ]);
    expect(onSelectScript).not.toHaveBeenCalled();
    expect(container.querySelector('[data-script-id="exited"]')).not.toBeNull();
  });

  it('saves commands added through the user form', async () => {
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.click(screen.getByTitle('Add script'));
    await fireEvent.input(screen.getByPlaceholderText('Name'), { target: { value: 'test' } });
    await fireEvent.input(screen.getByPlaceholderText('Command, e.g. npm run dev'), {
      target: { value: 'pnpm test' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/createScriptDefinitionRequested',
        payload: [
          'ws-1',
          { name: 'test', command: 'pnpm test', mode: 'command', purpose: 'saved', source: 'user' },
          expect.objectContaining({ resourceId: 'create' }),
        ],
      }),
    );
  });

  it('dispatches the compound agent-detection request with a mount-scoped consumer', async () => {
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Detect with AI' }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/detectScriptsWithAgentRequested',
        payload: ['ws-1', expect.objectContaining({ resourceId: 'agent-detection' })],
      }),
    );
  });

  it('renders a local fallback outcome from the compound detection workflow', async () => {
    const requests: any[] = [];
    asyncActionHandlers.agentDetect = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Detect with AI' }));
    requests[0].success({
      source: 'local',
      fallbackReason: 'unexpected-format',
      detection: { detected: 0, added: 0, updated: 0, removed: 0, skippedRunning: [] },
    });

    await waitFor(() => expect(notify.info).toHaveBeenCalledTimes(2));
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('offers Undo and reports skipped live scripts for a grounded changes outcome', async () => {
    const requests: any[] = [];
    const snapshot = [
      {
        id: 'dev',
        workspaceId: 'ws-1',
        name: 'dev',
        command: 'pnpm dev',
        mode: 'service',
        source: 'auto-detected',
        createdAt: '2026-10-15T00:00:00Z',
      },
    ];
    asyncActionHandlers.agentDetect = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Detect with AI' }));
    requests[0].success({
      source: 'agent',
      presentation: 'changes',
      changes: {
        detected: 1,
        added: 1,
        updated: 0,
        removed: 0,
        skippedRunning: ['dev'],
        snapshot,
      },
    });

    await waitFor(() => expect(notify.success).toHaveBeenCalledOnce());
    expect(notify.warning).toHaveBeenCalledOnce();
    notify.success.mock.calls[0][1].action.onClick();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/restoreScriptDefinitionsRequested',
        payload: ['ws-1', snapshot, expect.objectContaining({ resourceId: 'restore' })],
      }),
    );
  });

  it('handles the grounded legacy detection presentation without offering Undo', async () => {
    const requests: any[] = [];
    asyncActionHandlers.agentDetect = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Detect with AI' }));
    requests[0].success({
      source: 'agent',
      presentation: 'legacy',
      changes: {
        detected: 1,
        added: 1,
        updated: 0,
        removed: 0,
        skippedRunning: [],
        snapshot: [],
      },
    });

    await waitFor(() => expect(notify.success).toHaveBeenCalledOnce());
    expect(notify.success.mock.calls[0][1]).toBeUndefined();
  });

  it.each(['switch', 'unmount'] as const)(
    'releases a pending agent detection on workspace %s',
    async (lifecycle) => {
      const view = render(TerminalSidebar, { props: { workspaceId: 'ws-a' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Detect with AI' }));
      const request = mockDispatch.mock.calls.find(
        ([action]) => action.type === 'scripts/detectScriptsWithAgentRequested',
      )![0];

      if (lifecycle === 'switch') await view.rerender({ workspaceId: 'ws-b' });
      else view.unmount();

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/workflowReleased',
          payload: ['ws-a', request.payload[1].consumerId],
        }),
      );
    },
  );

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
    asyncActionHandlers.detect = (action) => {
      resolveDetect = () =>
        action.success({ detected: 0, added: 0, updated: 0, removed: 0, skippedRunning: [] });
    };

    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByTitle('Scan local project files for scripts'));

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/detectScriptDefinitionsRequested',
          payload: ['ws-1', expect.objectContaining({ resourceId: 'local-detection' })],
        }),
      ),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/detectScriptsWithAgentRequested' }),
    );
    expect(screen.getByText('Scanning files…')).toBeTruthy();

    resolveDetect?.();
    await waitFor(() => expect(notify.info).toHaveBeenCalled());
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

    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByTitle('Scan local project files for scripts'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /agent assist/i })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole('button', { name: /agent assist/i }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/detectScriptsWithAgentRequested',
        payload: ['ws-1', expect.objectContaining({ resourceId: 'agent-detection' })],
      }),
    );
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

    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByTitle('Scan local project files for scripts'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /agent assist/i })).toBeTruthy();
    });

    await fireEvent.click(screen.getByRole('button', { name: /agent assist/i }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/detectScriptsWithAgentRequested',
        payload: ['ws-1', expect.objectContaining({ resourceId: 'agent-detection' })],
      }),
    );
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
    expect(selectorWorkspaceArgs).toHaveLength(5);
    expect(selectorWorkspaceArgs.every((arg: any) => typeof arg?.subscribe === 'function')).toBe(
      true,
    );

    await fireEvent.contextMenu(screen.getByRole('button', { name: /^Script B(?:\s|$)/ }));
    await fireEvent.click(screen.getByText('Delete'));

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/removeScriptDefinitionsRequested',
          payload: [
            'ws-b',
            [expect.objectContaining({ id: 'script-b', workspaceId: 'ws-b' })],
            expect.any(String),
            expect.objectContaining({ resourceId: 'bulk-remove' }),
          ],
        }),
      ),
    );
  });
});

describe('TerminalSidebar bulk removal outcomes', () => {
  it('preserves scripts selected after the captured removal batch started', async () => {
    scriptEntries.value = ['one', 'two', 'three'].map((id) => ({
      id,
      name: id,
      command: `pnpm ${id}`,
      mode: 'command',
      source: 'user',
      runtime: { status: 'idle', exitCode: null },
    }));
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
    const requests: any[] = [];
    asyncActionHandlers.remove = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    const one = screen.getByRole('button', { name: /^one(?:\s|$)/ });
    const two = screen.getByRole('button', { name: /^two(?:\s|$)/ });
    const three = screen.getByRole('button', { name: /^three(?:\s|$)/ });
    await fireEvent.click(one, { ctrlKey: true });
    await fireEvent.click(two, { ctrlKey: true });
    await fireEvent.contextMenu(screen.getByRole('button', { name: /^one(?:\s|$)/ }));
    await waitFor(() => expect(screen.getByText(/^Delete/)).toBeTruthy());
    await fireEvent.click(screen.getByText(/^Delete/));
    expect(requests).toHaveLength(1);

    await fireEvent.click(three, { ctrlKey: true });
    requests[0].success({ removed: ['one', 'two'], failed: [] });
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scripts/workflowConsumed' }),
      ),
    );

    await fireEvent.contextMenu(screen.getByRole('button', { name: /^three(?:\s|$)/ }));
    await waitFor(() => expect(screen.getByText(/^Delete/)).toBeTruthy());
    await fireEvent.click(screen.getByText(/^Delete/));
    expect(requests).toHaveLength(2);
    expect(requests[1].payload[1]).toEqual([expect.objectContaining({ id: 'three' })]);
  });

  it('does not clear a script selected after the captured removal batch started', async () => {
    scriptEntries.value = ['one', 'two', 'three'].map((id) => ({
      id,
      name: id,
      command: `pnpm ${id}`,
      mode: 'command',
      source: 'user',
      runtime: { status: 'idle', exitCode: null },
    }));
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
    const requests: any[] = [];
    const onSelectScript = vi.fn();
    asyncActionHandlers.remove = (action) => requests.push(action);
    const view = render(TerminalSidebar, {
      props: { workspaceId: 'ws-1', selectedScriptId: 'one', onSelectScript },
    });

    await fireEvent.click(screen.getByRole('button', { name: /^one(?:\s|$)/ }), {
      ctrlKey: true,
    });
    await fireEvent.click(screen.getByRole('button', { name: /^two(?:\s|$)/ }), {
      ctrlKey: true,
    });
    await fireEvent.contextMenu(screen.getByRole('button', { name: /^one(?:\s|$)/ }));
    await fireEvent.click(screen.getByText(/^Delete/));
    expect(requests).toHaveLength(1);

    await view.rerender({ workspaceId: 'ws-1', selectedScriptId: 'three', onSelectScript });
    requests[0].success({ removed: ['one', 'two'], failed: [] });

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scripts/workflowConsumed' }),
      ),
    );
    expect(onSelectScript).not.toHaveBeenCalled();
  });

  it('clears only successfully removed rows from a partial bulk outcome', async () => {
    scriptEntries.value = ['one', 'two'].map((id) => ({
      id,
      name: id,
      command: `pnpm ${id}`,
      mode: 'command',
      source: 'user',
      runtime: { status: 'idle', exitCode: null },
    }));
    activeWorkspaceState.value = { id: 'ws-1', path: '/repo' } as any;
    const requests: any[] = [];
    asyncActionHandlers.remove = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.click(screen.getByRole('button', { name: /^one(?:\s|$)/ }), {
      ctrlKey: true,
    });
    await fireEvent.click(screen.getByRole('button', { name: /^two(?:\s|$)/ }), {
      ctrlKey: true,
    });
    await fireEvent.contextMenu(screen.getByRole('button', { name: /^one(?:\s|$)/ }));
    await fireEvent.click(screen.getByText(/^Delete/));
    requests[0].success({
      removed: ['one'],
      failed: [{ scriptId: 'two', error: 'still in use' }],
    });
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'scripts/workflowConsumed' }),
      ),
    );

    await fireEvent.contextMenu(screen.getByRole('button', { name: /^two(?:\s|$)/ }));
    await fireEvent.click(screen.getByText(/^Delete/));
    expect(requests).toHaveLength(2);
    expect(requests[1].payload[1]).toEqual([expect.objectContaining({ id: 'two' })]);
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

    await fireEvent.contextMenu(screen.getByRole('button', { name: /^build(?:\s|$)/ }));
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
  });

  it('shows a prefilled rename input on double-click and restores the row on Escape', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.doubleClick(screen.getByRole('button', { name: /build.*npm run build/ }));

    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    expect(input).toBeTruthy();
    expect(input!.value).toBe('build');

    await fireEvent.keyDown(input!, { key: 'Escape' });
    expect(container.querySelector('[data-edit-script="script-1"]')).toBeNull();
    expect(screen.getByText('build')).toBeTruthy();
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/updateScriptDefinitionRequested' }),
    );
  });

  it('commits a non-empty rename with Enter', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.doubleClick(screen.getByRole('button', { name: /build.*npm run build/ }));
    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    await fireEvent.input(input!, { target: { value: 'compile' } });
    await fireEvent.keyDown(input!, { key: 'Enter' });

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/updateScriptDefinitionRequested',
          payload: [
            'ws-1',
            'script-1',
            { name: 'compile' },
            expect.objectContaining({ resourceId: 'script-1' }),
          ],
        }),
      ),
    );
    expect(container.querySelector('[data-edit-script="script-1"]')).toBeNull();
  });

  it('commits a non-empty rename on blur', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.doubleClick(screen.getByRole('button', { name: /build.*npm run build/ }));
    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    await fireEvent.input(input!, { target: { value: 'bundle' } });

    await fireEvent.blur(input!);

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/updateScriptDefinitionRequested',
          payload: [
            'ws-1',
            'script-1',
            { name: 'bundle' },
            expect.objectContaining({ resourceId: 'script-1' }),
          ],
        }),
      ),
    );
    expect(screen.getByText('build')).toBeTruthy();
  });

  it('never leaves the script row empty when an empty rename is submitted', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.doubleClick(screen.getByRole('button', { name: /build.*npm run build/ }));
    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    await fireEvent.input(input!, { target: { value: '   ' } });

    await fireEvent.keyDown(input!, { key: 'Enter' });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/updateScriptDefinitionRequested' }),
    );
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
