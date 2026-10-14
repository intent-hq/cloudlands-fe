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
  mockExecute,
  mockDispatch,
  mockScriptCreate,
  mockScriptUpdate,
  mockScriptRemove,
  mockScriptRestoreSnapshot,
  mockWireRemove,
  backgroundAgentOptions,
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
  const mockExecute = vi.fn();
  const mockDispatch = vi.fn();
  return {
    mockDetect,
    mockExecute,
    mockDispatch,
    mockScriptCreate: vi.fn(),
    mockScriptUpdate: vi.fn(),
    mockScriptRemove: vi.fn(),
    mockScriptRestoreSnapshot: vi.fn(),
    mockWireRemove: vi.fn(),
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
    asyncActionHandlers: {
      detect: null as ((action: any) => void) | null,
      apply: null as ((action: any) => void) | null,
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
                action.type === 'scripts/saveScriptDefinitionsToRepoRequested'
              ? payload[1]
              : action.type === 'scripts/applyScriptDefinitionChangesRequested'
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
  asyncActionHandlers.detect = null;
  asyncActionHandlers.apply = null;
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

  it('saves commands returned by legacy agent detection', async () => {
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await backgroundAgentOptions.value!.onResult(
      JSON.stringify([{ name: 'test', command: 'pnpm test', mode: 'command' }]),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/applyScriptDefinitionChangesRequested',
        payload: [
          'ws-1',
          expect.objectContaining({
            add: [expect.objectContaining({ purpose: 'saved', source: 'auto-detected' })],
          }),
          undefined,
          expect.objectContaining({ resourceId: 'agent-detection' }),
          expect.any(String),
        ],
      }),
    );
  });

  it('deduplicates legacy agent results against the full fetched inventory', async () => {
    const offPage = {
      id: 'off-page',
      workspaceId: 'ws-1',
      name: 'test',
      command: 'pnpm test',
      mode: 'command',
      source: 'user',
      runtime: { status: 'idle' },
    };
    vi.mocked(scriptsClient.list).mockResolvedValueOnce({
      success: true,
      data: [offPage] as never,
    });
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Detect with AI' }));
    await waitFor(() => expect(mockExecute).toHaveBeenCalledOnce());
    await backgroundAgentOptions.value!.onResult(
      JSON.stringify([{ name: 'test', command: 'pnpm test', mode: 'command' }]),
    );

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/applyScriptDefinitionChangesRequested',
        payload: [
          'ws-1',
          expect.objectContaining({ add: [] }),
          [offPage],
          expect.any(Object),
          expect.any(String),
        ],
      }),
    );
  });

  it('still launches agent detection when the context inventory read fails', async () => {
    vi.mocked(scriptsClient.list).mockResolvedValueOnce({ success: false, error: 'List failed' });
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Detect with AI' }));

    await waitFor(() =>
      expect(mockExecute).toHaveBeenCalledWith(
        activeWorkspaceState.value,
        expect.objectContaining({ message: expect.stringContaining('Read package.json') }),
      ),
    );
  });

  it('captures full definitions for detection Undo even when the visible rows are previews', async () => {
    const full = {
      id: 'old',
      name: 'test',
      command: 'complete command beyond the preview',
      mode: 'command',
      cwd: 'app',
      env: { KEY: 'value' },
      runtime: { status: 'idle' },
    };
    scriptEntries.value = [
      {
        id: full.id,
        name: full.name,
        mode: full.mode,
        commandPreview: 'complete',
        commandTruncated: true,
        runtime: full.runtime,
      },
    ];
    vi.mocked(scriptsClient.list).mockResolvedValueOnce({ success: true, data: [full as never] });
    mockScriptCreate.mockResolvedValueOnce({ success: true, data: { id: 'new-command' } });
    asyncActionHandlers.apply = (action) =>
      action.success({
        detected: 0,
        added: 1,
        updated: 0,
        removed: 0,
        skippedRunning: [],
        snapshot: [full],
      });
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    await fireEvent.click(screen.getByTitle('Scan local project files for scripts'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Agent assist' }));
    await waitFor(() => expect(mockExecute).toHaveBeenCalledOnce());
    await backgroundAgentOptions.value!.onResult(
      JSON.stringify({ add: [{ name: 'lint', command: 'pnpm lint', mode: 'command' }] }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/applyScriptDefinitionChangesRequested',
        payload: [
          'ws-1',
          expect.any(Object),
          [full],
          expect.objectContaining({ resourceId: 'agent-detection' }),
          expect.any(String),
        ],
      }),
    );
    await notify.success.mock.calls[0][1].action.onClick();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/restoreScriptDefinitionsRequested',
        payload: [
          'ws-1',
          [expect.objectContaining({ command: full.command, cwd: full.cwd, env: full.env })],
          expect.objectContaining({ resourceId: 'restore' }),
        ],
      }),
    );
  });

  it.each(['switch', 'unmount'] as const)(
    'releases a pending detection batch on workspace %s without stale fallback',
    async (lifecycle) => {
      let reject!: (error: Error) => void;
      asyncActionHandlers.apply = (action) => {
        reject = action.failure;
      };
      const full = {
        id: 'off-page',
        workspaceId: 'ws-a',
        name: 'Build',
        command: 'pnpm build',
        mode: 'command',
        source: 'auto-detected',
        createdAt: '2026-10-09',
        runtime: { status: 'idle', restartCount: 0 },
      };
      vi.mocked(scriptsClient.list).mockResolvedValueOnce({ success: true, data: [full] as never });
      scriptEntries.byWorkspaceId['ws-a'] = [full];
      const view = render(TerminalSidebar, { props: { workspaceId: 'ws-a' } });
      const detection = backgroundAgentOptions.value!.onResult(
        JSON.stringify({ remove: [full.id] }),
      );
      await waitFor(() =>
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'scripts/applyScriptDefinitionChangesRequested',
            payload: [
              'ws-a',
              expect.any(Object),
              undefined,
              expect.objectContaining({ resourceId: 'agent-detection' }),
              expect.any(String),
            ],
          }),
        ),
      );

      if (lifecycle === 'switch') await view.rerender({ workspaceId: 'ws-b' });
      else view.unmount();

      const request = mockDispatch.mock.calls.find(
        ([action]) => action.type === 'scripts/applyScriptDefinitionChangesRequested',
      )![0];
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/workflowReleased',
          payload: ['ws-a', request.payload[3].consumerId],
        }),
      );
      reject(new Error('Applying script changes cancelled'));
      await detection;
      expect(notify.info).not.toHaveBeenCalled();
      expect(mockDetect).not.toHaveBeenCalled();
    },
  );

  it.each(['saved', 'oneOff', undefined] as const)(
    'restores %s purpose when undo recreates a definition',
    async (purpose) => {
      scriptEntries.value = [
        {
          id: 'old',
          name: 'test',
          command: 'pnpm test',
          mode: 'command',
          purpose,
          runtime: { status: 'idle' },
        },
      ];
      render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
      await backgroundAgentOptions.value!.onResult(
        JSON.stringify({ add: [{ name: 'lint', command: 'pnpm lint', mode: 'command' }] }),
      );
      await notify.success.mock.calls[0][1].action.onClick();
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/restoreScriptDefinitionsRequested',
          payload: [
            'ws-1',
            [expect.objectContaining({ name: 'test', purpose })],
            expect.objectContaining({ resourceId: 'restore' }),
          ],
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
    expect(mockExecute).not.toHaveBeenCalled();
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

    await fireEvent.contextMenu(screen.getByRole('button', { name: /^Script B(?:\s|$)/ }));
    await fireEvent.click(screen.getByText('Delete'));

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/deleteScriptRequested',
          payload: ['ws-b', 'script-b', expect.any(String)],
        }),
      ),
    );
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

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/applyScriptDefinitionChangesRequested',
        payload: [
          'ws-1',
          {
            add: [
              expect.objectContaining({ name: 'lint', command: 'pnpm lint', purpose: 'saved' }),
            ],
            update: [
              { id: 'auto-running', updates: { command: 'pnpm dev --host' } },
              { id: 'auto-idle', updates: { command: 'pnpm build --clean' } },
            ],
            remove: ['auto-stale'],
          },
          undefined,
          expect.objectContaining({ resourceId: 'agent-detection' }),
          expect.any(String),
        ],
      }),
    );
    expect(notify.warning).toHaveBeenCalledTimes(1);
    expect(notify.warning).toHaveBeenCalledWith(expect.stringContaining('"dev"'));
    expect(notify.success).toHaveBeenCalled();
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
