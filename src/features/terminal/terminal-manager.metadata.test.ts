import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { TerminalTab } from '$store/renderer/slices/terminals/terminals-slice';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  backendRequest: vi.fn(),
  state: {} as unknown,
  adapter: {
    initialize: vi.fn(async () => {}),
    reattach: vi.fn(async () => {}),
    detach: vi.fn(),
    dispose: vi.fn(),
    updateCallbacks: vi.fn(),
  },
}));

// The mock also backs the relative `../../store` import inside
// terminals-selectors.ts (same resolved module): `createSelector` runs at that
// module's init, so the mock must provide it. `.select(state, ...)` mirrors
// Themis behavior of evaluating against the explicitly passed state.
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    get state() {
      return mocks.state;
    },
    createSelector: (fn: (state: unknown, ...args: unknown[]) => unknown) => ({
      select: (state: unknown, ...args: unknown[]) => fn(state, ...args),
    }),
  },
}));

vi.mock('./TerminalAdapter', () => ({
  TerminalAdapter: vi.fn(function () {
    return mocks.adapter;
  }),
}));
vi.mock('./terminal-buffer-manager', () => ({ TerminalBufferManager: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));
vi.mock('$lib/client', async () => {
  const { LiveTerminalsClient } = await import('$lib/client/live/live-terminals-client');
  return { appClient: { terminals: new LiveTerminalsClient() } };
});

import { terminalManager } from './terminal-manager.svelte';
import { LiveTerminalsClient } from '$lib/client/live/live-terminals-client';

const WS = 'ws-1';

function stateWith(terminals: TerminalTab[]): unknown {
  return {
    terminals: {
      height: 50,
      workspaces: {
        [WS]: {
          isOpen: false,
          activeTerminalId: null,
          terminals: createCollection<TerminalTab, 'id'>('id', terminals),
          terminalsLoaded: true,
          isLoadingTerminals: false,
          daemonBootId: null,
          selectedScriptId: null,
        },
      },
    },
  };
}

describe('terminalManager.loadTerminalMetadata display-name localization', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
  });

  it("localizes the daemon spawn-time 'Setup Script' name in the metadata title", () => {
    mocks.state = stateWith([{ id: 't-setup', name: 'Setup Script', createdAt: '2026-01-01' }]);
    const [meta] = terminalManager.loadTerminalMetadata(WS);
    expect(meta.title).toBe(m.terminal_daemonName_setupScript_label());
  });

  it("localizes the daemon's 'Terminal' constant for unnamed PTYs", () => {
    mocks.state = stateWith([{ id: 't-plain', name: 'Terminal', createdAt: '2026-01-01' }]);
    const [meta] = terminalManager.loadTerminalMetadata(WS);
    expect(meta.title).toBe(m.terminal_quakeOverlay_terminal_fallback());
  });

  it('keeps a user-set customName verbatim, even over a known daemon name', () => {
    mocks.state = stateWith([
      { id: 't-custom', name: 'Setup Script', customName: 'my build', createdAt: '2026-01-01' },
    ]);
    const [meta] = terminalManager.loadTerminalMetadata(WS);
    expect(meta.title).toBe('my build');
  });

  it('passes unknown daemon names through untouched', () => {
    mocks.state = stateWith([{ id: 't-other', name: 'npm run dev', createdAt: '2026-01-01' }]);
    const [meta] = terminalManager.loadTerminalMetadata(WS);
    expect(meta.title).toBe('npm run dev');
  });
});

it('kills a restored terminal without an adapter so the next daemon list stays empty', async () => {
  let alive = true;
  mocks.backendRequest.mockImplementation(async (method: string) => {
    if (method === 'terminal.kill') {
      alive = false;
      return { ok: true };
    }
    if (method === 'terminal.list') {
      return {
        terminals: alive ? [{ id: 'pty-restored', name: 'Terminal', cwd: '/tmp' }] : [],
        daemonBootId: 'boot-1',
      };
    }
    throw new Error(`Unexpected method: ${method}`);
  });
  const client = new LiveTerminalsClient();
  expect((await client.list(WS)).terminals).toHaveLength(1);
  expect(terminalManager.hasTerminal('pty-restored')).toBe(false);

  terminalManager.disposeTerminal('pty-restored');

  expect(mocks.backendRequest).toHaveBeenCalledWith('terminal.kill', {
    terminalId: 'pty-restored',
  });
  expect((await client.list(WS)).terminals).toEqual([]);
});

describe('terminalManager owner-aware detach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores a detach from a surface the adapter has since left', async () => {
    const overlayContainer = document.createElement('div');
    const panelContainer = document.createElement('div');

    await terminalManager.getOrCreateTerminal('t-move', WS, overlayContainer);
    await terminalManager.getOrCreateTerminal('t-move', WS, panelContainer);
    expect(mocks.adapter.reattach).toHaveBeenCalledWith(panelContainer);
    expect(terminalManager.isAttachedTo('t-move', panelContainer)).toBe(true);

    // The overlay surface unmounts after the panel took the adapter over.
    terminalManager.detachTerminal('t-move', overlayContainer);

    expect(mocks.adapter.detach).not.toHaveBeenCalled();
    expect(terminalManager.isAttachedTo('t-move', panelContainer)).toBe(true);
    expect(terminalManager.isAttachedTo('t-move', overlayContainer)).toBe(false);

    // The owning surface can still detach.
    terminalManager.detachTerminal('t-move', panelContainer);
    expect(mocks.adapter.detach).toHaveBeenCalledTimes(1);
    expect(terminalManager.isAttachedTo('t-move', panelContainer)).toBe(false);

    terminalManager.disposeTerminal('t-move');
  });
});
