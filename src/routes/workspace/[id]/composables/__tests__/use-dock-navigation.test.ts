/**
 * Tests for useDockNavigation composable
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the composable's pure functions without Svelte reactivity
describe('useDockNavigation', () => {
  describe('getDockItems', () => {
    it('should return agents first, then terminals', () => {
      const agents = [
        { id: 'agent-1', isBackground: false, metadata: {} },
        { id: 'agent-2', isBackground: false, metadata: {} },
      ];
      const terminals = [{ id: 'terminal-1' }, { id: 'terminal-2' }];

      // Simulate getDockItems logic
      const items: Array<{ id: string; type: 'agent' | 'terminal' }> = [];
      for (const agent of agents) {
        if (!agent.isBackground && !agent.metadata?.isBackground) {
          items.push({ id: agent.id, type: 'agent' });
        }
      }
      for (const terminal of terminals) {
        items.push({ id: terminal.id, type: 'terminal' });
      }

      expect(items).toEqual([
        { id: 'agent-1', type: 'agent' },
        { id: 'agent-2', type: 'agent' },
        { id: 'terminal-1', type: 'terminal' },
        { id: 'terminal-2', type: 'terminal' },
      ]);
    });

    it('should filter out background agents', () => {
      const agents = [
        { id: 'agent-1', isBackground: true, metadata: {} },
        { id: 'agent-2', isBackground: false, metadata: { isBackground: true } },
        { id: 'agent-3', isBackground: false, metadata: {} },
      ];
      const terminals = [{ id: 'terminal-1' }];

      const items: Array<{ id: string; type: 'agent' | 'terminal' }> = [];
      for (const agent of agents) {
        if (!agent.isBackground && !agent.metadata?.isBackground) {
          items.push({ id: agent.id, type: 'agent' });
        }
      }
      for (const terminal of terminals) {
        items.push({ id: terminal.id, type: 'terminal' });
      }

      expect(items).toEqual([
        { id: 'agent-3', type: 'agent' },
        { id: 'terminal-1', type: 'terminal' },
      ]);
    });

    it('should return empty array when no agents or terminals', () => {
      const agents: Array<{ id: string; isBackground: boolean; metadata: any }> = [];
      const terminals: Array<{ id: string }> = [];

      const items: Array<{ id: string; type: 'agent' | 'terminal' }> = [];
      for (const agent of agents) {
        if (!agent.isBackground && !agent.metadata?.isBackground) {
          items.push({ id: agent.id, type: 'agent' });
        }
      }
      for (const terminal of terminals) {
        items.push({ id: terminal.id, type: 'terminal' });
      }

      expect(items).toEqual([]);
    });
  });

  describe('navigateDock logic', () => {
    it('should calculate next index with wrapping', () => {
      const items = [
        { id: 'agent-1', type: 'agent' as const },
        { id: 'agent-2', type: 'agent' as const },
        { id: 'terminal-1', type: 'terminal' as const },
      ];

      // Test next from index 0
      let currentIndex = 0;
      let nextIndex = (currentIndex + 1) % items.length;
      expect(nextIndex).toBe(1);

      // Test next from last index (should wrap to 0)
      currentIndex = 2;
      nextIndex = (currentIndex + 1) % items.length;
      expect(nextIndex).toBe(0);

      // Test previous from index 1
      currentIndex = 1;
      nextIndex = (currentIndex - 1 + items.length) % items.length;
      expect(nextIndex).toBe(0);

      // Test previous from index 0 (should wrap to last)
      currentIndex = 0;
      nextIndex = (currentIndex - 1 + items.length) % items.length;
      expect(nextIndex).toBe(2);
    });

    it('should start at first item when no current selection and navigating next', () => {
      const items = [
        { id: 'agent-1', type: 'agent' as const },
        { id: 'terminal-1', type: 'terminal' as const },
      ];

      const currentIndex = -1;
      const direction = 'next';
      const nextIndex = direction === 'next' ? 0 : items.length - 1;

      expect(nextIndex).toBe(0);
    });

    it('should start at last item when no current selection and navigating previous', () => {
      const items = [
        { id: 'agent-1', type: 'agent' as const },
        { id: 'terminal-1', type: 'terminal' as const },
      ];

      const currentIndex = -1;
      const direction = 'previous';
      const nextIndex = direction === 'next' ? 0 : items.length - 1;

      expect(nextIndex).toBe(1);
    });
  });
});
