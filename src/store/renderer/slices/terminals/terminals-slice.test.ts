import { describe, it, expect } from 'vitest';
import {
  terminalsReducer,
  openTerminalOverlay,
  closeTerminalOverlay,
  toggleTerminalOverlay,
  selectTerminal,
  selectScript,
  setTerminalPlacement,
  addTerminal,
  removeTerminal,
  setTerminalOverlayHeight,
  renameTerminal,
  saveTerminalMetadata,
  loadWorkspaceTerminals,
  hydrateHeight,
  type TerminalOverlayState,
  type TerminalTab,
} from './terminals-slice';
import {
  createCollection,
  getItems,
  getItem,
} from '@augmentcode/themis/utils/collections/collection-utils';

const WS = 'ws-1';

/** Shorthand to create a Collection<TerminalTab, "id"> from an array */
function col(items: TerminalTab[]) {
  return createCollection<TerminalTab, 'id'>('id', items);
}

/** Shorthand to get items array from workspace terminals collection */
function terms(state: TerminalOverlayState, wsId: string = WS) {
  return getItems(getWs(state, wsId).terminals);
}

const initialState: TerminalOverlayState = {
  height: 50,
  workspaceHeights: {},
  workspaces: {},
};

/** Helper to get workspace state from the top-level state */
function getWs(state: TerminalOverlayState, wsId: string = WS) {
  return (
    state.workspaces[wsId] || {
      isOpen: false,
      activeTerminalId: null,
      terminals: createCollection<TerminalTab, 'id'>('id'),
      terminalsLoaded: false,
      isLoadingTerminals: false,
      recentlyCreatedTerminals: [],
      daemonBootId: null,
      placements: {},
    }
  );
}

