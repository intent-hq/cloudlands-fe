import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import BubbleMenu from '../BubbleMenu.svelte';
import TooltipWrapper from '../comments/__tests__/TooltipWrapper.svelte';

// Mock the createLogger function at module level
vi.mock('$lib/utils/client-logger', () => {
  // Create mock logger inside the factory function to avoid hoisting issues
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    createLogger: () => mockLogger,
    logger: mockLogger,
  };
});

// Mock agent context
vi.mock('$features/agent/agent-context', () => ({
  convertContextReferences: vi.fn().mockReturnValue([]),
}));

// Mock instruction registry
vi.mock('$features/agent/instruction-registry', () => ({
  getAgentTypes: vi.fn().mockReturnValue([]),
}));

// Mock model selectors
vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: () => ({ subscribe: (fn: (v: string) => void) => { fn('test-model'); return () => {}; } }),
  selectSelectedModel: () => ({ subscribe: (fn: (v: string) => void) => { fn('test-model'); return () => {}; } }),
}));

// Mock UnifiedAgentFactory
vi.mock('$features/agent/services/agent-factory', () => ({
  UnifiedAgentFactory: vi.fn(),
}));

describe('BubbleMenu', () => {
  let mockEditor: any;
  let mockWorkspace: any;
  let editorEventHandlers: Record<string, Function[]> = {};

  // Helper function to trigger editor selection update and wait for component to update
  const triggerSelectionUpdate = async () => {
    await tick();
    const selectionHandlers = editorEventHandlers['selectionUpdate'] || [];
    selectionHandlers.forEach((handler) => handler());
    await tick();
  };

  const renderBubbleMenu = () =>
    render(TooltipWrapper, {
      props: {
        component: BubbleMenu,
        props: {
          editor: mockEditor,
          workspace: mockWorkspace,
        },
      },
    });

  beforeEach(() => {
    // Clear mock calls
    vi.clearAllMocks();

    // Reset event handlers
    editorEventHandlers = {};

    // Mock workspace
    mockWorkspace = {
      id: 'test-workspace-id',
      title: 'Test Workspace',
    };

    // Mock TipTap editor with all required methods
    mockEditor = {
      isActive: vi.fn(() => false),
      isFocused: true, // IMPORTANT: Bubble menu requires editor to be focused
      can: vi.fn(() => ({
        chain: vi.fn(() => ({
          focus: vi.fn(() => ({
            toggleBold: vi.fn(() => ({ run: vi.fn(() => true) })),
            toggleItalic: vi.fn(() => ({ run: vi.fn(() => true) })),
            toggleStrike: vi.fn(() => ({ run: vi.fn(() => true) })),
            toggleCode: vi.fn(() => ({ run: vi.fn(() => true) })),
            toggleUnderline: vi.fn(() => ({ run: vi.fn(() => true) })),
            toggleHighlight: vi.fn(() => ({ run: vi.fn(() => true) })),
            setLink: vi.fn(() => ({ run: vi.fn(() => true) })),
            unsetLink: vi.fn(() => ({ run: vi.fn(() => true) })),
          })),
        })),
      })),
      chain: vi.fn(() => ({
        focus: vi.fn(() => ({
          toggleBold: vi.fn(() => ({ run: vi.fn() })),
          toggleItalic: vi.fn(() => ({ run: vi.fn() })),
          toggleStrike: vi.fn(() => ({ run: vi.fn() })),
          toggleCode: vi.fn(() => ({ run: vi.fn() })),
          toggleUnderline: vi.fn(() => ({ run: vi.fn() })),
          toggleHighlight: vi.fn(() => ({ run: vi.fn() })),
          setLink: vi.fn(() => ({ run: vi.fn() })),
          unsetLink: vi.fn(() => ({ run: vi.fn() })),
        })),
      })),
      getAttributes: vi.fn(() => ({ href: '' })),
      state: {
        selection: {
          from: 0,
          to: 10,
        },
        doc: {
          textBetween: vi.fn(() => 'selected text'),
        },
      },
      commands: {
        setTextSelection: vi.fn(),
        focus: vi.fn(),
      },
      // Add view for position calculations
      view: {
        coordsAtPos: vi.fn((pos) => ({
          left: 100,
          top: 100,
          right: 200,
          bottom: 120,
        })),
        dom: {
          parentElement: {
            getBoundingClientRect: vi.fn(() => ({
              left: 0,
              top: 0,
              right: 800,
              bottom: 600,
            })),
          },
        },
      },
      // Add event handling methods that actually store and trigger handlers
      on: vi.fn((event, handler) => {
        if (!editorEventHandlers[event]) {
          editorEventHandlers[event] = [];
        }
        editorEventHandlers[event].push(handler);
      }),
      off: vi.fn((event, handler) => {
        if (editorEventHandlers[event]) {
          editorEventHandlers[event] = editorEventHandlers[event].filter((h) => h !== handler);
        }
      }),
    };
  });

  it('should render bubble menu when text is selected', async () => {
    renderBubbleMenu();

    await triggerSelectionUpdate();

    // BubbleMenu renders via Portal to document.body
    const bubbleMenu = document.body.querySelector('.bubble-menu-floating');
    expect(bubbleMenu).toBeTruthy();
  });

  it('should toggle bold formatting', async () => {
    renderBubbleMenu();

    await triggerSelectionUpdate();

    // BubbleMenu renders via Portal to document.body
    const boldButton = document.body.querySelector('[aria-label="Bold"]');
    expect(boldButton).toBeTruthy();

    await fireEvent.click(boldButton!);

    expect(mockEditor.chain).toHaveBeenCalled();
  });

  it('should toggle italic formatting', async () => {
    renderBubbleMenu();

    await triggerSelectionUpdate();

    // BubbleMenu renders via Portal to document.body
    const italicButton = document.body.querySelector('[aria-label="Italic"]');
    expect(italicButton).toBeTruthy();

    await fireEvent.click(italicButton!);

    expect(mockEditor.chain).toHaveBeenCalled();
  });

  it('should show link input when link button is clicked', async () => {
    renderBubbleMenu();

    await triggerSelectionUpdate();

    // BubbleMenu renders via Portal to document.body
    const linkButton = document.body.querySelector('[aria-label="Add link"]');
    expect(linkButton).toBeTruthy();

    await fireEvent.click(linkButton!);
    await tick();

    // Check if link input is shown - the component uses type="text" not type="url"
    const linkInput = document.body.querySelector('.bubble-menu-floating input[type="text"]');
    expect(linkInput).toBeTruthy();
    expect(linkInput?.getAttribute('placeholder')).toContain('Enter URL');
  });

  it('should set link with URL', async () => {
    renderBubbleMenu();

    await triggerSelectionUpdate();

    // Click link button - BubbleMenu renders via Portal to document.body
    const linkButton = document.body.querySelector('[aria-label="Add link"]');
    await fireEvent.click(linkButton!);
    await tick();

    // Enter URL - the component uses type="text" not type="url"
    const linkInput = document.body.querySelector(
      '.bubble-menu-floating input[type="text"]',
    ) as HTMLInputElement;
    expect(linkInput).toBeTruthy();

    await fireEvent.input(linkInput, { target: { value: 'https://example.com' } });
    await fireEvent.keyDown(linkInput, { key: 'Enter' });

    expect(mockEditor.chain).toHaveBeenCalled();
  });

  it('should handle code formatting', async () => {
    renderBubbleMenu();

    await triggerSelectionUpdate();

    // BubbleMenu renders via Portal to document.body
    const codeButton = document.body.querySelector('[aria-label="Code"]');
    expect(codeButton).toBeTruthy();

    await fireEvent.click(codeButton!);

    expect(mockEditor.chain).toHaveBeenCalled();
  });

  it('should show active state for enabled formats', async () => {
    mockEditor.isActive.mockImplementation((format: string) => format === 'bold');

    renderBubbleMenu();

    await triggerSelectionUpdate();

    // BubbleMenu renders via Portal to document.body
    const boldButton = document.body.querySelector('[aria-label="Bold"]');
    expect(boldButton?.getAttribute('data-active')).toBe('true');
  });

  it('should handle strikethrough formatting', async () => {
    renderBubbleMenu();

    await triggerSelectionUpdate();

    // BubbleMenu renders via Portal to document.body
    const strikeButton = document.body.querySelector('[aria-label="Strikethrough"]');
    expect(strikeButton).toBeTruthy();

    await fireEvent.click(strikeButton!);

    expect(mockEditor.chain).toHaveBeenCalled();
  });
});
