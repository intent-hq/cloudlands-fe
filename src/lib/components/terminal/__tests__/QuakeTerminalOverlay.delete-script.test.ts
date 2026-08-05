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
import { render } from '@testing-library/svelte';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { ScriptWithState } from '$features/scripts/types';

vi.mock('$store/renderer/store', async () => {
  const { scriptsReducer } = await import('$store/renderer/slices/scripts/scripts-slice');
  const { terminalsReducer } = await import('$store/renderer/slices/terminals/terminals-slice');
  let scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
  let terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
  let activeWorkspaceId: string | null = null;
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const subscribers = new Set<() => void>();
  const store: any = {
    get state() {
      return {
        workspace: { activeWorkspaceId },
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
            const notify = () => listener(fn(store.state, ...args));
            notify();
            subscribers.add(notify);
            return () => subscribers.delete(notify);
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
    __setActiveWorkspace: (id: string | null) => {
      activeWorkspaceId = id;
    },
    __reset: () => {
      scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
      terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
      activeWorkspaceId = null;
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
vi.mock('$features/scripts/scripts.client', () => ({
  scriptsClient: {
    detect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(),
  },
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { disposeTerminal: vi.fn(), clearTerminal: vi.fn() },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: { getLastCommand: () => null },
}));

import QuakeTerminalOverlay from '../QuakeTerminalOverlay.svelte';
import { store as appStore } from '$store/renderer/store';
import { scriptsClient } from '$features/scripts/scripts.client';
import {
  setScriptsData,
  setScriptsInitialized,
} from '$store/renderer/slices/scripts/scripts-slice';
import { selectScript } from '$store/renderer/slices/terminals/terminals-slice';
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
  appStore.dispatch(setScriptsData(wsId, scriptIds.map((id) => makeScript(id, wsId))));
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
    (appStore as any).__reset();
  });

  it('clears the raw store selection when the selected script is deleted', async () => {
    (appStore as any).__setActiveWorkspace(WS_A);
    seedWorkspace(WS_A, ['script-1'], 'script-1');
    expect(rawSelectedScriptId(WS_A)).toBe('script-1');

    const { component } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await (component as any).handleScriptAction('delete', 'script-1');

    expect(scriptsClient.remove).toHaveBeenCalledWith(WS_A, 'script-1');
    expect(dispatchedTypes()).toContain('scripts/removeScript');
    expect(dispatchedTypes()).toContain('terminals/clearScriptSelection');
    expect(rawSelectedScriptId(WS_A)).toBeNull();
  });

  it('keeps the selection when a different script is deleted', async () => {
    (appStore as any).__setActiveWorkspace(WS_A);
    seedWorkspace(WS_A, ['script-1', 'script-2'], 'script-1');

    const { component } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    await (component as any).handleScriptAction('delete', 'script-2');

    expect(dispatchedTypes()).not.toContain('terminals/clearScriptSelection');
    expect(rawSelectedScriptId(WS_A)).toBe('script-1');
  });
});
