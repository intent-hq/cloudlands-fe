import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createScrollToHeadingHandler, createScrollToTaskHandler } from '../note-scroll-handlers';

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('note-scroll-handlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scrolls to a heading and sets selection when posAtDOM is available', () => {
    const container = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'My Heading';
    (h2 as any).scrollIntoView = vi.fn();
    container.appendChild(h2);

    const editor = {
      view: {
        posAtDOM: vi.fn(() => 123),
      },
      commands: {
        focus: vi.fn(),
        setTextSelection: vi.fn(),
      },
    };

    const handler = createScrollToHeadingHandler({
      getEditor: () => editor as any,
      getElement: () => container,
    });

    handler({ detail: { text: 'My Heading' } });

    expect((h2 as any).scrollIntoView).toHaveBeenCalled();
    expect(editor.view.posAtDOM).toHaveBeenCalledWith(h2, 0);
    expect(editor.commands.focus).toHaveBeenCalled();
    expect(editor.commands.setTextSelection).toHaveBeenCalledWith({ from: 123, to: 123 });
  });

  it('scrolls to task by position and highlights', () => {
    const logger = createLogger();
    const highlightTaskAtPosition = vi.fn();

    const editor = {
      view: {},
      state: { doc: { content: { size: 50 } } },
      commands: {
        smoothScrollToPos: vi.fn(),
      },
    };

    const handler = createScrollToTaskHandler({
      getEditor: () => editor as any,
      getElement: () => null,
      getNoteId: () => 'note-1',
      highlightTaskAtPosition,
      logger: logger as any,
    });

    handler({ detail: { noteId: 'note-1', taskPosition: 10 } });

    expect(editor.commands.smoothScrollToPos).toHaveBeenCalledWith(10, {
      offset: 80,
      block: 'center',
    });
    expect(highlightTaskAtPosition).toHaveBeenCalledWith(10);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('ignores scroll-to-task events for other notes', () => {
    const logger = createLogger();
    const highlightTaskAtPosition = vi.fn();
    const editor = {
      view: {},
      state: { doc: { content: { size: 50 } } },
      commands: {
        smoothScrollToPos: vi.fn(),
      },
    };

    const handler = createScrollToTaskHandler({
      getEditor: () => editor as any,
      getElement: () => null,
      getNoteId: () => 'note-1',
      highlightTaskAtPosition,
      logger: logger as any,
    });

    handler({ detail: { noteId: 'note-2', taskPosition: 10 } });

    expect(editor.commands.smoothScrollToPos).not.toHaveBeenCalled();
    expect(highlightTaskAtPosition).not.toHaveBeenCalled();
  });

  it('falls back to searching by text and adds a flash class', () => {
    const logger = createLogger();
    const highlightTaskAtPosition = vi.fn();

    const container = document.createElement('div');
    const taskItem = document.createElement('div');
    taskItem.setAttribute('data-type', 'taskItem');
    taskItem.textContent = 'Do the thing (expanded)';
    (taskItem as any).scrollIntoView = vi.fn();
    container.appendChild(taskItem);

    const editor = {
      view: {},
      state: { doc: { content: { size: 50 } } },
      commands: {
        smoothScrollToPos: vi.fn(),
      },
    };

    const handler = createScrollToTaskHandler({
      getEditor: () => editor as any,
      getElement: () => container,
      getNoteId: () => 'note-1',
      highlightTaskAtPosition,
      logger: logger as any,
    });

    handler({ detail: { noteId: 'note-1', taskText: 'Do the thing' } });

    expect((taskItem as any).scrollIntoView).toHaveBeenCalled();
    expect(taskItem.classList.contains('task-highlight-flash')).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(taskItem.classList.contains('task-highlight-flash')).toBe(false);
  });
});
