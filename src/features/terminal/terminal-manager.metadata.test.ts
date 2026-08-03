import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { TerminalTab } from '$store/renderer/slices/terminals/terminals-slice';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {} as unknown,
}));

// The mock also backs the relative `../../store` import inside
// terminals-selectors.ts (same resolved module): `createSelector` runs at that
// module's init, so the mock must provide it. `.select(state, ...)` mirrors
// the store-shim contract of evaluating against the explicitly passed state.
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

vi.mock('./TerminalAdapter', () => ({ TerminalAdapter: vi.fn() }));
vi.mock('./terminal-buffer-manager', () => ({ TerminalBufferManager: vi.fn() }));

import { terminalManager } from './terminal-manager.svelte';

const WS = 'ws-1';

function stateWith(terminals: TerminalTab[]): unknown {
  return {
    workspace: { activeWorkspaceId: WS },
    terminals: {
      height: 50,
      workspaces: {
        [WS]: {
          isOpen: false,
          activeTerminalId: null,
          terminals: createCollection<TerminalTab, 'id'>('id', terminals),
          terminalsLoaded: true,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
          daemonBootId: null,
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