describe('terminalsReducer', () => {
  it('should return initial state', () => {
    const state = terminalsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('openTerminalOverlay', () => {
    it('should open with workspace and create default terminal', () => {
      const state = terminalsReducer(initialState, openTerminalOverlay(WS));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(terms(state)).toHaveLength(1);
      expect(terms(state)[0].id).toBe('terminal-ws-1-default');
      expect(ws.activeTerminalId).toBe('terminal-ws-1-default');
    });

    it('should open with specific terminal', () => {
      const state = terminalsReducer(initialState, openTerminalOverlay(WS, 'term-123'));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe('term-123');
      expect(terms(state)).toHaveLength(1);
      expect(terms(state)[0].id).toBe('term-123');
    });

    it('should not create duplicate terminal', () => {
      const stateWithTerminal: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: 'term-123',
            terminals: col([{ id: 'term-123', name: 'Terminal' }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
            placements: {},
          },
        },
      };
      const state = terminalsReducer(stateWithTerminal, openTerminalOverlay(WS, 'term-123'));
      expect(terms(state)).toHaveLength(1);
    });
  });

  describe('closeTerminalOverlay', () => {
    it('should close overlay', () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: true,
            activeTerminalId: null,
            terminals: col([]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };
      const state = terminalsReducer(openState, closeTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(false);
    });

    it('should return same state if already closed', () => {
      const state = terminalsReducer(initialState, closeTerminalOverlay(WS));
      expect(state).toBe(initialState);
    });
  });

  describe('toggleTerminalOverlay', () => {
    it('should open when closed', () => {
      const state = terminalsReducer(initialState, toggleTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(true);
    });

    it('should close when open and no termId', () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: true,
            activeTerminalId: null,
            terminals: col([]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };
      const state = terminalsReducer(openState, toggleTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(false);
    });

    it('should stay open when open with termId', () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: true,
            activeTerminalId: null,
            terminals: col([]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };
      const state = terminalsReducer(openState, toggleTerminalOverlay(WS, 'term-1'));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe('term-1');
    });
  });

  describe('removeTerminal', () => {
    it('should remove terminal and select adjacent', () => {
      const stateWith3: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            terminals: col([
              { id: 't1', name: 'T1' },
              { id: 't2', name: 'T2' },
              { id: 't3', name: 'T3' },
            ]),
            activeTerminalId: 't2',
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
            placements: {},
          },
        },
      };
      const state = terminalsReducer(stateWith3, removeTerminal(WS, 't2'));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(2);
      expect(ws.activeTerminalId).toBe('t3');
    });

    it('should select previous when removing last', () => {
      const stateWith2: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            terminals: col([
              { id: 't1', name: 'T1' },
              { id: 't2', name: 'T2' },
            ]),
            activeTerminalId: 't2',
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
            placements: {},
          },
        },
      };
      const state = terminalsReducer(stateWith2, removeTerminal(WS, 't2'));
      expect(getWs(state).activeTerminalId).toBe('t1');
    });

    it('should set null when removing only terminal', () => {
      const stateWith1: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            terminals: col([{ id: 't1', name: 'T1' }]),
            activeTerminalId: 't1',
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
            placements: {},
          },
        },
      };
      const state = terminalsReducer(stateWith1, removeTerminal(WS, 't1'));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(0);
      expect(ws.activeTerminalId).toBeNull();
    });

    it('should close panel when removing last terminal while open', () => {
      // Removing the last terminal while the panel is open must also set
      // isOpen=false to prevent the stuck state (isOpen:true + activeTerminalId:null).
      const stateWith1Open: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: true,
            terminals: col([{ id: 't1', name: 'T1' }]),
            activeTerminalId: 't1',
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
            placements: {},
          },
        },
      };
      const state = terminalsReducer(stateWith1Open, removeTerminal(WS, 't1'));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(0);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(false);
    });

    it('should keep panel open when removing non-last terminal', () => {
      const stateWith2: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: true,
            terminals: col([
              { id: 't1', name: 'T1' },
              { id: 't2', name: 'T2' },
            ]),
            activeTerminalId: 't1',
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
            placements: {},
          },
        },
      };
      const state = terminalsReducer(stateWith2, removeTerminal(WS, 't1'));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(1);
      expect(ws.isOpen).toBe(true);
    });

    it('should return same state if terminal not found', () => {
      const state = terminalsReducer(initialState, removeTerminal(WS, 'nonexistent'));
      expect(state).toBe(initialState);
    });
  });

  describe('setTerminalOverlayHeight', () => {
    it('should clamp height to min/max', () => {
      const state = terminalsReducer(initialState, setTerminalOverlayHeight(WS, 5));
      expect(state.workspaceHeights[WS]).toBe(10);

      const state2 = terminalsReducer(initialState, setTerminalOverlayHeight(WS, 100));
      expect(state2.workspaceHeights[WS]).toBe(90);
    });

    it('should scope the height to the workspace and leave the fallback alone', () => {
      const state = terminalsReducer(initialState, setTerminalOverlayHeight(WS, 30));
      expect(state.workspaceHeights).toEqual({ [WS]: 30 });
      expect(state.height).toBe(50);

      const state2 = terminalsReducer(state, setTerminalOverlayHeight('ws-other', 70));
      expect(state2.workspaceHeights).toEqual({ [WS]: 30, 'ws-other': 70 });
    });

    it('should not materialize a workspace entry', () => {
      const state = terminalsReducer(initialState, setTerminalOverlayHeight(WS, 30));
      expect(state.workspaces).toEqual({});
    });

    it('should return same state if height unchanged or not finite', () => {
      const state = terminalsReducer(initialState, setTerminalOverlayHeight(WS, 30));
      expect(terminalsReducer(state, setTerminalOverlayHeight(WS, 30))).toBe(state);
      expect(terminalsReducer(state, setTerminalOverlayHeight(WS, Number.NaN))).toBe(state);
      expect(terminalsReducer(state, setTerminalOverlayHeight(WS, Infinity))).toBe(state);
    });
  });

  describe('renameTerminal', () => {
    it('should set custom name', () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: 't1', name: 'Terminal' }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };
      const state = terminalsReducer(stateWith, renameTerminal(WS, 't1', 'My Terminal'));
      expect(getItem(getWs(state).terminals, 't1')?.customName).toBe('My Terminal');
    });

    it('should clear custom name on empty string', () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: 't1', name: 'Terminal', customName: 'Old' }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };
      const state = terminalsReducer(stateWith, renameTerminal(WS, 't1', '  '));
      expect(getItem(getWs(state).terminals, 't1')?.customName).toBeUndefined();
    });
  });

  describe('saveTerminalMetadata', () => {
    it('should add metadata-backed terminal if missing', () => {
      const state = terminalsReducer(
        initialState,
        saveTerminalMetadata(WS, 'term-1', 'Setup', '2026-04-29T00:00:00.000Z'),
      );

      expect(getItem(getWs(state).terminals, 'term-1')).toEqual({
        id: 'term-1',
        name: 'Setup',
        type: 'terminal',
        workspaceId: WS,
        createdAt: '2026-04-29T00:00:00.000Z',
      });
    });

    it('should update existing terminal metadata while preserving custom name', () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([
              { id: 'term-1', name: 'Terminal', customName: 'Mine', createdAt: 'old' },
            ]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };

      const state = terminalsReducer(
        stateWith,
        saveTerminalMetadata(WS, 'term-1', 'Setup', '2026-04-29T00:00:00.000Z'),
      );

      expect(getItem(getWs(state).terminals, 'term-1')).toEqual({
        id: 'term-1',
        name: 'Setup',
        customName: 'Mine',
        type: 'terminal',
        workspaceId: WS,
        createdAt: 'old',
      });
    });

    it("should preserve a daemon-provided name when no title is given (no 'Terminal' clobber)", () => {
      // Regression: opening/attaching a hydrated terminal dispatches
      // saveTerminalMetadata without an explicit title; the daemon name
      // (e.g. "Setup Script" from terminal.list) must survive.
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: 'pty-0', name: 'Setup Script' }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };

      const state = terminalsReducer(
        stateWith,
        saveTerminalMetadata(WS, 'pty-0', undefined, '2026-07-21T00:00:00.000Z'),
      );

      expect(getItem(getWs(state).terminals, 'pty-0')?.name).toBe('Setup Script');
    });

    it("should fall back to 'Terminal' when neither title nor existing name is present", () => {
      const state = terminalsReducer(
        initialState,
        saveTerminalMetadata(WS, 'pty-3', undefined, '2026-07-21T00:00:00.000Z'),
      );

      expect(getItem(getWs(state).terminals, 'pty-3')?.name).toBe('Terminal');
    });
  });

  describe('loadWorkspaceTerminals', () => {
    it('should carry the daemon name into TerminalTab.name on hydration (before local metadata exists)', () => {
      // Regression: terminals listed by the daemon before any local metadata
      // exists must display the daemon `name` (e.g. "Setup Script"), never a
      // pty-X-derived label.
      const terminals = [
        { id: 'pty-0', name: 'Setup Script', isConnected: true, isExecuting: false },
        { id: 'pty-1', name: 'Terminal', isConnected: true, isExecuting: true },
      ];
      const state = terminalsReducer(initialState, loadWorkspaceTerminals(WS, terminals, null));

      const setup = getItem(getWs(state).terminals, 'pty-0');
      expect(setup?.name).toBe('Setup Script');
      // Display resolution is customName || name || 'Terminal'.
      expect(setup?.customName || setup?.name || 'Terminal').toBe('Setup Script');
      expect(getItem(getWs(state).terminals, 'pty-1')?.name).toBe('Terminal');
    });

    it('should load terminals with saved state', () => {
      const terminals = [
        { id: 't1', name: 'T1' },
        { id: 't2', name: 'T2' },
      ];
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, terminals, { isOpen: true, activeTerminalId: 't2' }),
      );
      const ws = getWs(state);
      expect(terms(state)).toEqual(terminals);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe('t2');
    });

    it('should fallback to first terminal if saved active not found', () => {
      const terminals = [{ id: 't1', name: 'T1' }];
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, terminals, { isOpen: true, activeTerminalId: 'gone' }),
      );
      expect(getWs(state).activeTerminalId).toBe('t1');
    });

    it('should force isOpen=false when terminals are empty even if saved state says open', () => {
      // When there are no terminals, isOpen must be false regardless of saved state.
      // The panel requires activeTerminalId to render, so isOpen:true with no
      // terminals creates a stuck state where the toggle appears broken.
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [], { isOpen: true, activeTerminalId: null }),
      );
      const ws = getWs(state);
      expect(terms(state)).toEqual([]);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(false);
    });

    it('should close when no terminals and no saved state', () => {
      const state = terminalsReducer(initialState, loadWorkspaceTerminals(WS, [], null));
      expect(getWs(state).isOpen).toBe(false);
    });
  });

  describe('hydrateHeight', () => {
    it('should set the fallback height from localStorage', () => {
      const state = terminalsReducer(initialState, hydrateHeight(75));
      expect(state.height).toBe(75);
    });

    it('should ignore invalid height', () => {
      const state = terminalsReducer(initialState, hydrateHeight(5));
      expect(state).toBe(initialState);
      const state2 = terminalsReducer(initialState, hydrateHeight(95));
      expect(state2).toBe(initialState);
    });

    it('should seed per-workspace heights and skip out-of-range entries', () => {
      const state = terminalsReducer(
        initialState,
        hydrateHeight(60, { [WS]: 15, 'ws-b': 80, 'ws-bad': 5, 'ws-big': 95 }),
      );
      expect(state.height).toBe(60);
      expect(state.workspaceHeights).toEqual({ [WS]: 15, 'ws-b': 80 });
    });

    it('should not materialize workspace entries for hydrated heights', () => {
      const state = terminalsReducer(initialState, hydrateHeight(60, { [WS]: 15, 'ws-b': 80 }));
      expect(state.workspaces).toEqual({});
      expect(state.workspaces[WS]).toBeUndefined();
    });

    it('should preserve a workspace height across a later terminal load', () => {
      const hydrated = terminalsReducer(initialState, hydrateHeight(50, { [WS]: 15 }));
      const state = terminalsReducer(
        hydrated,
        loadWorkspaceTerminals(WS, [{ id: 'term-1', name: 'Terminal' }], null),
      );
      expect(state.workspaceHeights[WS]).toBe(15);
      expect(getWs(state).activeTerminalId).toBe('term-1');
    });

    it('should apply a saved height carried by loadWorkspaceTerminals', () => {
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [{ id: 'term-1', name: 'Terminal' }], {
          isOpen: true,
          activeTerminalId: 'term-1',
          height: 25,
        }),
      );
      expect(state.workspaceHeights[WS]).toBe(25);
    });
  });

  describe('selectTerminal', () => {
    it('should select a terminal that exists', () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            terminals: col([
              { id: 't1', name: 'T1' },
              { id: 't2', name: 'T2' },
            ]),
            activeTerminalId: 't1',
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };
      const state = terminalsReducer(stateWith, selectTerminal(WS, 't2'));
      expect(getWs(state).activeTerminalId).toBe('t2');
    });

    it('should ignore nonexistent terminal', () => {
      const state = terminalsReducer(initialState, selectTerminal(WS, 'nonexistent'));
      expect(state).toBe(initialState);
    });
  });

  describe('addTerminal', () => {
    it('should add terminal and make it active', () => {
      const state = terminalsReducer(initialState, addTerminal(WS, 't1', 'My Term'));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(1);
      expect(getItem(ws.terminals, 't1')).toEqual({ id: 't1', name: 'My Term' });
      expect(ws.activeTerminalId).toBe('t1');
    });

    it('should not duplicate existing terminal', () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: 't1', name: 'T1' }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };
      const state = terminalsReducer(stateWith, addTerminal(WS, 't1', 'T1'));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(1);
      expect(ws.activeTerminalId).toBe('t1');
    });
  });

  describe('per-workspace isolation', () => {
    it('should keep workspaces independent', () => {
      let state = terminalsReducer(initialState, addTerminal('ws-1', 't1', 'Term 1'));
      state = terminalsReducer(state, addTerminal('ws-2', 't2', 'Term 2'));

      expect(terms(state, 'ws-1')).toHaveLength(1);
      expect(terms(state, 'ws-1')[0].id).toBe('t1');
      expect(terms(state, 'ws-2')).toHaveLength(1);
      expect(terms(state, 'ws-2')[0].id).toBe('t2');
    });

    it('should not affect other workspaces when closing', () => {
      let state = terminalsReducer(initialState, openTerminalOverlay('ws-1'));
      state = terminalsReducer(state, openTerminalOverlay('ws-2'));
      state = terminalsReducer(state, closeTerminalOverlay('ws-1'));

      expect(state.workspaces['ws-1'].isOpen).toBe(false);
      expect(state.workspaces['ws-2'].isOpen).toBe(true);
    });
  });

  describe('fresh-create stale customName regression (PanelLayout.handleCreateTerminal)', () => {
    // A previously-renamed terminal can leave a stale entry in the slice
    // (e.g. tab closed without removing the terminal, or daemon restart that
    // resets the id counter and reuses a prior id). `saveTerminalMetadata`
    // intentionally preserves customName for the remount/reattach case, so the
    // fresh-create path in `PanelLayout.handleCreateTerminal` must dispatch
    // `removeTerminal` for the freshly daemon-assigned id before calling
    // `saveTerminalMetadata`, otherwise the new terminal inherits the stale
    // customName from the previous renamed terminal.
    it('dispatching removeTerminal + saveTerminalMetadata clears stale customName for a reused id', () => {
      const stateWithStale: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([
              {
                id: 'pty-0',
                name: 'Terminal',
                customName: 'Build',
                type: 'terminal',
                workspaceId: WS,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
            placements: {},
          },
        },
      };

      let state = terminalsReducer(stateWithStale, removeTerminal(WS, 'pty-0'));
      state = terminalsReducer(
        state,
        saveTerminalMetadata(WS, 'pty-0', 'Terminal', '2026-06-30T00:00:00.000Z'),
      );

      const term = getItem(getWs(state).terminals, 'pty-0');
      expect(term).toEqual({
        id: 'pty-0',
        name: 'Terminal',
        type: 'terminal',
        workspaceId: WS,
        createdAt: '2026-06-30T00:00:00.000Z',
      });
      expect(term?.customName).toBeUndefined();
    });

    // Sanity check: without the removeTerminal step (the pre-fix buggy flow),
    // the stale customName carries over to the fresh terminal — this asserts
    // the bug exists at the reducer level and motivates the fix above.
    it('saveTerminalMetadata alone preserves stale customName (documents the bug)', () => {
      const stateWithStale: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: 'pty-0', name: 'Terminal', customName: 'Build' }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };

      const state = terminalsReducer(
        stateWithStale,
        saveTerminalMetadata(WS, 'pty-0', 'Terminal', '2026-06-30T00:00:00.000Z'),
      );

      expect(getItem(getWs(state).terminals, 'pty-0')?.customName).toBe('Build');
    });
  });

  // Regression (intent-hq/monorepo#1330): switching workspaces re-dispatches
  // loadWorkspaceTerminals from mount hydration. When the daemon returns a
  // transient empty terminal.list (restart race, PTY not yet spawned), the
  // reducer REPLACES the workspace state wholesale — live tabs vanish and
  // isOpen is forced to false. An empty hydration result over existing live
  // tabs must preserve them.
  describe('transient empty hydration over live tabs (monorepo#1330)', () => {
    it('must not clobber existing live tabs when an empty list lands', () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: true,
            activeTerminalId: 'pty-42',
            terminals: col([{ id: 'pty-42', name: 'Terminal' }]),
            terminalsLoaded: true,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: null,
          },
        },
      };

      const state = terminalsReducer(stateWith, loadWorkspaceTerminals(WS, [], null));

      expect(terms(state).map((t) => t.id)).toEqual(['pty-42']);
      expect(getWs(state).activeTerminalId).toBe('pty-42');
      expect(getWs(state).isOpen).toBe(true);
    });
  });

  // Boot-id-aware empty handling (intent-hq/monorepo#1334): the terminal.list
  // envelope carries daemonBootId. A same-boot empty is authoritative (every
  // PTY genuinely gone — converge to zero tabs); a different/unknown boot id
  // means restart (preserve tabs; auto-reconnect respawns) or a legacy
  // bare-array response (no metadata — preserve).
  describe('boot-id-aware empty hydration (monorepo#1334)', () => {
    function liveState(overrides?: Partial<ReturnType<typeof getWs>>): TerminalOverlayState {
      return {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: true,
            activeTerminalId: 'pty-42',
            terminals: col([{ id: 'pty-42', name: 'Terminal' }]),
            terminalsLoaded: true,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
            daemonBootId: 'boot-1',
            ...overrides,
          },
        },
      };
    }

    it('adopts the daemonBootId from a non-empty hydration', () => {
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [{ id: 't1', name: 'T1' }], null, 'boot-1'),
      );
      expect(getWs(state).daemonBootId).toBe('boot-1');
    });

    it('converges to zero tabs on a same-boot authoritative empty', () => {
      const state = terminalsReducer(liveState(), loadWorkspaceTerminals(WS, [], null, 'boot-1'));
      const ws = getWs(state);
      expect(terms(state)).toEqual([]);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(false);
      expect(ws.daemonBootId).toBe('boot-1');
    });

    it('preserves recentlyCreatedTerminals tabs through a same-boot converge', () => {
      const stateWith = liveState({
        terminals: col([
          { id: 'pty-42', name: 'Terminal' },
          { id: 'pty-new', name: 'Terminal' },
        ]),
        activeTerminalId: 'pty-new',
        recentlyCreatedTerminals: ['pty-new'],
      });
      const state = terminalsReducer(stateWith, loadWorkspaceTerminals(WS, [], null, 'boot-1'));
      const ws = getWs(state);
      expect(terms(state).map((t) => t.id)).toEqual(['pty-new']);
      expect(ws.activeTerminalId).toBe('pty-new');
      expect(ws.isOpen).toBe(true);
    });

    it('preserves tabs and adopts the new boot id on a post-restart empty (different boot)', () => {
      const state = terminalsReducer(liveState(), loadWorkspaceTerminals(WS, [], null, 'boot-2'));
      const ws = getWs(state);
      expect(terms(state).map((t) => t.id)).toEqual(['pty-42']);
      expect(ws.activeTerminalId).toBe('pty-42');
      expect(ws.isOpen).toBe(true);
      expect(ws.daemonBootId).toBe('boot-2');
    });

    it('preserves tabs on an empty without boot metadata (legacy bare-array response)', () => {
      const state = terminalsReducer(liveState(), loadWorkspaceTerminals(WS, [], null));
      const ws = getWs(state);
      expect(terms(state).map((t) => t.id)).toEqual(['pty-42']);
      expect(ws.daemonBootId).toBe('boot-1');
    });

    it('preserves tabs when a boot-tagged empty lands before any boot id is known', () => {
      const stateWith = liveState({ daemonBootId: null });
      const state = terminalsReducer(stateWith, loadWorkspaceTerminals(WS, [], null, 'boot-1'));
      const ws = getWs(state);
      expect(terms(state).map((t) => t.id)).toEqual(['pty-42']);
      expect(ws.daemonBootId).toBe('boot-1');
    });
  });

  describe('placement (last surface a terminal/script was shown on)', () => {
    it('starts with no placements recorded', () => {
      const state = terminalsReducer(initialState, addTerminal(WS, 't1'));
      expect(getWs(state).placements).toEqual({});
    });

    it('records panel placement via setTerminalPlacement', () => {
      const state = terminalsReducer(initialState, setTerminalPlacement(WS, 't1', 'panel'));
      expect(getWs(state).placements).toEqual({ t1: 'panel' });
    });

    it('returns the same state when the placement is unchanged', () => {
      const state = terminalsReducer(initialState, setTerminalPlacement(WS, 't1', 'panel'));
      expect(terminalsReducer(state, setTerminalPlacement(WS, 't1', 'panel'))).toBe(state);
    });

    it('records overlay placement when a terminal is opened in the overlay', () => {
      let state = terminalsReducer(initialState, setTerminalPlacement(WS, 't1', 'panel'));
      state = terminalsReducer(state, openTerminalOverlay(WS, 't1'));
      expect(getWs(state).placements).toEqual({ t1: 'overlay' });
    });

    it('records overlay placement for the default terminal when none is named', () => {
      const state = terminalsReducer(initialState, openTerminalOverlay(WS));
      expect(getWs(state).placements).toEqual({ [`terminal-${WS}-default`]: 'overlay' });
    });

    it('records overlay placement for the selected script when the overlay opens on it', () => {
      let state = terminalsReducer(initialState, addTerminal(WS, 't1'));
      state = terminalsReducer(state, setTerminalPlacement(WS, 'script-1', 'panel'));
      state = terminalsReducer(state, selectScript(WS, 'script-1'));
      state = terminalsReducer(state, openTerminalOverlay(WS));
      expect(getWs(state).placements).toEqual({ 'script-1': 'overlay' });
    });

    it('records overlay placement when a panel-placed terminal is selected in the open overlay', () => {
      let state = terminalsReducer(initialState, openTerminalOverlay(WS, 't1'));
      state = terminalsReducer(state, addTerminal(WS, 't2'));
      state = terminalsReducer(state, setTerminalPlacement(WS, 't2', 'panel'));
      state = terminalsReducer(state, selectTerminal(WS, 't2'));
      expect(getWs(state).placements).toEqual({ t1: 'overlay', t2: 'overlay' });
    });

    it('leaves placement alone when a terminal is selected while the overlay is closed', () => {
      let state = terminalsReducer(initialState, addTerminal(WS, 't1'));
      state = terminalsReducer(state, addTerminal(WS, 't2'));
      state = terminalsReducer(state, setTerminalPlacement(WS, 't2', 'panel'));
      state = terminalsReducer(state, selectTerminal(WS, 't2'));
      expect(getWs(state).activeTerminalId).toBe('t2');
      expect(getWs(state).placements).toEqual({ t2: 'panel' });
    });

    it('records overlay placement when a panel-placed script is selected in the open overlay', () => {
      let state = terminalsReducer(initialState, openTerminalOverlay(WS, 't1'));
      state = terminalsReducer(state, setTerminalPlacement(WS, 'script-1', 'panel'));
      state = terminalsReducer(state, selectScript(WS, 'script-1'));
      expect(getWs(state).selectedScriptId).toBe('script-1');
      expect(getWs(state).placements).toEqual({ t1: 'overlay', 'script-1': 'overlay' });
    });

    it('leaves placement alone when a script is selected while the overlay is closed', () => {
      let state = terminalsReducer(initialState, setTerminalPlacement(WS, 'script-1', 'panel'));
      state = terminalsReducer(state, selectScript(WS, 'script-1'));
      expect(getWs(state).selectedScriptId).toBe('script-1');
      expect(getWs(state).placements).toEqual({ 'script-1': 'panel' });
    });

    it('keeps placements per workspace and per terminal', () => {
      let state = terminalsReducer(initialState, setTerminalPlacement(WS, 't1', 'panel'));
      state = terminalsReducer(state, setTerminalPlacement(WS, 't2', 'overlay'));
      state = terminalsReducer(state, setTerminalPlacement('ws-2', 't1', 'overlay'));
      expect(getWs(state).placements).toEqual({ t1: 'panel', t2: 'overlay' });
      expect(getWs(state, 'ws-2').placements).toEqual({ t1: 'overlay' });
    });

    it('drops the placement of a removed terminal', () => {
      let state = terminalsReducer(initialState, addTerminal(WS, 't1'));
      state = terminalsReducer(state, setTerminalPlacement(WS, 't1', 'panel'));
      state = terminalsReducer(state, setTerminalPlacement(WS, 't2', 'panel'));
      state = terminalsReducer(state, removeTerminal(WS, 't1'));
      expect(getWs(state).placements).toEqual({ t2: 'panel' });
    });

    it('hydrates placements from saved state and keeps them across a refetch', () => {
      let state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [{ id: 't1', name: 'T1' }], {
          isOpen: false,
          activeTerminalId: 't1',
          placements: { t1: 'panel' },
        }),
      );
      expect(getWs(state).placements).toEqual({ t1: 'panel' });

      state = terminalsReducer(state, loadWorkspaceTerminals(WS, [{ id: 't1', name: 'T1' }]));
      expect(getWs(state).placements).toEqual({ t1: 'panel' });
    });

    it('keeps prior placements when the saved state predates them', () => {
      let state = terminalsReducer(initialState, setTerminalPlacement(WS, 't1', 'panel'));
      state = terminalsReducer(
        state,
        loadWorkspaceTerminals(WS, [{ id: 't1', name: 'T1' }], {
          isOpen: false,
          activeTerminalId: 't1',
        }),
      );
      expect(getWs(state).placements).toEqual({ t1: 'panel' });
    });
  });
});
