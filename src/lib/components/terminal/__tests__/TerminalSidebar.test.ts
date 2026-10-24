import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch, scriptEntries, selectorWorkspaceArgs, asyncActionHandlers, notify } =
  vi.hoisted(() => ({
    mockDispatch: vi.fn(),
    scriptEntries: { value: [] as any[], byWorkspaceId: {} as Record<string, any[]> },
    selectorWorkspaceArgs: [] as unknown[],
    asyncActionHandlers: {
      reset: () => {},
      detect: null as ((action: any) => void) | null,
      remove: null as ((action: any) => void) | null,
    },
    notify: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
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
  asyncActionHandlers.reset = () => {
    scripts = scriptsReducer(undefined, { type: '@@init' });
  };
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
              : action.type === 'scripts/removeScriptDefinitionsRequested'
                ? payload[3]
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
          [
            ...new Set([
              'ws-1',
              ...Object.keys(scriptEntries.byWorkspaceId),
              ...Object.keys(scripts.byWorkspaceId),
            ]),
          ].map((id) => [
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
      } else if (action.type === 'scripts/removeScriptDefinitionsRequested') {
        if (asyncActionHandlers.remove) asyncActionHandlers.remove(action);
        else
          action.success({
            removed: action.payload[1].map((script: { id: string }) => script.id),
            failed: [],
          });
      } else if (action.type === 'scripts/detectScriptDefinitionsRequested') {
        action.success({ detected: 0, added: 0, updated: 0, removed: 0, skippedRunning: [] });
      } else if (action.type === 'scripts/saveScriptDefinitionsToRepoRequested') {
        action.success(undefined);
      }
      module.store.emitState();
    },
  });
  return module;
});
vi.mock('$lib/components/patterns/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/components/patterns/notify')>()),
  notify,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const MockButton = (await import('./mocks/MockButton.svelte')).default;
  return { default: MockButton };
});

import TerminalSidebar from '../TerminalSidebar.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  scriptDetectionRequested,
  scriptDetectionFinished,
  scriptWorkflowFinished,
  setScriptListState,
} from '$store/renderer/slices/scripts/scripts-slice';
import { warmImport } from '../../../../test/warm-import';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockButton.svelte'));

beforeEach(() => {
  vi.clearAllMocks();
  asyncActionHandlers.reset();
  scriptEntries.value = [];
  Element.prototype.getAnimations = () => [];
  scriptEntries.byWorkspaceId = {};
  asyncActionHandlers.detect = null;
  asyncActionHandlers.remove = null;
  selectorWorkspaceArgs.length = 0;
});

