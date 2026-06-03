import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import {
  sidebarNavReducer,
  initialState,
  incrementContextMenuOpen,
  decrementContextMenuOpen,
  setDeferredLeave,
  clearDeferredLeave,
  setHoveredItem,
  setExpandedItem,
  setCardPinned,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import type { SidebarNavState } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';

describe('sidebar-nav context menu (Redux reducer)', () => {
  let state: SidebarNavState;

  beforeEach(() => {
    state = { ...initialState };
  });

  // ── Counter-based contextMenuOpen ──

  describe('counter-based contextMenuOpenCount', () => {
    it('incrementing increases count', () => {
      expect(state.contextMenuOpenCount).toBe(0);
      state = sidebarNavReducer(state, incrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(1);
    });

    it('decrementing back to 0', () => {
      state = sidebarNavReducer(state, incrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(1);
      state = sidebarNavReducer(state, decrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(0);
    });

    it('multiple increments require equal decrements', () => {
      state = sidebarNavReducer(state, incrementContextMenuOpen());
      state = sidebarNavReducer(state, incrementContextMenuOpen());
      state = sidebarNavReducer(state, incrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(3);

      state = sidebarNavReducer(state, decrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(2);

      state = sidebarNavReducer(state, decrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(1);

      state = sidebarNavReducer(state, decrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(0);
    });

    it('decrement below 0 does not go negative', () => {
      expect(state.contextMenuOpenCount).toBe(0);
      state = sidebarNavReducer(state, decrementContextMenuOpen());
      state = sidebarNavReducer(state, decrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(0);
      // Incrementing once should now make it 1 (counter is 0, not -2)
      state = sidebarNavReducer(state, incrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(1);
    });
  });

  // ── Deferred leave state ──

  describe('deferred leave state', () => {
    it('setDeferredLeave sets card leave type', () => {
      state = sidebarNavReducer(state, setDeferredLeave('card'));
      expect(state.deferredLeave).toBe('card');
    });

    it('setDeferredLeave sets nav leave type', () => {
      state = sidebarNavReducer(state, setDeferredLeave('nav'));
      expect(state.deferredLeave).toBe('nav');
    });

    it('clearDeferredLeave resets to null', () => {
      state = sidebarNavReducer(state, setDeferredLeave('card'));
      state = sidebarNavReducer(state, clearDeferredLeave());
      expect(state.deferredLeave).toBeNull();
    });
  });

  // ── Context menu interaction with hover state ──

  describe('context menu interaction with hover state', () => {
    it('hoveredItem and expandedItem are preserved when context menu is open', () => {
      // Set up: hoveredItem and expandedItem are set, context menu is open
      state = sidebarNavReducer(state, setHoveredItem('active'));
      state = sidebarNavReducer(state, setExpandedItem('active'));
      state = sidebarNavReducer(state, incrementContextMenuOpen());

      // Deferred leave is set (would be done by handleCardMouseLeave in component)
      state = sidebarNavReducer(state, setDeferredLeave('card'));

      // Context menu open count > 0, so items remain
      expect(state.hoveredItem).toBe('active');
      expect(state.expandedItem).toBe('active');
      expect(state.contextMenuOpenCount).toBe(1);
      expect(state.deferredLeave).toBe('card');
    });

    it('card pinned prevents deferred leave processing', () => {
      state = sidebarNavReducer(state, setHoveredItem('active'));
      state = sidebarNavReducer(state, setExpandedItem('active'));
      state = sidebarNavReducer(state, setCardPinned(true));
      state = sidebarNavReducer(state, incrementContextMenuOpen());

      // Items remain because card is pinned
      expect(state.hoveredItem).toBe('active');
      expect(state.expandedItem).toBe('active');
      expect(state.isCardPinned).toBe(true);
    });

    it('clearDeferredLeave prevents late processing', () => {
      // Set deferred leave then clear it (simulates mouse re-entering)
      state = sidebarNavReducer(state, setDeferredLeave('card'));
      state = sidebarNavReducer(state, clearDeferredLeave());
      expect(state.deferredLeave).toBeNull();
    });

    it('multiple menus: decrementing one still leaves counter > 0', () => {
      state = sidebarNavReducer(state, setHoveredItem('active'));
      state = sidebarNavReducer(state, setExpandedItem('active'));
      state = sidebarNavReducer(state, incrementContextMenuOpen());
      state = sidebarNavReducer(state, incrementContextMenuOpen()); // two menus

      state = sidebarNavReducer(state, setDeferredLeave('card'));

      // Close only one context menu
      state = sidebarNavReducer(state, decrementContextMenuOpen());
      expect(state.contextMenuOpenCount).toBe(1);
      // Another menu still open — items should remain
      expect(state.hoveredItem).toBe('active');
      expect(state.expandedItem).toBe('active');
    });
  });
});

