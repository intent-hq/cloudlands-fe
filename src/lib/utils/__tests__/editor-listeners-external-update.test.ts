/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

/**
 * Test that external updates properly use the external-update meta flag
 * to prevent infinite loops and lost edits.
 *
 * This pattern is used in NoteWithComments.svelte when applying external
 * content updates from the store.
 */
describe('external-update meta flag pattern', () => {
  let editor: Editor;
  let onUpdateSpy: ReturnType<typeof vi.fn>;
  let container: HTMLElement;

  beforeEach(() => {
    // Create a container for the editor
    container = document.createElement('div');
    document.body.appendChild(container);

    // Create spy for onUpdate callback
    onUpdateSpy = vi.fn();

    // Create editor with onUpdate handler that checks for external-update meta
    editor = new Editor({
      element: container,
      extensions: [StarterKit],
      content: '<p>Initial content</p>',
      onUpdate: ({ editor, transaction }) => {
        // This mimics the check in editor-config.ts
        if (transaction?.getMeta('external-update')) {
          // Should NOT call the spy for external updates
          return;
        }
        onUpdateSpy(editor.getHTML());
      },
    });
  });

  afterEach(() => {
    editor.destroy();
    document.body.removeChild(container);
  });

  it('should NOT trigger onUpdate when setContent is called with external-update meta', () => {
    onUpdateSpy.mockClear();

    // Simulate what NoteWithComments.svelte does when applying external updates
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta('external-update', true);
        return true;
      })
      .setContent('<p>New content from agent</p>')
      .run();

    // onUpdate should NOT have been called
    expect(onUpdateSpy).not.toHaveBeenCalled();

    // But content should be updated
    expect(editor.getHTML()).toContain('New content from agent');
  });

  it('should trigger onUpdate when setContent is called WITHOUT external-update meta', () => {
    onUpdateSpy.mockClear();

    // Simulate a user edit (no external-update meta)
    editor.commands.setContent('<p>User typed this</p>');

    // onUpdate SHOULD have been called
    expect(onUpdateSpy).toHaveBeenCalledTimes(1);
    expect(onUpdateSpy).toHaveBeenCalledWith(expect.stringContaining('User typed this'));
  });

  it('should handle multiple external updates without triggering onUpdate', () => {
    onUpdateSpy.mockClear();

    // Simulate multiple agent updates
    for (let i = 0; i < 5; i++) {
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta('external-update', true);
          return true;
        })
        .setContent(`<p>Agent update ${i}</p>`)
        .run();
    }

    // onUpdate should NOT have been called at all
    expect(onUpdateSpy).not.toHaveBeenCalled();

    // But content should reflect the last update
    expect(editor.getHTML()).toContain('Agent update 4');
  });

  it('should prevent race condition: user types, agent updates, user continues typing', async () => {
    onUpdateSpy.mockClear();

    // 1. User types
    editor.commands.setContent('<p>User is typing...</p>');
    expect(onUpdateSpy).toHaveBeenCalledTimes(1);

    // 2. Agent sends update (with external-update meta)
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta('external-update', true);
        return true;
      })
      .setContent('<p>Agent overwrites</p>')
      .run();

    // onUpdate should still only have been called once (from user edit)
    expect(onUpdateSpy).toHaveBeenCalledTimes(1);

    // 3. User continues typing
    editor.commands.setContent('<p>User continues typing</p>');

    // Now onUpdate should have been called twice (both user edits)
    expect(onUpdateSpy).toHaveBeenCalledTimes(2);
  });

  it('should handle error case with external-update meta', () => {
    onUpdateSpy.mockClear();

    // Simulate error case where we fall back to simple paragraph
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta('external-update', true);
        return true;
      })
      .setContent('<p>Error fallback content</p>')
      .run();

    // onUpdate should NOT have been called
    expect(onUpdateSpy).not.toHaveBeenCalled();

    // Content should be updated
    expect(editor.getHTML()).toContain('Error fallback content');
  });

  it('should handle HTML content with external-update meta', () => {
    onUpdateSpy.mockClear();

    // Simulate HTML content (not markdown) with external-update meta
    const htmlContent = '<p>This is <strong>HTML</strong> content</p>';

    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta('external-update', true);
        return true;
      })
      .setContent(htmlContent)
      .run();

    // onUpdate should NOT have been called
    expect(onUpdateSpy).not.toHaveBeenCalled();

    // Content should be updated
    expect(editor.getHTML()).toContain('This is');
    expect(editor.getHTML()).toContain('<strong>HTML</strong>');
  });
});
