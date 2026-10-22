/**
 * Review fix from PR #705 (comment 3710192418): `createNewTerminal` in the
 * root overlay needs the same in-flight guard as QuakeTerminalOverlay — a
 * rapid double-invoke must not issue two `terminal.create` calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

const sagaMocks = vi.hoisted(() => ({
  createTerminal: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { terminalsReducer } = await import('$store/renderer/slices/terminals/terminals-slice');
  let terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const listeners = new Set<() => void>();
  const store: any = {
    get state() {
      return {
        terminals: terminalsState,
      };
    },
    dispatch: (action: any) => {
      dispatched.push(action);
      terminalsState = terminalsReducer(terminalsState, action);
      listeners.forEach((listener) => listener());
      if (action.type === 'terminals/createOverlayTerminalRequested') {
        void sagaMocks.createTerminal(action.payload[0]).then((terminalId: string) => {
          const [workspaceId, consumer] = action.payload;
          const current = terminalsState.creationOutcomes.map[consumer.id];
          if (current?.seq !== action.seq || current.status !== 'pending') return;
          store.dispatch({
            type: 'terminals/addTerminal',
            payload: [workspaceId, terminalId, 'Terminal'],
          });
          store.dispatch({ type: 'terminals/open', payload: [workspaceId, terminalId] });
          store.dispatch({
            type: 'terminals/terminalCreationFinished',
            payload: [
              {
                ...consumer,
                workspaceId,
                seq: action.seq,
                status: 'success',
                terminalId,
              },
            ],
          });
        });
      }
      return action;
    },
    createSelector: (fn: (state: any, ...args: any[]) => any) =>
      Object.assign(
        (...args: any[]) => ({
          subscribe: (listener: (v: any) => void) => {
            const read = () => listener(fn(store.state, ...args));
            listeners.add(read);
            read();
            return () => listeners.delete(read);
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
      terminalsState = terminalsReducer(undefined, { type: '@@INIT' });
      dispatched.length = 0;
      listeners.clear();
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
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
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
    sagaMocks.createTerminal.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    render(RootQuakeTerminalOverlay);

    fireCreateNewEvent();
    fireCreateNewEvent();

    expect(sagaMocks.createTerminal).toHaveBeenCalledTimes(1);
    expect(dispatchedTypes()).toContain('terminals/createOverlayTerminalRequested');

    resolveCreate('pty-root-1');
    await waitFor(() => {
      expect(dispatchedTypes()).toContain('terminals/addTerminal');
      expect((appStore as any).__dispatched).toContainEqual({
        type: 'terminals/open',
        payload: [ROOT_WORKSPACE_ID, 'pty-root-1'],
      });
    });
  });

  it('allows a new create after the previous one settles', async () => {
    sagaMocks.createTerminal.mockResolvedValue('pty-root-1');

    render(RootQuakeTerminalOverlay);

    fireCreateNewEvent();
    await waitFor(() => {
      expect(dispatchedTypes()).toContain('terminals/addTerminal');
    });
    fireCreateNewEvent();

    await waitFor(() => {
      expect(sagaMocks.createTerminal).toHaveBeenCalledTimes(2);
    });
  });
});
