/**
 * Review fix from PR #705 (comment 3710192415): deleting the selected script
 * must clear the RAW selection in the store. The old code compared against
 * the validated `selectedScriptId` $derived AFTER dispatching removeScript —
 * by then the derived already reads null (script gone from the scripts
 * slice), so clearScriptSelection was skipped and a stale id stayed in
 * Redux/localStorage, logically holding the panel open with nothing
 * renderable.
 *
 * The store harness runs the REAL scripts + terminals reducers and
 * re-notifies selector subscribers on every dispatch, so the validated
 * derived goes null after removeScript exactly like production.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { ScriptWithState } from '$features/scripts/types';

const authority = vi.hoisted(() => ({ current: 'admitted' as string | null }));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActionContext: { select: () => authority.current },
}));

vi.mock('$store/renderer/store', async () => {
  const { scriptsReducer } = await import('$store/renderer/slices/scripts/scripts-slice');
  const { terminalsReducer } = await import('$store/renderer/slices/terminals/terminals-slice');
  let scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
  let terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
  let currentTabId: string | null = null;
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const subscribers = new Set<() => void>();
  const isReadable = (
    arg: unknown,
  ): arg is { subscribe: (l: (v: unknown) => void) => () => void } =>
    typeof arg === 'object' && arg !== null && typeof (arg as any).subscribe === 'function';
  const store: any = {
    get state() {
      return {
        tabState: { currentTabId },
        scripts: scriptsState,
        terminals: terminalsState,
      };
    },
    dispatch: (action: any) => {
      dispatched.push(action);
      scriptsState = scriptsReducer(scriptsState, action);
      terminalsState = terminalsReducer(terminalsState, action);
      for (const notify of subscribers) notify();
      return action;
    },
    createSelector: (fn: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => ({
          subscribe: (listener: (v: any) => void) => {
            // Like the real createSelector, unwrap readable-store args
            // (e.g. QuakeTerminalOverlay's workspaceIdStore) reactively.
            const values = args.map((arg) => (isReadable(arg) ? undefined : arg));
            const notify = () => listener(fn(store.state, ...values));
            const argUnsubs = args.map((arg, i) =>
              isReadable(arg)
                ? arg.subscribe((v: unknown) => {
                    values[i] = v;
                    notify();
                  })
                : null,
            );
            notify();
            subscribers.add(notify);
            return () => {
              subscribers.delete(notify);
              for (const unsub of argUnsubs) unsub?.();
            };
          },
        }),
        { select: fn },
      ),
    getReadableState: () => ({
      subscribe: (listener: (v: any) => void) => {
        const notify = () => listener(store.state);
        notify();
        subscribers.add(notify);
        return () => subscribers.delete(notify);
      },
    }),
    __dispatched: dispatched,
    __setCurrentTab: (id: string | null) => {
      currentTabId = id;
    },
    __reset: () => {
      scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
      terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
      currentTabId = null;
      dispatched.length = 0;
      subscribers.clear();
    },
  };
  return { store };
});

vi.mock('../Terminal.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../SetupScriptBanner.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../ScriptOutputViewer.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../TerminalSidebar.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});
vi.mock('$lib/components/ui/tooltip', async () => {
  const MockTooltip = (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'))
    .default;
  const MockTooltipRich = (
    await import('../../workspace/sidebar/__tests__/mocks/MockTooltipRich.svelte')
  ).default;
  return { Tooltip: MockTooltip, TooltipRich: MockTooltipRich, TooltipShortcut: MockTooltip };
});
vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('./mocks/MockButton.svelte')).default,
}));
vi.mock('$lib/client/live/backend-transport', async () => {
  const { appClient } = await import('$lib/client');
  return {
    backendRequest: vi.fn(async (_method: string, params: { workspaceId: string }) => {
      const { workspaceId, ...definition } = params;
      const result = await appClient.scripts.create(workspaceId, definition as never);
      if (!result.success) throw new Error(result.error);
      return result.script;
    }),
  };
});

vi.mock('$lib/client', () => ({
  appClient: { scripts: { list: vi.fn(), create: vi.fn() } },
}));
vi.mock('$features/scripts/scripts.client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$features/scripts/scripts.client')>();
  return {
    scriptsClient: { ...actual.scriptsClient, stop: vi.fn(), remove: vi.fn() },
  };
});
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { disposeTerminal: vi.fn(), clearTerminal: vi.fn() },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: { getLastCommand: () => null },
}));
const openUserTab = vi.fn();
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openUserTab }),
}));

import { confirm } from '$lib/components/patterns/confirm';
import { notify } from '$lib/components/patterns/notify';
import QuakeTerminalOverlay from '../QuakeTerminalOverlay.svelte';
import { fireEvent, screen } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { scriptsClient } from '$features/scripts/scripts.client';
import {
  setScriptsData,
  removeScript,
  startScriptRequested,
  updateRuntimeState,
  setScriptsInitialized,
} from '$store/renderer/slices/scripts/scripts-slice';
import {
  addTerminal,
  openTerminalOverlay,
  selectScript,
} from '$store/renderer/slices/terminals/terminals-slice';
import { appClient } from '$lib/client';

import { warmImport } from '../../../../test/warm-import';

const WS_A = 'ws-a' as WorkspaceId;

function makeScript(id: string, wsId: string): ScriptWithState {
  return {
    id,
    workspaceId: wsId,
    name: `script-${id}`,
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    runtime: { status: 'idle', exitCode: null, restartCount: 0 },
  };
}

function seedWorkspace(wsId: string, scriptIds: string[], selectedId: string) {
  appStore.dispatch(
    setScriptsData(
      wsId,
      scriptIds.map((id) => makeScript(id, wsId)),
    ),
  );
  appStore.dispatch(setScriptsInitialized(wsId, true));
  appStore.dispatch(selectScript(wsId, selectedId));
}

function rawSelectedScriptId(wsId: string): string | null {
  return (appStore as any).state.terminals.workspaces[wsId]?.selectedScriptId ?? null;
}

function dispatchedTypes(): string[] {
  return (appStore as any).__dispatched.map((action: { type: string }) => action.type);
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltipRich.svelte'));
warmImport(() => import('./mocks/MockButton.svelte'));

describe('QuakeTerminalOverlay delete script (PR #705 review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authority.current = 'admitted';
    vi.mocked(confirm).mockResolvedValue(true);
    (appStore as any).__reset();
  });

  it('routes stop through the shared operation and retains the selected script', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    seedWorkspace(WS_A, ['script-1'], 'script-1');
    const { component } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await (component as any).handleScriptAction('stop', 'script-1');
    expect((appStore as any).__dispatched).toContainEqual(
      expect.objectContaining({
        type: 'scripts/stopScriptRequested',
        payload: [WS_A, 'script-1', expect.any(String)],
      }),
    );
    expect(scriptsClient.stop).not.toHaveBeenCalled();
    expect(rawSelectedScriptId(WS_A)).toBe('script-1');
    expect(dispatchedTypes()).not.toContain('scripts/refreshScripts');
  });

  it('clears the raw store selection when the selected script is deleted', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    seedWorkspace(WS_A, ['script-1'], 'script-1');
    expect(rawSelectedScriptId(WS_A)).toBe('script-1');

    const { component } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await (component as any).handleScriptAction('delete', 'script-1');

    expect(dispatchedTypes()).toContain('scripts/deleteScriptRequested');
    appStore.dispatch(removeScript(WS_A, 'script-1'));
    expect(dispatchedTypes()).toContain('scripts/removeScript');
    expect(rawSelectedScriptId(WS_A)).toBeNull();
  });

  it('keeps the selection when a different script is deleted', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    seedWorkspace(WS_A, ['script-1', 'script-2'], 'script-1');

    const { component } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await (component as any).handleScriptAction('delete', 'script-2');

    appStore.dispatch(removeScript(WS_A, 'script-2'));
    expect(dispatchedTypes()).not.toContain('terminals/clearScriptSelection');
    expect(rawSelectedScriptId(WS_A)).toBe('script-1');
  });
});

describe('confirmed script deletion controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authority.current = 'admitted';
    vi.mocked(confirm).mockResolvedValue(true);
    (appStore as any).__reset();
    seedWorkspace(WS_A, ['script-1', 'script-2'], 'script-1');
    appStore.dispatch(openTerminalOverlay(WS_A));
  });

  it('names the script and cancellation sends no deletion request', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete script' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('script-script-1'),
        destructive: true,
      }),
    );
    expect(dispatchedTypes()).not.toContain('scripts/deleteScriptRequested');
    expect(rawSelectedScriptId(WS_A)).toBe('script-1');
  });

  it.each(['running', 'starting', 'restarting', 'unknown', undefined])(
    'disables deletion for %s',
    async (status) => {
      appStore.dispatch(updateRuntimeState(WS_A, 'script-1', { status: status as never }));
      render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
      expect(
        (screen.getByRole('button', { name: 'Delete script' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it('disables deletion while a lifecycle request is pending', () => {
    appStore.dispatch(startScriptRequested(WS_A, 'script-1'));
    render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    expect(
      (screen.getByRole('button', { name: 'Delete script' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each(['runtime', 'pending', 'selection', 'workspace', 'removed', 'renamed', 'unmounted'])(
    'rechecks %s after confirmation opens',
    async (change) => {
      let accept!: (value: boolean) => void;
      vi.mocked(confirm).mockReturnValue(
        new Promise((resolve) => {
          accept = resolve;
        }),
      );
      const view = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
      await fireEvent.click(screen.getByRole('button', { name: 'Delete script' }));
      if (change === 'runtime')
        appStore.dispatch(updateRuntimeState(WS_A, 'script-1', { status: 'running' }));
      if (change === 'pending') appStore.dispatch(startScriptRequested(WS_A, 'script-1'));
      if (change === 'selection') appStore.dispatch(selectScript(WS_A, 'script-2'));
      if (change === 'workspace') await view.rerender({ workspaceId: 'ws-b' as WorkspaceId });
      if (change === 'removed') appStore.dispatch(removeScript(WS_A, 'script-1'));
      if (change === 'renamed')
        appStore.dispatch(
          setScriptsData(WS_A, [{ ...makeScript('script-1', WS_A), name: 'replacement' }]),
        );
      if (change === 'unmounted') view.unmount();
      accept(true);
      await waitFor(() => expect(notify.error).toHaveBeenCalled());
      expect(dispatchedTypes()).not.toContain('scripts/deleteScriptRequested');
      expect(scriptsClient.remove).not.toHaveBeenCalled();
    },
  );

  it.each(['idle', 'exited'] as const)(
    'requests deletion for %s from the visible header button',
    async (status) => {
      appStore.dispatch(updateRuntimeState(WS_A, 'script-1', { status }));
      render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
      await fireEvent.click(screen.getByRole('button', { name: 'Delete script' }));
      await waitFor(() => expect(dispatchedTypes()).toContain('scripts/deleteScriptRequested'));
    },
  );
});

describe('QuakeTerminalOverlay script selection (intent-hq/monorepo#2236 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authority.current = 'admitted';
    vi.mocked(confirm).mockResolvedValue(true);
    (appStore as any).__reset();
  });

  it('dispatches terminals/selectScript when a running script tab is clicked', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    const script: ScriptWithState = {
      ...makeScript('script-1', WS_A),
      runtime: { status: 'running', exitCode: null, restartCount: 0 },
    };
    appStore.dispatch(setScriptsData(WS_A, [script]));
    appStore.dispatch(setScriptsInitialized(WS_A, true));
    expect(rawSelectedScriptId(WS_A)).toBeNull();

    render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });

    // The running script renders as a tab in the always-visible bottom bar;
    // clicking it goes through setSelectedScript() -> selectScript(), the
    // import dropped by PR #1031 (ReferenceError before the fix).
    const tab = screen.getByRole('tab');
    await fireEvent.click(tab);

    expect(dispatchedTypes()).toContain('terminals/selectScript');
    expect(rawSelectedScriptId(WS_A)).toBe('script-1');
  });
});

describe('QuakeTerminalOverlay move to panel (intent-hq/intent#4436)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authority.current = 'admitted';
    vi.mocked(confirm).mockResolvedValue(true);
    (appStore as any).__reset();
  });

  function workspaceState(wsId: string) {
    return (appStore as any).state.terminals.workspaces[wsId];
  }

  it('records panel placement for the active terminal and closes the overlay', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    appStore.dispatch(setScriptsData(WS_A, []));
    appStore.dispatch(setScriptsInitialized(WS_A, true));
    appStore.dispatch(addTerminal(WS_A, 'term-1'));
    appStore.dispatch(openTerminalOverlay(WS_A, 'term-1'));
    expect(workspaceState(WS_A).placements).toEqual({ 'term-1': 'overlay' });

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await fireEvent.click(container.querySelector('[data-move-to-panel]')!);

    expect(openUserTab).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal', terminalId: 'term-1', workspaceId: WS_A }),
    );
    expect(workspaceState(WS_A).placements).toEqual({ 'term-1': 'panel' });
    expect(workspaceState(WS_A).isOpen).toBe(false);
  });

  it('records panel placement for the selected script and closes the overlay', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    appStore.dispatch(addTerminal(WS_A, 'term-1'));
    seedWorkspace(WS_A, ['script-1'], 'script-1');
    appStore.dispatch(openTerminalOverlay(WS_A));
    expect(workspaceState(WS_A).placements).toEqual({ 'script-1': 'overlay' });

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await fireEvent.click(container.querySelector('[data-move-to-panel]')!);

    expect(openUserTab).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal', scriptId: 'script-1', workspaceId: WS_A }),
    );
    expect(workspaceState(WS_A).placements).toEqual({ 'script-1': 'panel' });
    expect(workspaceState(WS_A).isOpen).toBe(false);
  });
});

describe('script definition and authority races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authority.current = 'admitted';
    vi.mocked(confirm).mockResolvedValue(true);
    (appStore as any).__reset();
    seedWorkspace(WS_A, ['script-1'], 'script-1');
    appStore.dispatch(openTerminalOverlay(WS_A));
    vi.mocked(appClient.scripts.list).mockResolvedValue([makeScript('script-1', WS_A)]);
  });

  it.each(['name', 'command'])('blocks deletion throughout a deferred %s save', async (field) => {
    let finish!: (result: { success: boolean }) => void;
    vi.mocked(appClient.scripts.create).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(QuakeTerminalOverlay, { workspaceId: WS_A });
    if (field === 'name') {
      await fireEvent.click(screen.getByTitle('Click to rename script'));
      const input = view.container.querySelector('[data-edit-script-header-name]')!;
      await fireEvent.input(input, { target: { value: 'Renamed' } });
      await fireEvent.blur(input);
    } else {
      await fireEvent.click(screen.getByRole('button', { name: 'Edit command' }));
      await fireEvent.input(screen.getByPlaceholderText('npm run dev'), {
        target: { value: 'make check' },
      });
      await fireEvent.keyDown(screen.getByPlaceholderText('npm run dev'), {
        key: 's',
        ctrlKey: true,
      });
    }
    await waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
    expect(
      (screen.getByRole('button', { name: 'Delete script' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    finish({ success: true });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Delete script' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it.each([false, true])(
    'releases the delete button after a direct save fails (throw: %s)',
    async (throws) => {
      let finish!: () => void;
      vi.mocked(appClient.scripts.create).mockReturnValueOnce(
        new Promise((resolve, reject) => {
          finish = () =>
            throws ? reject(new Error('offline')) : resolve({ success: false, error: 'offline' });
        }),
      );
      render(QuakeTerminalOverlay, { workspaceId: WS_A });
      const saved = scriptsClient.update(WS_A, 'script-1', { name: 'Renamed' });
      const result = saved.catch((error: Error) => ({ success: false, error: error.message }));
      await waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
      expect(
        (screen.getByRole('button', { name: 'Delete script' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      finish();
      expect(await result).toEqual({ success: false, error: 'offline' });
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Delete script' }) as HTMLButtonElement).disabled,
        ).toBe(false),
      );
    },
  );

  it('rejects a save started while confirmation is open', async () => {
    let accept!: (value: boolean) => void;
    let finish!: (result: { success: boolean }) => void;
    vi.mocked(confirm).mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      }),
    );
    vi.mocked(appClient.scripts.create).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(QuakeTerminalOverlay, { workspaceId: WS_A });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete script' }));
    await fireEvent.click(screen.getByTitle('Click to rename script'));
    const input = view.container.querySelector('[data-edit-script-header-name]')!;
    await fireEvent.input(input, { target: { value: 'Renamed' } });
    await fireEvent.blur(input);
    accept(true);
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(dispatchedTypes()).not.toContain('scripts/deleteScriptRequested');
    finish({ success: true });
  });

  it('reports missing authority before opening a confirmation', async () => {
    authority.current = null;
    render(QuakeTerminalOverlay, { workspaceId: WS_A });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete script' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
    expect(dispatchedTypes()).not.toContain('scripts/deleteScriptRequested');
  });

  it.each([null, 'new-admission'])(
    'rejects authority changed to %s during confirmation',
    async (next) => {
      let accept!: (value: boolean) => void;
      vi.mocked(confirm).mockReturnValue(
        new Promise((resolve) => {
          accept = resolve;
        }),
      );
      render(QuakeTerminalOverlay, { workspaceId: WS_A });
      await fireEvent.click(screen.getByRole('button', { name: 'Delete script' }));
      authority.current = next;
      accept(true);
      await waitFor(() => expect(notify.error).toHaveBeenCalled());
      expect(dispatchedTypes()).not.toContain('scripts/deleteScriptRequested');
      expect(rawSelectedScriptId(WS_A)).toBe('script-1');
    },
  );
});
