import {
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { render } from '@testing-library/svelte';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// Test component that uses useNodeTextContent
import TestUseNodeTextContent from './TestUseNodeTextContent.test.svelte';

describe('useNodeTextContent', () => {
  function createMockEditor(textBetweenResult: string = 'test content') {
    return {
      state: {
        doc: {
          textBetween: vi.fn().mockReturnValue(textBetweenResult),
        },
      },
    } as unknown as Editor;
  }

  function createMockNode(nodeSize: number = 10): ProseMirrorNode {
    return {
      nodeSize,
      type: { name: 'taskItem' },
    } as ProseMirrorNode;
  }

  it('should return text content from node', () => {
    const editor = createMockEditor('Hello world');
    const node = createMockNode(15);
    const getPos = vi.fn().mockReturnValue(5);

    const { container } = render(TestUseNodeTextContent, {
      props: { node, editor, getPos },
    });

    expect(container.textContent).toContain('Hello world');
    expect(editor.state.doc.textBetween).toHaveBeenCalledWith(5, 20, ' ', ' ');
  });

  it('should use custom separator', () => {
    const editor = createMockEditor('Line 1\nLine 2');
    const node = createMockNode(10);
    const getPos = vi.fn().mockReturnValue(0);

    const { container } = render(TestUseNodeTextContent, {
      props: { node, editor, getPos, separator: '\n' },
    });

    expect(container.textContent).toContain('Line 1\nLine 2');
    expect(editor.state.doc.textBetween).toHaveBeenCalledWith(0, 10, '\n', '\n');
  });

  it('should return empty string when getPos returns undefined', () => {
    const editor = createMockEditor('test');
    const node = createMockNode(10);
    const getPos = vi.fn().mockReturnValue(undefined);

    const { container } = render(TestUseNodeTextContent, {
      props: { node, editor, getPos },
    });

    expect(container.textContent).toBe('');
    expect(editor.state.doc.textBetween).not.toHaveBeenCalled();
  });

  it('should return empty string when getPos returns null', () => {
    const editor = createMockEditor('test');
    const node = createMockNode(10);
    const getPos = vi.fn().mockReturnValue(null);

    const { container } = render(TestUseNodeTextContent, {
      props: { node, editor, getPos },
    });

    expect(container.textContent).toBe('');
    expect(editor.state.doc.textBetween).not.toHaveBeenCalled();
  });

  it('should return empty string when textBetween throws error', () => {
    const editor = {
      state: {
        doc: {
          textBetween: vi.fn().mockImplementation(() => {
            throw new Error('Node deleted');
          }),
        },
      },
    } as unknown as Editor;
    const node = createMockNode(10);
    const getPos = vi.fn().mockReturnValue(5);

    const { container } = render(TestUseNodeTextContent, {
      props: { node, editor, getPos },
    });

    expect(container.textContent).toBe('');
  });

  it('should handle empty text content', () => {
    const editor = createMockEditor('');
    const node = createMockNode(5);
    const getPos = vi.fn().mockReturnValue(0);

    const { container } = render(TestUseNodeTextContent, {
      props: { node, editor, getPos },
    });

    expect(container.textContent).toBe('');
  });

  it('should calculate correct end position', () => {
    const editor = createMockEditor('content');
    const node = createMockNode(25);
    const getPos = vi.fn().mockReturnValue(10);

    render(TestUseNodeTextContent, {
      props: { node, editor, getPos },
    });

    expect(editor.state.doc.textBetween).toHaveBeenCalledWith(10, 35, ' ', ' ');
  });
});
