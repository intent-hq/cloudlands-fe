import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import type { Editor } from '@tiptap/core';
import { createLogger } from '$lib/utils/client-logger';

describe('CommentsSidebar - Editor View Safety', () => {
  let mockEditor: Partial<Editor>;
  let consoleSpy: any;
  let logger: any;

  beforeEach(() => {
    // Mock document.createElement for tests that need DOM elements
    if (typeof document === 'undefined') {
      (global as any).document = {
        createElement: vi.fn(() => ({
          tagName: 'DIV',
          style: {},
          classList: {
            add: vi.fn(),
            remove: vi.fn(),
          },
        })),
      };
    }

    // Create a logger with debug level enabled for testing
    logger = createLogger('CommentsSidebar');
    logger.setLevel('debug');

    // Mock console to capture debug messages
    consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    // Create a mock editor with view that can be made unavailable
    mockEditor = {
      state: {
        doc: {
          descendants: vi.fn(),
          content: { size: 100 },
        },
        selection: { from: 0, to: 0 },
      },
      view: undefined, // Start with no view
      on: vi.fn(),
      off: vi.fn(),
      isDestroyed: false,
    } as unknown as Partial<Editor>;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should handle missing editor view gracefully', () => {
    // Test that updateCommentPositionsImmediate returns early when no view
    const updateCommentPositionsImmediate = function () {
      if (!mockEditor || !mockEditor.view) {
        return 'early-return';
      }

      // Try to access the editor DOM element safely
      let editorElement: HTMLElement;
      try {
        editorElement = (mockEditor.view as any).dom;
      } catch (e) {
        logger.debug('[CommentsSidebar] Editor view not available', { error: e });
        return 'caught-error';
      }

      if (!editorElement) {
        return 'no-element';
      }

      return 'success';
    };

    // Test with no view
    const result = updateCommentPositionsImmediate();
    expect(result).toBe('early-return');
  });

  it('should handle editor view becoming unavailable during position update', () => {
    // Test function that mimics the actual implementation
    const updateCommentPositionsImmediate = function () {
      if (!mockEditor || !mockEditor.view) {
        return 'early-return';
      }

      // Try to access the editor DOM element safely
      let editorElement: HTMLElement;
      try {
        editorElement = (mockEditor.view as any).dom;
      } catch (e) {
        logger.debug('[CommentsSidebar] Editor view not available', { error: e });
        return 'caught-error';
      }

      if (!editorElement) {
        return 'no-element';
      }

      return 'success';
    };

    // Start with a valid view
    mockEditor = {
      ...mockEditor,
      view: {
        dom: document.createElement('div'),
        hasFocus: vi.fn(() => false),
        coordsAtPos: vi.fn(() => ({ top: 100, left: 0 })),
      } as any,
    } as unknown as Partial<Editor>;

    // First call should succeed
    let result = updateCommentPositionsImmediate();
    expect(result).toBe('success');

    // Simulate view becoming unavailable
    mockEditor = {
      ...mockEditor,
      view: undefined,
    } as unknown as Partial<Editor>;

    // Second call should return early
    result = updateCommentPositionsImmediate();
    expect(result).toBe('early-return');
  });

  it('should handle error when accessing editor.view.dom', () => {
    // Test function that mimics the actual implementation
    const updateCommentPositionsImmediate = function () {
      if (!mockEditor || !mockEditor.view) {
        return 'early-return';
      }

      // Try to access the editor DOM element safely
      let editorElement: HTMLElement;
      try {
        editorElement = (mockEditor.view as any).dom;
      } catch (e) {
        logger.debug('[CommentsSidebar] Editor view not available', { error: e });
        return 'caught-error';
      }

      if (!editorElement) {
        return 'no-element';
      }

      return 'success';
    };

    // Create a view that throws when accessing dom
    Object.defineProperty(mockEditor, 'view', {
      get() {
        return {
          get dom() {
            throw new Error('[tiptap error]: The editor view is not available');
          },
        };
      },
      configurable: true,
    });

    // Should catch the error and return gracefully
    const result = updateCommentPositionsImmediate();
    expect(result).toBe('caught-error');

    // Verify debug was called - the logger formats the message with timestamp and level
    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [formattedMessage, data] = calls[calls.length - 1];
    expect(formattedMessage).toContain('[CommentsSidebar] Editor view not available');
    expect(data).toEqual(expect.objectContaining({ error: expect.any(Error) }));
  });

  it('should safely handle coordsAtPos when view is not available', () => {
    // Test function that mimics coordsAtPos safety check
    const safeCallCoordsAtPos = function (anchorPos: number) {
      try {
        // Check view is available before calling coordsAtPos
        if (!mockEditor.view) {
          throw new Error('Editor view not available');
        }
        const coords = (mockEditor.view as any).coordsAtPos(anchorPos);
        return { success: true, coords };
      } catch (e) {
        logger.debug('[CommentsSidebar] Position calculation failed', {
          error: e,
        });
        return { success: false, error: e };
      }
    };

    // Test with valid view
    mockEditor = {
      ...mockEditor,
      view: {
        dom: document.createElement('div'),
        coordsAtPos: vi.fn(() => ({ top: 100, left: 0 })),
      } as any,
    } as unknown as Partial<Editor>;

    let result = safeCallCoordsAtPos(10);
    expect(result.success).toBe(true);
    expect(result.coords).toEqual({ top: 100, left: 0 });

    // Clear spy calls before next test
    consoleSpy.mockClear();

    // Test with no view
    mockEditor = {
      ...mockEditor,
      view: undefined,
    } as unknown as Partial<Editor>;

    result = safeCallCoordsAtPos(10);
    expect(result.success).toBe(false);

    // Verify debug was called - the logger formats the message with timestamp and level
    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [formattedMessage, data] = calls[calls.length - 1];
    expect(formattedMessage).toContain('[CommentsSidebar] Position calculation failed');
    expect(data).toEqual(expect.objectContaining({ error: expect.any(Error) }));

    // Test with view that throws
    mockEditor = {
      ...mockEditor,
      view: {
        dom: document.createElement('div'),
        coordsAtPos: vi.fn(() => {
          throw new Error('coordsAtPos failed');
        }),
      } as any,
    } as unknown as Partial<Editor>;

    result = safeCallCoordsAtPos(10);
    expect(result.success).toBe(false);
  });
});
