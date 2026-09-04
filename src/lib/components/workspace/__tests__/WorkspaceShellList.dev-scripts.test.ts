/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ScriptOperationState,
  ScriptWithState,
} from '$store/renderer/slices/scripts/scripts-types';
import type { TerminalTab } from '$store/renderer/slices/terminals/terminals-slice';

const mocks = vi.hoisted(() => {
  const openUserTab = vi.fn();
  return {
    dispatch: vi.fn(),
    openUserTab,
    getPanelLayoutManager: vi.fn(() => ({ openUserTab })),
    scripts: {} as Record<string, ScriptWithState[]>,
    operations: {} as Record<string, Record<string, ScriptOperationState>>,
    terminals: {} as Record<string, TerminalTab[]>,
    terminalStates: {} as Record<
      string,
      {
        isOpen: boolean;
        activeTerminalId: string | null;
        selectedScriptId: string | null;
      }
    >,
  };
});

function workspaceReadable<T>(resolve: (workspaceId: string) => T) {
  return (workspaceIdStore: { subscribe: (run: (value: string) => void) => () => void }) => ({
    subscribe(run: (value: T) => void) {
      return workspaceIdStore.subscribe((workspaceId) => run(resolve(workspaceId)));
    },
  });
}

function workspaceSelector<T>(resolve: (workspaceId: string) => T) {
  return Object.assign(workspaceReadable(resolve), {
    select: (_state: unknown, workspaceId: string) => resolve(workspaceId),
  });
}

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => ({
  selectWorkspaceScriptEntries: workspaceReadable(
    (workspaceId) => mocks.scripts[workspaceId] ?? [],
  ),
  selectWorkspaceScriptOperations: workspaceReadable(
    (workspaceId) => mocks.operations[workspaceId] ?? {},
  ),
}));

vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectActiveTerminalIdForWorkspace: workspaceReadable(
    (workspaceId) => mocks.terminalStates[workspaceId]?.activeTerminalId ?? null,
  ),
  selectTerminalsForWorkspace: workspaceReadable(
    (workspaceId) => mocks.terminals[workspaceId] ?? [],
  ),
  selectWorkspaceTerminalState: workspaceSelector(
    (workspaceId) =>
      mocks.terminalStates[workspaceId] ?? {
        isOpen: false,
        activeTerminalId: null,
        selectedScriptId: null,
      },
  ),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: mocks.getPanelLayoutManager,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../sidebar/__tests__/mocks/Fa.svelte')).default,
}));

import WorkspaceShellList from '../WorkspaceShellList.svelte';

const WS = 'ws-a';

function script(
  id: string,
  name: string,
  status: ScriptWithState['runtime']['status'],
): ScriptWithState {
  return {
    id,
    workspaceId: WS,
    name,
    command: `pnpm ${id}`,
    mode: status === 'running' ? 'service' : 'command',
    category: 'dev',
    source: 'user',
    createdAt: '2026-08-14T00:00:00.000Z',
    runtime: { status, restartCount: 0 },
  };
}

