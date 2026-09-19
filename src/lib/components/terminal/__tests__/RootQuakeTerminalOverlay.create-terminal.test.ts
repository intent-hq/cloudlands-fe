import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const { terminalsReducer } = await import('$store/renderer/slices/terminals/terminals-slice');
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const store: any = createAppStoreMock({
    reducers: { terminals: terminalsReducer },
    dispatch: (action: any) => {
      dispatched.push(action);
      return action;
    },
  });
  store.__dispatched = dispatched;
  store.__clearDispatched = () => dispatched.splice(0);
  store.__reset = () => {
    dispatched.length = 0;
    store.resetReducers();
  };
  return { store };
});

vi.mock('../Terminal.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});
vi.mock('$lib/components/ui/tooltip', async () => {
  const MockTooltip = (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'))
    .default;
  return { Tooltip: MockTooltip, TooltipRich: MockTooltip, TooltipShortcut: MockTooltip };
});
vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('./mocks/MockButton.svelte')).default,
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: mocks.toastError, warning: vi.fn() },
}));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { disposeTerminal: vi.fn(), clearTerminal: vi.fn() },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: { getLastCommand: () => null },
}));

import RootQuakeTerminalOverlay from '../RootQuakeTerminalOverlay.svelte';
import { store as appStore } from '$store/renderer/store';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { warmImport } from '../../../../test/warm-import';
import {
  createTerminalFromOverlayFailed,
  createTerminalFromOverlayRequested,
  createTerminalFromOverlaySucceeded,
} from '$store/renderer/slices/terminals/terminals-slice';

function dispatchedTypes(): string[] {
  return (appStore as any).__dispatched.map((action: { type: string }) => action.type);
}

function fireCreateNewEvent() {
  dispatchWindowEvent('workspace:new-terminal', { workspaceId: ROOT_WORKSPACE_ID });
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'));
warmImport(() => import('./mocks/MockButton.svelte'));

describe('RootQuakeTerminalOverlay createNewTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appStore as any).__reset();
  });

  it('dispatches one saga-owned request for a rapid duplicate while creation is pending', () => {
    render(RootQuakeTerminalOverlay);

    fireCreateNewEvent();
    fireCreateNewEvent();

    expect(
      dispatchedTypes().filter((type) => type === 'terminals/createTerminalFromOverlayRequested'),
    ).toHaveLength(1);
  });

  it('allows a new create after the saga reports success', async () => {
    render(RootQuakeTerminalOverlay);

    fireCreateNewEvent();
    appStore.dispatch(createTerminalFromOverlaySucceeded(ROOT_WORKSPACE_ID, 'pty-root-1'));
    await tick();
    fireCreateNewEvent();

    expect(
      dispatchedTypes().filter((type) => type === 'terminals/createTerminalFromOverlayRequested'),
    ).toHaveLength(2);
  });

  it('reports the current saga failure and allows a retry', async () => {
    render(RootQuakeTerminalOverlay);

    fireCreateNewEvent();
    appStore.dispatch(createTerminalFromOverlayFailed(ROOT_WORKSPACE_ID, 'offline'));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    fireCreateNewEvent();
    expect(
      dispatchedTypes().filter((type) => type === 'terminals/createTerminalFromOverlayRequested'),
    ).toHaveLength(2);
  });

  it('ignores a stale failure that settled before mount', async () => {
    appStore.dispatch(createTerminalFromOverlayRequested(ROOT_WORKSPACE_ID));
    appStore.dispatch(createTerminalFromOverlayFailed(ROOT_WORKSPACE_ID, 'stale'));
    (appStore as any).__clearDispatched();

    render(RootQuakeTerminalOverlay);
    await tick();

    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('does not react to a terminal failure after unmount', async () => {
    const { unmount } = render(RootQuakeTerminalOverlay);
    fireCreateNewEvent();
    unmount();
    (appStore as any).__clearDispatched();

    appStore.dispatch(createTerminalFromOverlayFailed(ROOT_WORKSPACE_ID, 'late'));
    await tick();

    expect(dispatchedTypes()).toEqual(['terminals/createTerminalFromOverlayFailed']);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
