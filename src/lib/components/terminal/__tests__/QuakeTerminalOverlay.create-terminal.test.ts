/**
 * Review fixes from PR #705: `createNewTerminal` needs an in-flight guard
 * (a double-click must not spawn two daemon PTYs) and a workspace-still-
 * current check (a mid-create workspace switch must not mutate the departed
 * workspace's open/active state).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import type { WorkspaceId } from '$shared/types/branded-ids';

const clientMocks = vi.hoisted(() => ({
  mockTerminalsCreate: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    terminals: { create: clientMocks.mockTerminalsCreate },
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { scriptsReducer } = await import('$store/renderer/slices/scripts/scripts-slice');
  let scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
  let currentTabId: string | null = null;
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const store: any = {
    get state() {
      return {
        tabState: { currentTabId },
        scripts: scriptsState,
        terminals: { height: 30, workspaceHeights: {}, workspaces: {} },
      };
    },
    dispatch: (action: any) => {
      dispatched.push(action);
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
    __dispatched: dispatched,
    __setCurrentTab: (id: string | null) => {
      currentTabId = id;
    },
    __reset: () => {
      scriptsState = scriptsReducer(undefined, { type: '@@INIT' });
      currentTabId = null;
      dispatched.length = 0;
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
import { m } from '$shared/paraglide/messages.js';
import { warmImport } from '../../../../test/warm-import';

const WS_A = 'ws-a' as WorkspaceId;
const WS_B = 'ws-b' as WorkspaceId;

function dispatchedTypes(): string[] {
  return (appStore as any).__dispatched.map((action: { type: string }) => action.type);
}

function newTerminalButton(container: HTMLElement): HTMLElement {
  const button = container.querySelector(
    `[aria-label="${m.terminal_quakeOverlay_newTerminal_ariaLabel()}"]`,
  );
  if (!button) throw new Error('new-terminal button not found');
  return button as HTMLElement;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltipRich.svelte'));
warmImport(() => import('./mocks/MockButton.svelte'));

describe('QuakeTerminalOverlay createNewTerminal (PR #705 review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appStore as any).__reset();
  });

  it('issues a single terminal.create for a rapid double-click (in-flight guard)', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    let resolveCreate: (value: unknown) => void = () => {};
    clientMocks.mockTerminalsCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    const button = newTerminalButton(container);

    await fireEvent.click(button);
    await fireEvent.click(button);

    expect(clientMocks.mockTerminalsCreate).toHaveBeenCalledTimes(1);

    resolveCreate({ success: true, id: 'pty-1' });
    await waitFor(() => {
      expect(dispatchedTypes()).toContain('terminals/addTerminal');
    });
  });

  it('allows a new create after the previous one settles', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    clientMocks.mockTerminalsCreate.mockResolvedValue({ success: true, id: 'pty-1' });

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    const button = newTerminalButton(container);

    await fireEvent.click(button);
    await waitFor(() => {
      expect(dispatchedTypes()).toContain('terminals/addTerminal');
    });
    await fireEvent.click(button);

    await waitFor(() => {
      expect(clientMocks.mockTerminalsCreate).toHaveBeenCalledTimes(2);
    });
  });

  it('does not mutate the departed workspace after a mid-create switch', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    let resolveCreate: (value: unknown) => void = () => {};
    clientMocks.mockTerminalsCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    const { container, rerender } = render(QuakeTerminalOverlay, {
      props: { workspaceId: WS_A },
    });
    await fireEvent.click(newTerminalButton(container));
    expect(clientMocks.mockTerminalsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS_A }),
    );

    // Switch workspaces while the create is in flight.
    (appStore as any).__setCurrentTab(WS_B);
    await rerender({ workspaceId: WS_B });

    // The probe click below issues a fresh create; keep it pending so it can
    // never dispatch anything itself.
    clientMocks.mockTerminalsCreate.mockReturnValue(new Promise(() => {}));
    resolveCreate({ success: true, id: 'pty-1' });
    // Positive completion signal: the in-flight guard is only released in the
    // continuation's `finally`, so a probe click issuing a second create proves
    // the stale-workspace continuation ran to the end (not a vacuous pass on
    // a too-early tick).
    await waitFor(async () => {
      await fireEvent.click(newTerminalButton(container));
      expect(clientMocks.mockTerminalsCreate).toHaveBeenCalledTimes(2);
    });
    // No tab/open mutation landed from the stale WS_A create in either
    // workspace's live state.
    expect(dispatchedTypes()).not.toContain('terminals/addTerminal');
    expect(dispatchedTypes()).not.toContain('terminals/open');
  });
});
