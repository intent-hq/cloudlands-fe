import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing the store
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('$features/agent/services/unread-tracking.service', () => ({
  unreadTrackingService: {
    subscribe: vi.fn(),
  },
}));

// We need to dynamically import the store module so mocks are in place
// The store uses $state (Svelte 5 runes) so the .svelte.ts extension is processed by the svelte plugin
import { sidebarNavStore } from '../sidebar-nav.store.svelte';

describe('SidebarNavStore context menu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store state between tests
    sidebarNavStore.hoveredItem = null;
    sidebarNavStore.expandedItem = null;
    sidebarNavStore.isCardPinned = false;
    // Reset contextMenuOpenCount to 0 by decrementing
    while (sidebarNavStore.contextMenuOpen) {
      sidebarNavStore.decrementContextMenuOpen();
    }
  });

  // ── Counter-based contextMenuOpen ──

  describe('counter-based contextMenuOpen', () => {
    it('incrementing makes contextMenuOpen true', () => {
      expect(sidebarNavStore.contextMenuOpen).toBe(false);
      sidebarNavStore.incrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(true);
    });

    it('decrementing back to 0 makes contextMenuOpen false', () => {
      sidebarNavStore.incrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(true);
      sidebarNavStore.decrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(false);
    });

    it('multiple increments require equal decrements', () => {
      sidebarNavStore.incrementContextMenuOpen();
      sidebarNavStore.incrementContextMenuOpen();
      sidebarNavStore.incrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(true);

      sidebarNavStore.decrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(true);

      sidebarNavStore.decrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(true);

      sidebarNavStore.decrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(false);
    });

    it('decrement below 0 does not go negative', () => {
      expect(sidebarNavStore.contextMenuOpen).toBe(false);
      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.decrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(false);
      // Incrementing once should now make it true (counter is 0, not -2)
      sidebarNavStore.incrementContextMenuOpen();
      expect(sidebarNavStore.contextMenuOpen).toBe(true);
    });
  });

  // ── Deferred leave with context menu ──

  describe('deferred leave with context menu', () => {
    it('handleCardMouseLeave sets deferred leave when contextMenuOpen', () => {
      // Set up: hoveredItem and expandedItem are set, context menu is open
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();

      sidebarNavStore.handleCardMouseLeave();

      // Should NOT have started a leave timeout (card should remain open)
      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBe('active');
      expect(sidebarNavStore.expandedItem).toBe('active');
    });

    it('handleMouseLeave sets deferred leave when contextMenuOpen', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();

      sidebarNavStore.handleMouseLeave();

      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBe('active');
      // expandedItem should still be set
      expect(sidebarNavStore.expandedItem).toBe('active');
    });

    it('handleCardMouseLeave does NOT set deferred leave when isCardPinned', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.isCardPinned = true;

      sidebarNavStore.handleCardMouseLeave();

      vi.advanceTimersByTime(200);
      // Card stays open because it's pinned
      expect(sidebarNavStore.hoveredItem).toBe('active');
      expect(sidebarNavStore.expandedItem).toBe('active');
    });

    it('handleMouseLeave does NOT set deferred leave when isCardPinned', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.isCardPinned = true;

      sidebarNavStore.handleMouseLeave();

      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBe('active');
    });
  });

  // ── Deferred leave cancellation ──

  describe('deferred leave cancellation', () => {
    it('handleCardMouseEnter clears deferredLeave', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();

      // Trigger deferred leave
      sidebarNavStore.handleCardMouseLeave();

      // Mouse re-enters card — should cancel deferred leave
      sidebarNavStore.handleCardMouseEnter();

      // Now close context menu — should NOT process deferred leave
      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBe('active');
      expect(sidebarNavStore.expandedItem).toBe('active');
    });

    it('handleMouseEnter clears deferredLeave', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();

      // Trigger deferred nav leave
      sidebarNavStore.handleMouseLeave();

      // Mouse re-enters nav — should cancel deferred leave
      sidebarNavStore.handleMouseEnter('active');

      // Close context menu — should NOT process deferred leave
      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBe('active');
      expect(sidebarNavStore.expandedItem).toBe('active');
    });
  });

  // ── onContextMenuClosed ──

  describe('onContextMenuClosed', () => {
    it('processes deferred card leave (clears hoveredItem AND expandedItem)', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();

      // Trigger deferred card leave
      sidebarNavStore.handleCardMouseLeave();

      // Close context menu
      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBeNull();
      expect(sidebarNavStore.expandedItem).toBeNull();
    });

    it('processes deferred nav leave (clears hoveredItem but NOT expandedItem)', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();

      // Trigger deferred nav leave
      sidebarNavStore.handleMouseLeave();

      // Close context menu
      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBeNull();
      // Nav leave intentionally does NOT clear expandedItem
      expect(sidebarNavStore.expandedItem).toBe('active');
    });

    it('does NOT process if contextMenuOpen is still true (counter > 0)', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();
      sidebarNavStore.incrementContextMenuOpen(); // two menus open

      // Trigger deferred card leave
      sidebarNavStore.handleCardMouseLeave();

      // Close only one context menu
      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      // Should NOT have processed — another menu is still open
      expect(sidebarNavStore.hoveredItem).toBe('active');
      expect(sidebarNavStore.expandedItem).toBe('active');
    });

    it('does NOT process if isCardPinned', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.isCardPinned = true;
      sidebarNavStore.incrementContextMenuOpen();

      // Trigger deferred card leave
      sidebarNavStore.handleCardMouseLeave();

      // Close context menu
      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      // Should NOT have processed — card is pinned
      expect(sidebarNavStore.hoveredItem).toBe('active');
      expect(sidebarNavStore.expandedItem).toBe('active');
    });

    it('clears deferredLeave after processing', () => {
      sidebarNavStore.hoveredItem = 'active';
      sidebarNavStore.expandedItem = 'active';
      sidebarNavStore.incrementContextMenuOpen();

      sidebarNavStore.handleCardMouseLeave();

      sidebarNavStore.decrementContextMenuOpen();
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      expect(sidebarNavStore.hoveredItem).toBeNull();
      expect(sidebarNavStore.expandedItem).toBeNull();

      // Set items back and call onContextMenuClosed again — should NOT process
      sidebarNavStore.hoveredItem = 'all-workspaces';
      sidebarNavStore.expandedItem = 'all-workspaces';
      sidebarNavStore.onContextMenuClosed();

      vi.advanceTimersByTime(200);
      // Items should remain since deferredLeave was already cleared
      expect(sidebarNavStore.hoveredItem).toBe('all-workspaces');
      expect(sidebarNavStore.expandedItem).toBe('all-workspaces');
    });
  });
});

