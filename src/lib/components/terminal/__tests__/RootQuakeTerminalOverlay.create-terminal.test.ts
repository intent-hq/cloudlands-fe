/**
 * Review fix from PR #705 (comment 3710192418): `createNewTerminal` in the
 * root overlay needs the same in-flight guard as QuakeTerminalOverlay — a
 * rapid double-invoke must not issue two `terminal.create` calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

const clientMocks = vi.hoisted(() => ({
  mockTerminalsCreate: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    terminals: { create: clientMocks.mockTerminalsCreate },
  },
}));

vi.mock('$store/renderer/store', () => {
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const store: any = {
    get state() {
      return {
        workspace: { activeWorkspaceId: null },
        terminals: { height: 30, workspaces: {} },
      };
    },
    dispatch: (action: any) => {
      dispatched.push(action);
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
    __reset: () => {
      dispatched.length = 0;
    },
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
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
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

describe('RootQuakeTerminalOverlay createNewTerminal (PR #705 review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (appStore as any).__reset();
  });

  it('issues a single terminal.create for a rapid double-invoke (in-flight guard)', async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    clientMocks.mockTerminalsCreate.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    render(RootQuakeTerminalOverlay);

    fireCreateNewEvent();
    fireCreateNewEvent();

    expect(clientMocks.mockTerminalsCreate).toHaveBeenCalledTimes(1);

    resolveCreate({ success: true, id: 'pty-root-1' });
    await waitFor(() => {
      expect(dispatchedTypes()).toContain('terminals/addTerminal');
    });
  });

  it('allows a new create after the previous one settles', async () => {
    clientMocks.mockTerminalsCreate.mockResolvedValue({ success: true, id: 'pty-root-1' });

    render(RootQuakeTerminalOverlay);

    fireCreateNewEvent();
    await waitFor(() => {
      expect(dispatchedTypes()).toContain('terminals/addTerminal');
    });
    fireCreateNewEvent();

    await waitFor(() => {
      expect(clientMocks.mockTerminalsCreate).toHaveBeenCalledTimes(2);
    });
  });
});
