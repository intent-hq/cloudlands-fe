/**
 * Regression tests for intent-hq/monorepo#1330 (scripts variant).
 *
 * The overlay's script-init $effect used to dispatch disposeScripts(workspaceId)
 * in its cleanup, wiping the workspace's script definitions, runtime state and
 * output buffers on every unmount / workspace switch. Because `workspaceId` is
 * a $derived, the cleanup could even read the NEW workspace id on an A→B switch
 * and dispose B's freshly hydrated state — making script tabs disappear.
 *
 * These tests render the overlay against a store harness backed by the REAL
 * scriptsReducer and assert the scripts state survives unmount and switches.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { ScriptWithState } from '$features/scripts/types';

vi.mock('$store/renderer/store', async () => {
  const { scriptsReducer } = await import('$store/renderer/slices/scripts/scripts-slice');
  let scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
  let activeWorkspaceId: string | null = null;
  const store: any = {
    get state() {
      return {
        workspace: { activeWorkspaceId },
        scripts: scriptsState,
        terminals: { height: 30, workspaces: {} },
      };
    },
    dispatch: (action: any) => {
      scriptsState = scriptsReducer(scriptsState, action);
      return action;
    },
    createSelector: (fn: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => ({
          subscribe: (listener: (v: any) => void) => {
            listener(fn(store.state, ...args));
            return () => {};
          },
        }),
        { select: fn },
      ),
    getReadableState: () => ({
      subscribe: (listener: (v: any) => void) => {
        listener(store.state);
        return () => {};
      },
    }),
    __setActiveWorkspace: (id: string | null) => {
      activeWorkspaceId = id;
    },
    __reset: () => {
      scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
      activeWorkspaceId = null;
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
    remove: vi.fn(),
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
import {
  setScriptsData,
  setScriptsInitialized,
  appendScriptOutput,
} from '$store/renderer/slices/scripts/scripts-slice';
import { warmImport } from '../../../../test/warm-import';

const WS_A = 'ws-a' as WorkspaceId;
const WS_B = 'ws-b' as WorkspaceId;

function makeScript(id: string, wsId: string): ScriptWithState {
  return {
    id,
    workspaceId: wsId,
    name: `script-${id}`,
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    runtime: { status: 'running', pid: 123, exitCode: null, restartCount: 0 },
  };
}

function seedWorkspace(wsId: string, scriptId: string) {
  appStore.dispatch(setScriptsData(wsId, [makeScript(scriptId, wsId)]));
  appStore.dispatch(setScriptsInitialized(wsId, true));
  appStore.dispatch(
    appendScriptOutput(wsId, scriptId, {
      text: `output for ${scriptId}\n`,
      timestamp: '2026-01-01T00:00:01.000Z',
    }),
  );
}

function wsState(wsId: string) {
  return (appStore as any).state.scripts.byWorkspaceId[wsId];
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltipRich.svelte'));
warmImport(() => import('./mocks/MockButton.svelte'));

describe('QuakeTerminalOverlay scripts persistence (monorepo#1330)', () => {
  beforeEach(() => {
    (appStore as any).__reset();
  });

  it('keeps script state and output buffers after the overlay unmounts', () => {
    (appStore as any).__setActiveWorkspace(WS_A);
    seedWorkspace(WS_A, 'script-1');

    const { unmount } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    unmount();

    const ws = wsState(WS_A);
    expect(ws).toBeDefined();
    expect(Object.keys(ws.scripts)).toEqual(['script-1']);
    expect(ws.scripts['script-1'].runtime.status).toBe('running');
    expect(ws.outputBuffers['script-1'].chunks).toHaveLength(1);
    expect(ws.initialized).toBe(true);
  });

  it('keeps both workspaces intact when switching the workspaceId prop', async () => {
    (appStore as any).__setActiveWorkspace(WS_A);
    seedWorkspace(WS_A, 'script-a');
    seedWorkspace(WS_B, 'script-b');

    const { rerender } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    (appStore as any).__setActiveWorkspace(WS_B);
    await rerender({ workspaceId: WS_B });

    for (const [wsId, scriptId] of [
      [WS_A, 'script-a'],
      [WS_B, 'script-b'],
    ] as const) {
      const ws = wsState(wsId);
      expect(ws, `workspace ${wsId} state should survive the switch`).toBeDefined();
      expect(Object.keys(ws.scripts)).toEqual([scriptId]);
      expect(ws.outputBuffers[scriptId].chunks).toHaveLength(1);
      expect(ws.initialized).toBe(true);
    }
  });
});
