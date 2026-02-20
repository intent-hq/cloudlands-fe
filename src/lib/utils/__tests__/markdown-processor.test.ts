/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core';
import { createEditorConfig } from '../editor-config';
import { describe, it, expect } from 'vitest';
import { processMarkdownToHTML, processHTMLToMarkdown } from '../markdown-processor';

describe('TipTap Markdown Processor - Round Trip Tests', () => {
  describe('Basic Elements', () => {
    it('should handle empty content', async () => {
      const markdown = '';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe('');
    });

    it('should handle simple paragraph', async () => {
      const markdown = 'Hello world';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle multiple paragraphs', async () => {
      const markdown = 'First paragraph\n\nSecond paragraph';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle headings', async () => {
      const markdown = '# Heading 1\n\n## Heading 2\n\n### Heading 3';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle bold text', async () => {
      const markdown = 'This is **bold** text';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle italic text', async () => {
      const markdown = 'This is *italic* text';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle code inline', async () => {
      const markdown = 'This is `code` inline';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });
  });

  describe('Lists', () => {
    it('should handle bullet list', async () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle ordered list', async () => {
      const markdown = '1. First\n2. Second\n3. Third';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle nested bullet lists', async () => {
      const markdown = '- Item 1\n  - Nested 1\n  - Nested 2\n- Item 2';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle nested ordered lists', async () => {
      // Note: marked requires 4 spaces for nested ordered lists (not 2 spaces like bullet lists)
      const markdown = '1. Parent item\n    1. Nested child\n2. Next parent item';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle deeply nested ordered lists', async () => {
      // Note: marked requires 4 spaces per nesting level for ordered lists
      const markdown =
        '1. Item 1\n2. Item 2\n3. Item 3\n    1. Nested item\n        1. More nesting\n4. Item 4';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });
  });

  describe('Task Lists', () => {
    it('should handle unchecked task', async () => {
      const markdown = '- [ ] Unchecked task';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle checked task', async () => {
      const markdown = '- [x] Checked task';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle in-progress task', async () => {
      const markdown = '- [/] In-progress task';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle multiple tasks', async () => {
      const markdown = '- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle mixed task states (todo, in-progress, done)', async () => {
      const markdown = '- [ ] Todo task\n- [/] In-progress task\n- [x] Done task';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle nested tasks', async () => {
      const markdown = '- [ ] Parent task\n  - [ ] Child task 1\n  - [x] Child task 2';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle tasks with formatting', async () => {
      const markdown = '- [ ] Task with **bold** text\n- [x] Task with *italic* text';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle deeply nested tasks', async () => {
      const markdown =
        '- [ ] Level 1\n  - [ ] Level 2\n      - [ ] Level 3\n          - [x] Level 4';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });
  });

  describe('Mixed Content', () => {
    it('should handle paragraph followed by task list', async () => {
      const markdown = 'Some text\n\n- [ ] Task 1\n- [x] Task 2';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle task list followed by paragraph', async () => {
      const markdown = '- [ ] Task 1\n- [x] Task 2\n\nSome text after';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should handle mixed regular and task lists', async () => {
      const markdown = '- Regular item\n- [ ] Task item\n- Another regular item';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      // Note: TipTap might normalize this - we'll see what happens
      expect(result).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle task with empty text', async () => {
      const markdown = '- [ ] ';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      // Normalize whitespace
      expect(result.trim()).toBeTruthy();
    });

    it('should handle multiple blank lines', async () => {
      const markdown = 'Paragraph 1\n\n\n\nParagraph 2';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);
      // TipTap normalizes multiple blank lines to single blank line
      expect(result).toContain('Paragraph 1');
      expect(result).toContain('Paragraph 2');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle complex document with mixed content', async () => {
      const markdown = `# Project Tasks

This is a description of the project.

## Todo List

- [ ] Task 1 with **bold**
- [x] Completed task
  - [ ] Subtask 1
  - [x] Subtask 2

## Notes

Some additional notes here.

- Regular bullet point
- Another point`;

      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);

      // Verify key elements are preserved
      expect(result).toContain('# Project Tasks');
      expect(result).toContain('## Todo List');
      expect(result).toContain('- [ ] Task 1 with **bold**');
      expect(result).toContain('- [x] Completed task');
      expect(result).toContain('## Notes');
    });

    it('should handle task list with multiple levels and formatting', async () => {
      const markdown = `- [ ] Main task with *emphasis*
  - [ ] Subtask with \`code\`
    - [x] Deep subtask with **bold**
  - [x] Another subtask
- [ ] Second main task`;

      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);

      // Verify structure is preserved
      expect(result).toContain('- [ ] Main task');
      expect(result).toContain('- [ ] Subtask');
      expect(result).toContain('- [x] Deep subtask');
    });
  });

  describe('HTML to Markdown - Direct Tests', () => {
    it('should convert simple paragraph HTML to markdown', () => {
      const html = '<p>Hello world</p>';
      const result = processHTMLToMarkdown(html);
      expect(result).toBe('Hello world');
    });

    it('should convert task list HTML to markdown', () => {
      const html =
        '<ul data-type="taskList" class="task-list"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Task 1</p></div></li></ul>';
      const result = processHTMLToMarkdown(html);
      expect(result).toContain('- [ ]');
      expect(result).toContain('Task 1');
    });
  });

  describe('Markdown to HTML - Direct Tests', () => {
    it('should convert simple markdown to HTML', async () => {
      const markdown = 'Hello world';
      const html = await processMarkdownToHTML(markdown);
      expect(html).toContain('Hello world');
      expect(html).toContain('<p>');
    });

    it('should convert task list markdown to HTML', async () => {
      const markdown = '- [ ] Task 1\n- [x] Task 2';
      const html = await processMarkdownToHTML(markdown);
      expect(html).toContain('data-type="taskList"');
      expect(html).toContain('data-type="taskItem"');
      expect(html).toContain('data-checked="false"');
      expect(html).toContain('data-checked="true"');
    });

    it('should preserve intent:// links in markdown', async () => {
      const markdown =
        '[Sea Otter Joke](intent://local/note/b0c3bfa5-9ba4-4986-b67e-78494def4687)';
      const html = await processMarkdownToHTML(markdown);

      // Check that the link is preserved in HTML
      expect(html).toContain('<a');
      expect(html).toContain('href="intent://local/note/b0c3bfa5-9ba4-4986-b67e-78494def4687"');
      expect(html).toContain('Sea Otter Joke');
    });

    it('should preserve intent:// links with surrounding text', async () => {
      const markdown =
        '**More Sea Otter Humor**: Check out this [Sea Otter Joke](intent://local/note/test-id)';
      const html = await processMarkdownToHTML(markdown);

      // Check that both bold text and link are preserved
      expect(html).toContain('<strong>More Sea Otter Humor</strong>');
      expect(html).toContain('<a');
      expect(html).toContain('href="intent://local/note/test-id"');
      expect(html).toContain('Sea Otter Joke');
    });

    it('should preserve cross-workspace links (long format with workspace ID)', async () => {
      // Cross-workspace format: intent://local/{workspace-id}/note/{note-id}
      const markdown = '[Sibling Spec](intent://local/workspace-abc-123/note/spec)';
      const html = await processMarkdownToHTML(markdown);

      // Check that the link is preserved in HTML with full cross-workspace path
      expect(html).toContain('<a');
      expect(html).toContain('href="intent://local/workspace-abc-123/note/spec"');
      expect(html).toContain('Sibling Spec');
    });

    it('should preserve multiple cross-workspace links in same message', async () => {
      const markdown =
        'See the [Main Spec](intent://local/note/spec) and also check the [Other Workspace Spec](intent://local/other-ws/note/spec) for comparison.';
      const html = await processMarkdownToHTML(markdown);

      // Both links should be preserved
      expect(html).toContain('href="intent://local/note/spec"');
      expect(html).toContain('Main Spec');
      expect(html).toContain('href="intent://local/other-ws/note/spec"');
      expect(html).toContain('Other Workspace Spec');
    });
  });

  describe('Tiptap Editor Integration - intent:// links', () => {
    it('should preserve intent:// links when loaded into Tiptap editor', async () => {
      const markdown = '[Note Link](intent://local/note/spec)';
      const html = await processMarkdownToHTML(markdown);

      // Verify HTML has the link
      expect(html).toContain('href="intent://local/note/spec"');

      // Create Tiptap editor with the actual editor config used in the app
      const config = createEditorConfig({
        workspaceId: 'test-workspace',
        noteId: 'test-note',
        onUpdate: () => {},
        onSelectionUpdate: () => {},
        editable: true,
      });

      const editor = new Editor({
        ...config,
        content: html,
      });

      // Get HTML back from editor
      const editorHtml = editor.getHTML();

      // Verify link is preserved
      expect(editorHtml).toContain('href="intent://local/note/spec"');
      expect(editorHtml).toContain('Note Link');

      editor.destroy();
    });

    it('should preserve intent:// links in complex content', async () => {
      const markdown =
        '**More Sea Otter Humor**: Check out this [Sea Otter Joke](intent://local/note/b0c3bfa5-9ba4-4986-b67e-78494def4687)';
      const html = await processMarkdownToHTML(markdown);

      // Create editor
      const config = createEditorConfig({
        workspaceId: 'test-workspace',
        noteId: 'test-note',
        onUpdate: () => {},
        onSelectionUpdate: () => {},
        editable: true,
      });

      const editor = new Editor({
        ...config,
        content: html,
      });

      // Get HTML back from editor
      const editorHtml = editor.getHTML();

      // Verify both bold and link are preserved
      expect(editorHtml).toContain('<strong>More Sea Otter Humor</strong>');
      expect(editorHtml).toContain(
        'href="intent://local/note/b0c3bfa5-9ba4-4986-b67e-78494def4687"',
      );
      expect(editorHtml).toContain('Sea Otter Joke');

      editor.destroy();
    });
  });

  describe('HTML to Markdown - Links', () => {
    it('should convert regular links from HTML to markdown', () => {
      const html = '<p><a href="https://example.com">Example Link</a></p>';
      const result = processHTMLToMarkdown(html);
      expect(result).toBe('[Example Link](https://example.com)');
    });

    it('should convert intent:// links from HTML to markdown', () => {
      const html = '<p><a href="intent://local/note/test-id">Note Link</a></p>';
      const result = processHTMLToMarkdown(html);
      expect(result).toBe('[Note Link](intent://local/note/test-id)');
    });

    it('should convert links with surrounding text from HTML to markdown', () => {
      const html = '<p>Check out <a href="https://example.com">this link</a> for more info</p>';
      const result = processHTMLToMarkdown(html);
      expect(result).toBe('Check out [this link](https://example.com) for more info');
    });
  });

  describe('Task Items with intent:// links', () => {
    it('should preserve intent://local/task/ links in task items during markdown->HTML conversion', async () => {
      const markdown = '- [ ] [delegated](intent://local/task/abc123)';
      const html = await processMarkdownToHTML(markdown);

      // Verify the HTML contains the link
      expect(html).toContain('data-type="taskItem"');
      expect(html).toContain('href="intent://local/task/abc123"');
      expect(html).toContain('delegated');
    });

    it('should preserve intent://local/task/ links when loaded into Tiptap editor', async () => {
      const markdown = '- [ ] [delegated](intent://local/task/abc123)';
      const html = await processMarkdownToHTML(markdown);

      // Create Tiptap editor
      const config = createEditorConfig({
        workspaceId: 'test-workspace',
        noteId: 'test-note',
        onUpdate: () => {},
        onSelectionUpdate: () => {},
        editable: true,
      });

      const editor = new Editor({
        ...config,
        content: html,
      });

      // Get HTML back from editor
      const editorHtml = editor.getHTML();

      // Verify the link is preserved
      expect(editorHtml).toContain('data-type="taskItem"');
      expect(editorHtml).toContain('href="intent://local/task/abc123"');
      expect(editorHtml).toContain('delegated');

      // Get JSON to inspect node structure
      const json = editor.getJSON();
      console.log('[TEST] Editor JSON:', JSON.stringify(json, null, 2));

      editor.destroy();
    });

    it('should preserve intent://local/task/ links through full round-trip', async () => {
      const markdown = '- [ ] [delegated](intent://local/task/abc123)';
      const html = await processMarkdownToHTML(markdown);
      const result = processHTMLToMarkdown(html);

      // Verify the link is preserved in markdown
      expect(result).toContain('[delegated](intent://local/task/abc123)');
    });

    it('should preserve intent://local/task/ links through TipTap editor round-trip', async () => {
      const markdown = '- [ ] [delegated](intent://local/task/abc123)';
      const html = await processMarkdownToHTML(markdown);

      // Create Tiptap editor with MARKDOWN mode (matching NoteWithComments)
      const config = createEditorConfig({
        workspaceId: 'test-workspace',
        noteId: 'test-note',
        onUpdate: () => {},
        onSelectionUpdate: () => {},
        editable: true,
        useMarkdown: true, // This is key - NoteWithComments uses markdown mode
      });

      const editor = new Editor({
        ...config,
        content: html,
      });

      // Get HTML from editor (simulating what NoteWithComments does on save)
      const editorHtml = editor.getHTML();
      console.log('[TEST] Editor HTML output:', editorHtml);

      // Convert back to markdown
      const result = processHTMLToMarkdown(editorHtml);
      console.log('[TEST] Markdown result:', result);

      // Verify the link is preserved
      expect(result).toContain('[delegated](intent://local/task/abc123)');

      editor.destroy();
    });

    it('should convert regular task item to linked task using convertToLinkedTask command', async () => {
      // Start with a regular task item
      const markdown = '- [ ] Some task text';
      const html = await processMarkdownToHTML(markdown);

      // Create Tiptap editor with MARKDOWN mode
      const config = createEditorConfig({
        workspaceId: 'test-workspace',
        noteId: 'test-note',
        onUpdate: () => {},
        onSelectionUpdate: () => {},
        editable: true,
        useMarkdown: true,
      });

      const editor = new Editor({
        ...config,
        content: html,
      });

      // Find the taskItem position
      let taskItemPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'taskItem') {
          taskItemPos = pos;
          return false; // Stop searching
        }
      });

      expect(taskItemPos).toBeGreaterThanOrEqual(0);
      console.log('[TEST] Found taskItem at position:', taskItemPos);

      // Use the convertToLinkedTask command
      const noteId = 'test-note-123';
      const result = editor.commands.convertToLinkedTask(taskItemPos, noteId);
      expect(result).toBe(true);

      // Get HTML from editor
      const editorHtml = editor.getHTML();
      console.log('[TEST] Editor HTML after conversion:', editorHtml);

      // Verify the HTML has the task link
      expect(editorHtml).toContain('href="intent://local/task/test-note-123"');
      expect(editorHtml).toContain('delegated');

      // Convert back to markdown
      const outputMarkdown = processHTMLToMarkdown(editorHtml);
      console.log('[TEST] Markdown after conversion:', outputMarkdown);

      // Verify the markdown has the correct linked task format
      expect(outputMarkdown).toContain('[delegated](intent://local/task/test-note-123)');
      expect(outputMarkdown).toMatch(
        /- \[ \] \[delegated\]\(intent:\/\/local\/task\/test-note-123\)/,
      );

      editor.destroy();
    });
  });

  describe('HTML Tag Escaping in Code Blocks', () => {
    it('should preserve XML/HTML tags in inline code', async () => {
      const markdown = 'Use `<div>` for a container element';
      const html = await processMarkdownToHTML(markdown);

      // The HTML should contain the code tag with the angle brackets preserved
      expect(html).toContain('<code>');
      expect(html).toContain('&lt;div&gt;');

      // When rendered, it should display as <div> not &lt;div&gt;
      const result = processHTMLToMarkdown(html);
      expect(result).toBe(markdown);
    });

    it('should preserve XML/HTML tags in fenced code blocks', async () => {
      const markdown = '```html\n<div class="container">\n  <span>Hello</span>\n</div>\n```';
      const html = await processMarkdownToHTML(markdown);

      // The HTML should contain a code block with the tags preserved
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).toContain('&lt;div');
      expect(html).toContain('&lt;span&gt;');
    });

    it('should preserve multiple XML tags in inline code', async () => {
      const markdown = 'The `<lt;span&gt;` tag is for inline content';
      const html = await processMarkdownToHTML(markdown);

      expect(html).toContain('<code>');
      expect(html).toContain('&lt;span&gt;');
    });

    it('should escape HTML tags outside code blocks but preserve them inside', async () => {
      const markdown = 'Use `<div>` for containers, not <COMPANY>Adobe</COMPANY>';
      const html = await processMarkdownToHTML(markdown);

      // Inside code: should be escaped by markdown processor
      expect(html).toContain('<code>&lt;div&gt;</code>');

      // Outside code: should be escaped by our escapeHtmlTags function
      expect(html).toContain('&lt;COMPANY&gt;Adobe&lt;/COMPANY&gt;');
    });

    it('should handle nested code blocks with XML tags', async () => {
      const markdown = 'Here are some XML tags in inline code:\n\n- Use `<div>` for a container element\n- The `<span>` tag is for inline content\n- Self-closing tags like `<br/>` and `<img src="..." />`';
      const html = await processMarkdownToHTML(markdown);

      // All inline code should preserve the tags
      expect(html).toContain('<code>&lt;div&gt;</code>');
      expect(html).toContain('<code>&lt;span&gt;</code>');
      expect(html).toContain('<code>&lt;br/&gt;</code>');
      expect(html).toContain('<code>&lt;img src="..." /&gt;</code>');
    });

    it('should handle complex example with attributes', async () => {
      const markdown = 'With attributes: `<button onclick="handler" disabled="true">`';
      const html = await processMarkdownToHTML(markdown);

      expect(html).toContain('<code>');
      expect(html).toContain('&lt;button');
      expect(html).toContain('onclick=');
      expect(html).toContain('disabled=');
      expect(html).toContain('&gt;');
    });

    it('should preserve XML tags in code blocks within lists', async () => {
      const markdown = `Here are some XML tags in inline code:

- Use \`<div>\` for a container element
- The \`<span>\` tag is for inline content
- Self-closing tags like \`<br/>\` and \`<img src="..." />\`
- Nested example: \`<parent><child /></parent>\`
- With attributes: \`<button onclick="handler" disabled="true">\``;

      const html = await processMarkdownToHTML(markdown);

      // Verify all tags in code are preserved
      expect(html).toContain('<code>&lt;div&gt;</code>');
      expect(html).toContain('<code>&lt;span&gt;</code>');
      expect(html).toContain('<code>&lt;br/&gt;</code>');
      expect(html).toContain('<code>&lt;img src="..." /&gt;</code>');
      expect(html).toContain('<code>&lt;parent&gt;&lt;child /&gt;&lt;/parent&gt;</code>');
      expect(html).toContain('<code>&lt;button onclick="handler" disabled="true"&gt;</code>');
    });
  });
});
