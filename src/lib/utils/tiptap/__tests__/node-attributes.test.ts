import { describe, it, expect, vi } from 'vitest';
import { updateNodeAttributes } from '../node-attributes';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

describe('updateNodeAttributes', () => {
  // Create mock editor with chainable API
  function createMockEditor() {
    const runFn = vi.fn().mockReturnValue(true);
    const commandFn = vi.fn().mockReturnValue({ run: runFn });
    const focusFn = vi.fn().mockReturnValue({ command: commandFn });
    const chainFn = vi.fn().mockReturnValue({ focus: focusFn, command: commandFn });

    return {
      editor: { chain: chainFn } as unknown as Editor,
      mocks: { chain: chainFn, focus: focusFn, command: commandFn, run: runFn },
    };
  }

  function createMockNode(attrs: Record<string, any> = {}): ProseMirrorNode {
    return {
      attrs,
      type: { name: 'taskItem' },
    } as ProseMirrorNode;
  }

  it('should update node attributes with merge', () => {
    const { editor, mocks } = createMockEditor();
    const node = createMockNode({ checked: false, status: 'todo', other: 'value' });
    const getPos = vi.fn().mockReturnValue(10);

    const result = updateNodeAttributes(editor, getPos, node, {
      checked: true,
      status: 'done',
    });

    expect(result).toBe(true);
    expect(mocks.chain).toHaveBeenCalled();
    expect(mocks.focus).toHaveBeenCalled();
    expect(mocks.command).toHaveBeenCalled();

    // Check that command was called with merged attributes
    const commandArg = mocks.command.mock.calls[0][0];
    const mockTr = { setNodeMarkup: vi.fn() };
    commandArg({ tr: mockTr });

    expect(mockTr.setNodeMarkup).toHaveBeenCalledWith(10, undefined, {
      checked: true,
      status: 'done',
      other: 'value',
    });
  });

  it('should update without merge when merge=false', () => {
    const { editor, mocks } = createMockEditor();
    const node = createMockNode({ checked: false, status: 'todo', other: 'value' });
    const getPos = vi.fn().mockReturnValue(10);

    updateNodeAttributes(
      editor,
      getPos,
      node,
      {
        checked: true,
        status: 'done',
      },
      { merge: false },
    );

    const commandArg = mocks.command.mock.calls[0][0];
    const mockTr = { setNodeMarkup: vi.fn() };
    commandArg({ tr: mockTr });

    // Should only have new attributes, not merged
    expect(mockTr.setNodeMarkup).toHaveBeenCalledWith(10, undefined, {
      checked: true,
      status: 'done',
    });
  });

  it('should not focus when focus=false', () => {
    const { editor, mocks } = createMockEditor();
    const node = createMockNode({ checked: false });
    const getPos = vi.fn().mockReturnValue(10);

    updateNodeAttributes(editor, getPos, node, { checked: true }, { focus: false });

    expect(mocks.chain).toHaveBeenCalled();
    expect(mocks.focus).not.toHaveBeenCalled();
    expect(mocks.command).toHaveBeenCalled();
  });

  it('should return false when getPos returns undefined', () => {
    const { editor } = createMockEditor();
    const node = createMockNode({ checked: false });
    const getPos = vi.fn().mockReturnValue(undefined);

    const result = updateNodeAttributes(editor, getPos, node, { checked: true });

    expect(result).toBe(false);
  });

  it('should return false when getPos returns non-number', () => {
    const { editor } = createMockEditor();
    const node = createMockNode({ checked: false });
    const getPos = vi.fn().mockReturnValue(null);

    const result = updateNodeAttributes(editor, getPos, node, { checked: true });

    expect(result).toBe(false);
  });

  it('should handle empty newAttrs', () => {
    const { editor, mocks } = createMockEditor();
    const node = createMockNode({ checked: false, status: 'todo' });
    const getPos = vi.fn().mockReturnValue(10);

    updateNodeAttributes(editor, getPos, node, {});

    const commandArg = mocks.command.mock.calls[0][0];
    const mockTr = { setNodeMarkup: vi.fn() };
    commandArg({ tr: mockTr });

    // Should still have original attributes
    expect(mockTr.setNodeMarkup).toHaveBeenCalledWith(10, undefined, {
      checked: false,
      status: 'todo',
    });
  });
});
