/**
 * Review fixes from PR #705: `createNewTerminal` needs an in-flight guard
 * (a double-click must not spawn two daemon PTYs) and a workspace-still-
 * current check (a mid-create workspace switch must not mutate the departed
 * workspace's open/active state).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { WorkspaceId } from '$shared/types/branded-ids';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const { scriptsReducer } = await import('$store/renderer/slices/scripts/scripts-slice');
  const { terminalsReducer } = await import('$store/renderer/slices/terminals/terminals-slice');
  let currentTabId: string | null = null;
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const store: any = createAppStoreMock({
    state: () => ({ tabState: { currentTabId } }),
    reducers: { scripts: scriptsReducer, terminals: terminalsReducer },
    dispatch: (action: any) => {
      dispatched.push(action);
      return action;
    },
  });
  store.__dispatched = dispatched;
  store.__setCurrentTab = (id: string | null) => {
    currentTabId = id;
    store.emitState();
  };
  store.__reset = () => {
    currentTabId = null;
    dispatched.length = 0;
    store.resetReducers();
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
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { disposeTerminal: vi.fn(), clearTerminal: vi.fn() },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: { getLastCommand: () => null },
}));

import QuakeTerminalOverlay from '../QuakeTerminalOverlay.svelte';
import { store as appStore } from '$store/renderer/store';
import { createTerminalFromOverlaySucceeded } from '$store/renderer/slices/terminals/terminals-slice';
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

describe('QuakeTerminalOverlay createNewTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appStore as any).__reset();
  });

  it('dispatches one create request for a rapid double-click while the selector is loading', async () => {
    (appStore as any).__setCurrentTab(WS_A);

    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    const button = newTerminalButton(container);

    await fireEvent.click(button);
    await fireEvent.click(button);

    expect(
      dispatchedTypes().filter((type) => type === 'terminals/createTerminalFromOverlayRequested'),
    ).toHaveLength(1);
  });

  it('allows a new create after the previous one settles', async () => {
    (appStore as any).__setCurrentTab(WS_A);
    const { container } = render(QuakeTerminalOverlay, { props: { workspaceId: WS_A } });
    const button = newTerminalButton(container);

    await fireEvent.click(button);
    appStore.dispatch(createTerminalFromOverlaySucceeded(WS_A, 'pty-1'));
    await fireEvent.click(button);

    await waitFor(() => {
      expect(
        dispatchedTypes().filter((type) => type === 'terminals/createTerminalFromOverlayRequested'),
      ).toHaveLength(2);
    });
  });

  it('allows the newly rendered workspace to start its own keyed operation', async () => {
    (appStore as any).__setCurrentTab(WS_A);

    const { container, rerender } = render(QuakeTerminalOverlay, {
      props: { workspaceId: WS_A },
    });
    await fireEvent.click(newTerminalButton(container));

    (appStore as any).__setCurrentTab(WS_B);
    await rerender({ workspaceId: WS_B });
    await tick();
    (appStore as any).emitState();
    await fireEvent.click(newTerminalButton(container));

    const requests = (appStore as any).__dispatched.filter(
      (action: { type: string }) => action.type === 'terminals/createTerminalFromOverlayRequested',
    );
    expect(requests.map((action: { payload: [string] }) => action.payload[0])).toEqual([
      WS_A,
      WS_B,
    ]);
  });
});
