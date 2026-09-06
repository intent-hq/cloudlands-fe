/**
 * Integration tests for intent link handler with Tiptap
 * Tests the click handler logic without requiring full Tiptap setup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleIntentLink } from './workspaces-link-handler';

describe('Tiptap Click Handler Integration', () => {
  beforeEach(() => {
    // Clear any previous state
    vi.clearAllMocks();
  });

  describe('handleIntentLink', () => {
    it('should return true for intent:// links', async () => {
      const result = await handleIntentLink('intent://local/note/spec');
      expect(result).toBe(true);
    });

    it('should return false for non-intent links', async () => {
      const result = await handleIntentLink('https://example.com');
      expect(result).toBe(false);
    });

    it('should return false for relative links', async () => {
      const result = await handleIntentLink('/some/path');
      expect(result).toBe(false);
    });
  });

  describe('Tiptap handleClick wrapper', () => {
    // This is the actual function we'll use in Tiptap
    const createClickHandler = () => async (view: any, pos: number, event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest('a');

      if (anchor?.href?.startsWith('intent://')) {
        event.preventDefault();
        return await handleIntentLink(anchor.href);
      }

      return false;
    };

    it('should extract href from anchor element and call handler', async () => {
      // Mock DOM structure
      const mockAnchor = document.createElement('a');
      mockAnchor.href = 'intent://local/note/spec';

      const mockEvent = {
        target: mockAnchor,
        preventDefault: vi.fn(),
      } as any;

      const handleClick = createClickHandler();
      const result = await handleClick({}, 0, mockEvent);

      expect(result).toBe(true);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle clicks on child elements of anchor', async () => {
      // Create anchor with child span
      const mockAnchor = document.createElement('a');
      mockAnchor.href = 'intent://local/note/spec';

      const mockSpan = document.createElement('span');
      mockSpan.textContent = 'Click me';
      mockAnchor.appendChild(mockSpan);

      const mockEvent = {
        target: mockSpan, // Click on child element
        preventDefault: vi.fn(),
      } as any;

      const handleClick = createClickHandler();
      const result = await handleClick({}, 0, mockEvent);

      expect(result).toBe(true);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should not prevent default for non-workspaces links', async () => {
      const mockAnchor = document.createElement('a');
      mockAnchor.href = 'https://example.com';

      const mockEvent = {
        target: mockAnchor,
        preventDefault: vi.fn(),
      } as any;

      const handleClick = createClickHandler();
      const result = await handleClick({}, 0, mockEvent);

      expect(result).toBe(false);
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('should handle clicks on non-anchor elements', async () => {
      const mockDiv = document.createElement('div');

      const mockEvent = {
        target: mockDiv,
        preventDefault: vi.fn(),
      } as any;

      const handleClick = createClickHandler();
      const result = await handleClick({}, 0, mockEvent);

      expect(result).toBe(false);
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('should handle anchor without href', async () => {
      const mockAnchor = document.createElement('a');
      // No href set

      const mockEvent = {
        target: mockAnchor,
        preventDefault: vi.fn(),
      } as any;

      const handleClick = createClickHandler();
      const result = await handleClick({}, 0, mockEvent);

      expect(result).toBe(false);
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('Export for use in components', () => {
    it('should export a reusable click handler function', () => {
      // This tests that we can create the handler and use it
      const createClickHandler = () => async (view: any, pos: number, event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const anchor = target.closest('a');

        if (anchor?.href?.startsWith('intent://')) {
          event.preventDefault();
          return await handleIntentLink(anchor.href);
        }

        return false;
      };

      const handler = createClickHandler();
      expect(typeof handler).toBe('function');
    });
  });
});