describe('WorkspaceShellList development script controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scripts = {};
    mocks.operations = {};
    mocks.terminals = {};
    mocks.terminalStates = {};
  });

  it('renders truthful empty shell states', () => {
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    expect(screen.getByText('No terminals open')).toBeTruthy();
    expect(
      screen.getByText('No scripts found. Add one manually or use AI detection.'),
    ).toBeTruthy();
  });

  it('opens the selected terminal in a panel and closes its bottom overlay', async () => {
    mocks.terminals[WS] = [{ id: 'terminal-1', name: 'Build shell', workspaceId: WS }];
    mocks.terminalStates[WS] = {
      isOpen: true,
      activeTerminalId: 'terminal-1',
      selectedScriptId: null,
    };
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    const row = document.querySelector('[data-sidebar-shell-terminal="terminal-1"]') as HTMLElement;
    await fireEvent.click(within(row).getByRole('button', { name: 'Show in a panel' }));

    expect(mocks.getPanelLayoutManager).toHaveBeenCalledWith(WS);
    expect(mocks.openUserTab).toHaveBeenCalledWith({
      type: 'terminal',
      title: 'Build shell',
      terminalId: 'terminal-1',
      workspaceId: WS,
      closable: true,
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'terminals/close',
      payload: [WS],
    });
  });

  it('keeps an unrelated bottom overlay open when opening a terminal panel', async () => {
    mocks.terminals[WS] = [{ id: 'terminal-1', name: 'Build shell', workspaceId: WS }];
    mocks.terminalStates[WS] = {
      isOpen: true,
      activeTerminalId: 'terminal-1',
      selectedScriptId: 'script-2',
    };
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    const row = document.querySelector('[data-sidebar-shell-terminal="terminal-1"]') as HTMLElement;
    await fireEvent.click(within(row).getByRole('button', { name: 'Show in a panel' }));

    expect(mocks.openUserTab).toHaveBeenCalledWith(
      expect.objectContaining({ terminalId: 'terminal-1' }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminals/close' }),
    );
  });

  it('opens the selected script in a panel and closes its bottom overlay', async () => {
    mocks.scripts[WS] = [script('script-1', 'Dev server', 'running')];
    mocks.terminalStates[WS] = {
      isOpen: true,
      activeTerminalId: null,
      selectedScriptId: 'script-1',
    };
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    const row = document.querySelector('[data-sidebar-shell-script="script-1"]') as HTMLElement;
    await fireEvent.click(within(row).getByRole('button', { name: 'Show in a panel' }));

    expect(mocks.getPanelLayoutManager).toHaveBeenCalledWith(WS);
    expect(mocks.openUserTab).toHaveBeenCalledWith({
      type: 'terminal',
      title: 'Dev server',
      scriptId: 'script-1',
      workspaceId: WS,
      closable: true,
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'terminals/close',
      payload: [WS],
    });
  });

  it('keeps an unrelated bottom overlay open when opening a script panel', async () => {
    mocks.scripts[WS] = [script('script-1', 'Dev server', 'running')];
    mocks.terminalStates[WS] = {
      isOpen: true,
      activeTerminalId: null,
      selectedScriptId: 'script-2',
    };
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    const row = document.querySelector('[data-sidebar-shell-script="script-1"]') as HTMLElement;
    await fireEvent.click(within(row).getByRole('button', { name: 'Show in a panel' }));

    expect(mocks.openUserTab).toHaveBeenCalledWith(
      expect.objectContaining({ scriptId: 'script-1' }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminals/close' }),
    );
  });

  it('keeps compact one-line rows and maps runtime state to icon controls', () => {
    const longName = 'A very long script name that must truncate before the action controls';
    mocks.scripts[WS] = [
      script('idle', longName, 'idle'),
      script('running', 'Dev server', 'running'),
      script('exited', 'Build', 'exited'),
      script('restarting', 'Worker', 'restarting'),
    ];
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    const rows = Array.from(document.querySelectorAll('[data-sidebar-shell-script]'));
    expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute('data-sidebar-shell-script')).toBe('running');
    expect(rows[1].getAttribute('data-sidebar-shell-script')).toBe('restarting');
    expect(screen.queryByText('pnpm idle')).toBeNull();

    const idleRow = document.querySelector('[data-sidebar-shell-script="idle"]') as HTMLElement;
    const runningRow = document.querySelector(
      '[data-sidebar-shell-script="running"]',
    ) as HTMLElement;
    expect(within(idleRow).getByText(longName).className).toContain('truncate');
    expect(within(idleRow).getByText('Idle')).toBeTruthy();
    expect(within(idleRow).getByRole('button', { name: `Start ${longName}` })).toBeTruthy();
    expect(within(runningRow).getByText('Running')).toBeTruthy();
    expect(within(runningRow).getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(within(runningRow).getByRole('button', { name: 'Restart Dev server' })).toBeTruthy();
    expect(runningRow.className).toContain('h-8');
    expect(runningRow.className).toContain('px-0');
    expect(runningRow.parentElement?.className).toContain('gap-0');
    expect(runningRow.querySelector('[data-script-status-indicator]')).toBeTruthy();
    const actionStrip = runningRow.querySelector('[data-script-actions]') as HTMLElement;
    expect(actionStrip.className).toContain('rounded-md');
    expect(actionStrip.className).toContain('bg-secondary/80');
    expect(actionStrip.className).toContain('px-1');
    const actionButtons = Array.from(actionStrip.querySelectorAll('[data-slot="button"]'));
    expect(actionButtons).toHaveLength(2);
    for (const button of actionButtons) {
      expect(button.className).toContain('size-7');
      expect(button.className).toContain('bg-transparent');
      expect(button.className).toContain('focus-visible:ring-2');
      expect(button.className).toContain('active:bg-accent/80');
    }
    expect(within(runningRow).getByRole('button', { name: 'Stop' }).className).toContain(
      'text-danger',
    );
    expect(
      within(runningRow).getByRole('button', { name: 'Dev server Running' }).className,
    ).toContain('items-center');
  });

  it('dispatches start, stop, and restart without opening the script overlay', async () => {
    mocks.scripts[WS] = [script('idle', 'Build', 'idle'), script('running', 'Dev', 'running')];
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    await fireEvent.click(screen.getByRole('button', { name: 'Start Build' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Restart Dev' }));

    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'scripts/startScriptRequested', payload: [WS, 'idle'] },
      { type: 'scripts/stopScriptRequested', payload: [WS, 'running'] },
      { type: 'scripts/restartScriptRequested', payload: [WS, 'running'] },
    ]);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminals/open' }),
    );
  });

  it('keeps pending and failure state isolated by workspace', () => {
    mocks.scripts[WS] = [script('running', 'Dev', 'running')];
    mocks.operations[WS] = {
      running: { action: 'stop', pending: false, error: 'offline' },
    };
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    expect(screen.getByRole('alert', { name: 'Could not run Dev: offline' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText('offline')).toBeNull();
  });

  it('keeps pending controls disabled, busy, and geometrically stable', () => {
    mocks.scripts[WS] = [script('idle', 'Build', 'idle'), script('running', 'Dev', 'running')];
    mocks.operations[WS] = {
      idle: { action: 'start', pending: true },
      running: { action: 'restart', pending: true },
    };
    render(WorkspaceShellList, { props: { workspaceId: WS } });

    const start = screen.getByRole('button', { name: 'Start Build' }) as HTMLButtonElement;
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    const restart = screen.getByRole('button', { name: 'Restart Dev' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.getAttribute('aria-busy')).toBe('true');
    expect(stop.disabled).toBe(true);
    expect(stop.getAttribute('aria-busy')).toBeNull();
    expect(restart.disabled).toBe(true);
    expect(restart.getAttribute('aria-busy')).toBe('true');
    expect(start.className).toContain('size-7');
    expect(restart.className).toContain('size-7');
    expect(start.querySelector('.fa-icon')?.getAttribute('data-icon')).toBe('spinner');
    expect(restart.querySelector('.fa-icon')?.getAttribute('data-icon')).toBe('spinner');
  });
});
