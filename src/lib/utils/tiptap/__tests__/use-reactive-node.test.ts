import {
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { render } from '@testing-library/svelte';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// Test component that uses useReactiveNode
import TestUseReactiveNode from './TestUseReactiveNode.test.svelte';

describe('useReactiveNode', () => {
  function createMockEditor(): Editor {
    const listeners: Record<string, Function[]> = {};

    return {
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      }),
      off: vi.fn((event: string, handler: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      }),
      state: {
        doc: {
          nodeAt: vi.fn(),
        },
      },
      // Helper to trigger update event
      _triggerUpdate: () => {
        listeners['update']?.forEach((handler) => handler());
      },
      _listeners: listeners,
    } as any;
  }

  function createMockNode(attrs: Record<string, any> = {}): ProseMirrorNode {
    return {
      attrs,
      type: { name: 'taskItem' },
      nodeSize: 10,
    } as ProseMirrorNode;
  }

  it('should return initial node value', () => {
    const node = createMockNode({ checked: false, status: 'todo' });
    const editor = createMockEditor();
    const getPos = vi.fn().mockReturnValue(0);

    const { container } = render(TestUseReactiveNode, {
      props: { node, editor, getPos },
    });

    expect(container.textContent).toContain('checked: false');
    expect(container.textContent).toContain('status: todo');
  });

  it('should subscribe to editor updates on mount', () => {
    const node = createMockNode({ checked: false, status: 'todo' });
    const editor = createMockEditor();
    const getPos = vi.fn().mockReturnValue(0);

    render(TestUseReactiveNode, {
      props: { node, editor, getPos, attributeKeys: ['checked', 'status'] },
    });

    // Should subscribe to 'update' event
    expect(editor.on).toHaveBeenCalledWith('update', expect.any(Function));
  });

  it('should only watch specified attribute keys', () => {
    const node = createMockNode({ checked: false, status: 'todo', other: 'value' });
    const editor = createMockEditor();
    const getPos = vi.fn().mockReturnValue(0);

    // Updated node with only 'other' changed
    const updatedNode = createMockNode({ checked: false, status: 'todo', other: 'changed' });
    (editor.state.doc.nodeAt as any).mockReturnValue(updatedNode);

    const { container } = render(TestUseReactiveNode, {
      props: { node, editor, getPos, attributeKeys: ['checked', 'status'] },
    });

    const initialCounter = container.textContent?.match(/counter: (\d+)/)?.[1];

    // Trigger update
    (editor as any)._triggerUpdate();

    const updatedCounter = container.textContent?.match(/counter: (\d+)/)?.[1];

    // Counter should NOT increment because watched attributes didn't change
    expect(updatedCounter).toBe(initialCounter);
  });

  it('should provide updateCounter property', () => {
    const node = createMockNode({ checked: false, other: 'value' });
    const editor = createMockEditor();
    const getPos = vi.fn().mockReturnValue(0);

    const { container } = render(TestUseReactiveNode, {
      props: { node, editor, getPos },
    });

    // Should have counter in output
    expect(container.textContent).toMatch(/counter: \d+/);
  });

  it('should handle invalid position', () => {
    const node = createMockNode({ checked: false });
    const editor = createMockEditor();
    const getPos = vi.fn().mockReturnValue(undefined);

    const { container } = render(TestUseReactiveNode, {
      props: { node, editor, getPos },
    });

    // Should still render initial node
    expect(container.textContent).toContain('checked: false');

    // Trigger update - should not crash
    (editor as any)._triggerUpdate();

    // Should not call nodeAt
    expect(editor.state.doc.nodeAt).not.toHaveBeenCalled();
  });

  it('should handle node deletion', () => {
    const node = createMockNode({ checked: false });
    const editor = createMockEditor();
    const getPos = vi.fn().mockReturnValue(0);

    // Mock nodeAt to return null (node deleted)
    (editor.state.doc.nodeAt as any).mockReturnValue(null);

    const { container } = render(TestUseReactiveNode, {
      props: { node, editor, getPos },
    });

    // Trigger update - should not crash
    (editor as any)._triggerUpdate();

    // Should still show initial node
    expect(container.textContent).toContain('checked: false');
  });

  it('should unsubscribe on unmount', () => {
    const node = createMockNode({ checked: false });
    const editor = createMockEditor();
    const getPos = vi.fn().mockReturnValue(0);

    const { unmount } = render(TestUseReactiveNode, {
      props: { node, editor, getPos },
    });

    expect(editor.on).toHaveBeenCalledWith('update', expect.any(Function));

    unmount();

    expect(editor.off).toHaveBeenCalledWith('update', expect.any(Function));
  });
});