describe('TerminalSidebar detection flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scriptEntries.value = [];
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

  it.each([false, true])('detects local scripts with existing scripts: %s', async (populated) => {
    if (populated) {
      scriptEntries.value = [
        {
          id: 'build',
          name: 'build',
          command: 'pnpm build',
          mode: 'command',
          source: 'user',
          runtime: { status: 'idle', exitCode: null },
        },
      ];
    }
    const requests: any[] = [];
    asyncActionHandlers.detect = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    const button = screen.getByRole('button', { name: 'Detect Scripts' });

    await fireEvent.click(button);
    await fireEvent.click(button);

    expect(requests).toHaveLength(1);
    expect(requests[0].payload).toEqual([
      'ws-1',
      expect.objectContaining({ resourceId: 'local-detection' }),
    ]);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    requests[0].success({ detected: 0, added: 0, updated: 0, removed: 0, skippedRunning: [] });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(notify.info).toHaveBeenCalledOnce();
    expect(notify.success).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'scripts/workflowConsumed',
        payload: ['ws-1', requests[0].payload[1].consumerId, requests[0].payload[1].requestId],
      }),
    );
  });

  it('reports detected scripts and permits another scan after completion', async () => {
    const requests: any[] = [];
    asyncActionHandlers.detect = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    const button = screen.getByRole('button', { name: 'Detect Scripts' });
    await fireEvent.click(button);
    requests[0].success({ detected: 2, added: 2, updated: 0, removed: 0, skippedRunning: [] });
    await waitFor(() => expect(notify.success).toHaveBeenCalledOnce());
    await fireEvent.click(button);
    expect(requests).toHaveLength(2);
    expect(requests[1].payload[1].requestId).not.toBe(requests[0].payload[1].requestId);
  });

  it('shows failure feedback and permits retry after a failed scan', async () => {
    const requests: any[] = [];
    asyncActionHandlers.detect = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    const button = screen.getByRole('button', { name: 'Detect Scripts' });
    await fireEvent.click(button);
    appStore.dispatch(
      scriptWorkflowFinished(
        'ws-1',
        requests[0].payload[1],
        'failure',
        undefined,
        'Scan unavailable',
      ),
    );
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Scan unavailable'));
    await fireEvent.click(button);
    expect(requests).toHaveLength(2);
  });

  it.each(['switch', 'unmount'] as const)(
    'releases a pending local scan on workspace %s and ignores its late result',
    async (lifecycle) => {
      const requests: any[] = [];
      asyncActionHandlers.detect = (action) => requests.push(action);
      const view = render(TerminalSidebar, { props: { workspaceId: 'ws-a' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Detect Scripts' }));
      const consumer = requests[0].payload[1];

      if (lifecycle === 'switch') await view.rerender({ workspaceId: 'ws-b' });
      else view.unmount();

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/workflowReleased',
          payload: ['ws-a', consumer.consumerId],
        }),
      );
      requests[0].success({ detected: 1, added: 1, updated: 0, removed: 0, skippedRunning: [] });
      if (lifecycle === 'switch') {
        await fireEvent.click(screen.getByRole('button', { name: 'Detect Scripts' }));
        expect(requests[1].payload[0]).toBe('ws-b');
      }
      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.info).not.toHaveBeenCalled();
    },
  );

  it('blocks local detection while another pane owns a scan and resumes when it finishes', async () => {
    const requests: any[] = [];
    asyncActionHandlers.detect = (action) => requests.push(action);
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    appStore.dispatch(scriptDetectionRequested('ws-1', 'another-pane'));
    const button = screen.getByRole('button', { name: 'Detect Scripts' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    await fireEvent.click(button);
    expect(requests).toHaveLength(0);
    appStore.dispatch(scriptDetectionFinished('ws-1', 'another-pane'));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(button);
    expect(requests).toHaveLength(1);
  });

  it('retries a failed list without misleading empty-state guidance', async () => {
    render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });
    appStore.dispatch(setScriptListState('ws-1', false, 'List unavailable'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('List unavailable'),
    );
    expect(screen.queryByText('No scripts detected yet')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'scripts/refreshScripts',
      payload: ['ws-1'],
    });
    appStore.dispatch(setScriptListState('ws-1', false));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
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
    const { rerender } = render(TerminalSidebar, { props: { workspaceId: 'ws-a' } });
    expect(screen.getByText('Script A')).toBeTruthy();

    await rerender({ workspaceId: 'ws-b' });

    await waitFor(() => {
      expect(screen.getByText('Script B')).toBeTruthy();
    });
    expect(screen.queryByText('Script A')).toBeNull();
    expect(selectorWorkspaceArgs).toHaveLength(1);
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
  });

  it('shows a prefilled rename input on double-click and restores the row on Escape', async () => {
    const { container } = render(TerminalSidebar, { props: { workspaceId: 'ws-1' } });

    await fireEvent.doubleClick(screen.getByRole('button', { name: /^build/ }));

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

    await fireEvent.doubleClick(screen.getByRole('button', { name: /^build/ }));
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
    await fireEvent.doubleClick(screen.getByRole('button', { name: /^build/ }));
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
    await fireEvent.doubleClick(screen.getByRole('button', { name: /^build/ }));
    const input = container.querySelector<HTMLInputElement>('[data-edit-script="script-1"]');
    await fireEvent.input(input!, { target: { value: '   ' } });

    await fireEvent.keyDown(input!, { key: 'Enter' });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/updateScriptDefinitionRequested' }),
    );
    expect(screen.getByText('build')).toBeTruthy();
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
