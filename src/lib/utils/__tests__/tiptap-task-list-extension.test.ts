import {
  describe,
  it,
  expect,
} from 'vitest';
import { createTiptapTaskListMarked } from '../tiptap-task-list-extension';

describe('Tiptap Task List Extension for Marked', () => {
  it('should render regular list items as standard HTML lists', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `- Regular list item 1
- Regular list item 2
- Another regular item`;

    const result = await markedInstance.parse(markdown);

    // Should produce standard HTML list (not task list). Marked wraps list items in <p> and may insert newlines
    expect(result).toContain('<ul>');
    expect(result).toMatch(/<li>\s*<p>Regular list item 1<\/p>\s*<\/li>/);
    expect(result).toMatch(/<li>\s*<p>Regular list item 2<\/p>\s*<\/li>/);
    expect(result).toMatch(/<li>\s*<p>Another regular item<\/p>\s*<\/li>/);
    expect(result).not.toContain('data-type="taskList"');
    expect(result).not.toContain('data-type="taskItem"');
    expect(result).not.toContain('task-list');
  });

  it('should render unchecked task list items in Tiptap format', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `- [ ] Unchecked task 1
- [ ] Unchecked task 2`;

    const result = await markedInstance.parse(markdown);

    // Should produce Tiptap task list format
    expect(result).toContain('<ul class="task-list not-prose pl-0" data-type="taskList">');
    expect(result).toContain('data-type="taskItem" data-checked="false"');
    expect(result).toContain('<input type="checkbox">'); // unchecked
    expect(result).toContain('Unchecked task 1');
    expect(result).toContain('Unchecked task 2');
    expect(result).not.toContain(' checked'); // should not have checked attribute on input
  });

  it('should render checked task list items in Tiptap format', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `- [x] Checked task 1
- [X] Checked task 2`;

    const result = await markedInstance.parse(markdown);

    // Should produce Tiptap task list format with checked items
    expect(result).toContain('<ul class="task-list not-prose pl-0" data-type="taskList">');
    expect(result).toContain('data-type="taskItem" data-checked="true"');
    expect(result).toContain('<input type="checkbox" checked>'); // checked
    expect(result).toContain('Checked task 1');
    expect(result).toContain('Checked task 2');
  });

  it('should handle mixed task and regular lists by splitting them', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `- Regular item 1
- Regular item 2

- [ ] Task item 1
- [x] Task item 2

- Another regular item`;

    const result = await markedInstance.parse(markdown);

    // Should split into separate lists: regular items in <ul>, task items in taskList
    // First, regular list items should be in a standard <ul>
    expect(result).toMatch(/<ul>\s*\n<li><p>Regular item 1<\/p>/);
    expect(result).toMatch(/<li><p>Regular item 2<\/p>/);
    expect(result).toMatch(/<li><p>Another regular item<\/p>/);

    // Task items should be in their own taskList
    expect(result).toContain('<ul class="task-list not-prose pl-0" data-type="taskList">');
    expect(result).toContain('data-type="taskItem" data-checked="false"');
    expect(result).toContain('data-type="taskItem" data-checked="true"');
  });

  it('should handle task items with complex content', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `- [x] Task with **bold** text
- [ ] Task with *italic* and \`code\``;

    const result = await markedInstance.parse(markdown);

    // Should preserve inline formatting within task items
    expect(result).toContain('<ul class="task-list not-prose pl-0" data-type="taskList">');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
    expect(result).toContain('<code>code</code>');
    expect(result).toContain('data-type="taskItem" data-checked="true"');
    expect(result).toContain('data-type="taskItem" data-checked="false"');
  });

  it('should not interfere with other markdown features', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `# Heading

Some paragraph text.

- [x] Task item
- Regular item

**Bold text** and *italic text*.`;

    const result = await markedInstance.parse(markdown);

    // Should preserve all other markdown features
    expect(result).toContain('<h1>Heading</h1>');
    expect(result).toContain('<p>Some paragraph text.</p>');
    expect(result).toContain('<strong>Bold text</strong>');
    expect(result).toContain('<em>italic text</em>');
    expect(result).toContain('data-type="taskItem"');
    expect(result).toMatch(/<li>\s*<p>Regular item<\/p>\s*<\/li>/);
  });

  it('should handle empty task items correctly', async () => {
    const markedInstance = createTiptapTaskListMarked();

    // Note: GFM requires a space after ] for task items: `- [ ] ` not `- [ ]`
    // With a blank line after the empty task, marked.js creates a "loose" list
    // containing both the task item and the regular item in the same list
    // Using string literal to preserve trailing space after ]
    const markdown = '- [ ] \n\n- List item 1';

    const result = await markedInstance.parse(markdown);

    // Should render as a taskList (because it contains at least one task item)
    expect(result).toContain('data-type="taskList"');
    // Empty task item should be rendered with proper taskItem structure
    expect(result).toContain('data-type="taskItem" data-checked="false"');
    // Empty task items should have at least an empty paragraph to maintain structure
    expect(result).toContain('<div><p></p></div>');
    // The regular list item should also be present (as a regular <li> in the taskList)
    expect(result).toContain('List item 1');
  });

  it('should handle empty task items without blank line after', async () => {
    const markedInstance = createTiptapTaskListMarked();

    // Without blank lines, all items stay in the same tight list
    // Note: Space after ] is required for GFM task list syntax
    // Using string literal to preserve trailing space after ]
    const markdown = '- [ ] \n- [ ] Task A\n- [ ] Task B';

    const result = await markedInstance.parse(markdown);

    // All three should be task items
    const taskItemMatches = result.match(/data-type="taskItem"/g);
    expect(taskItemMatches).toHaveLength(3);
    // Empty task item should have empty paragraph
    expect(result).toContain('<div><p></p></div>');
    // Other tasks should have content
    expect(result).toContain('Task A');
    expect(result).toContain('Task B');
  });

  it('should handle empty task item at end of list', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `- [ ] Task A
- [ ] `;

    const result = await markedInstance.parse(markdown);

    // Both should be task items
    const taskItemMatches = result.match(/data-type="taskItem"/g);
    expect(taskItemMatches).toHaveLength(2);
    // Should have one with content and one empty
    expect(result).toContain('Task A');
    expect(result).toContain('<div><p></p></div>');
  });

  it('should preserve links in task items', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = '- [ ] [delegated](intent://local/task/abc123)';

    const result = await markedInstance.parse(markdown);

    // Should produce Tiptap task list format
    expect(result).toContain('<ul class="task-list not-prose pl-0" data-type="taskList">');
    expect(result).toContain('data-type="taskItem" data-checked="false"');
    // Should preserve the link with intent:// protocol
    expect(result).toContain('<a href="intent://local/task/abc123">delegated</a>');
  });

  it('should preserve intent:// links with various paths', async () => {
    const markedInstance = createTiptapTaskListMarked();

    const markdown = `- [ ] [task note](intent://local/task/some-uuid-here)
- [x] [another task](intent://local/note/note-id)`;

    const result = await markedInstance.parse(markdown);

    // Both links should be preserved
    expect(result).toContain('<a href="intent://local/task/some-uuid-here">task note</a>');
    expect(result).toContain('<a href="intent://local/note/note-id">another task</a>');
  });

  it('should not create orphan taskItems when bullet list is followed by task list (TipTap parsing)', async () => {
    // This test ensures that when a regular bullet list is followed by task checkboxes,
    // TipTap doesn't create orphan empty taskItems (GitHub issue fix)
    const { Editor } = await import('@tiptap/core');
    const { default: StarterKit } = await import('@tiptap/starter-kit');
    const { default: TaskList } = await import('@tiptap/extension-task-list');
    const { default: TaskItem } = await import('@tiptap/extension-task-item');
    const { default: Link } = await import('@tiptap/extension-link');

    const markedInstance = createTiptapTaskListMarked();

    const markdown = `### Technical Considerations
- The site uses SvelteKit
- Custom CSS properties defined
- Clean design

- [ ] [Create Theme Store](intent://local/task/abc123)
- [ ] [Extend CSS Variables](intent://local/task/def456)`;

    const html = await markedInstance.parse(markdown);

    // Create a TipTap editor with the HTML
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Link.configure({ protocols: ['workspaces'] }),
        TaskList,
        TaskItem.configure({ nested: true }),
      ],
      content: html,
    });

    // Count taskItems in the parsed document
    const doc = editor.getJSON();
    let taskItemCount = 0;
    let emptyTaskItemCount = 0;

    function countTaskItems(node: any) {
      if (node.type === 'taskItem') {
        taskItemCount++;
        // Check if this is an empty taskItem (no text content)
        const hasContent = node.content?.some((c: any) =>
          c.content?.some((t: any) => t.text && t.text.trim() !== ''),
        );
        if (!hasContent) {
          emptyTaskItemCount++;
        }
      }
      if (node.content) {
        node.content.forEach(countTaskItems);
      }
    }
    countTaskItems(doc);

    // Should have exactly 2 task items (not 3 with an orphan)
    expect(taskItemCount).toBe(2);
    // Should have no empty orphan task items
    expect(emptyTaskItemCount).toBe(0);

    editor.destroy();
  });
});
