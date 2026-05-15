/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
} from 'vitest';
import { processHTMLToMarkdown } from '../markdown-processor';

// jsdom is configured via the @vitest-environment comment above
// No need to mock DOM - jsdom provides a real DOM implementation

describe('HTML to Markdown Conversion', () => {
  it('should convert unchecked task list items correctly', () => {
    const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Unchecked task</p></div></li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- [ ] Unchecked task');
  });

  it('should convert checked task list items correctly', () => {
    const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Checked task</p></div></li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- [x] Checked task');
  });

  it('should convert in-progress task list items correctly', () => {
    const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false" data-status="in-progress"><label><input type="checkbox"><span></span></label><div><p>In-progress task</p></div></li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- [/] In-progress task');
  });

  it('should convert mixed checked and unchecked task list items correctly', () => {
    const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Unchecked task</p></div></li>
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Checked task</p></div></li>
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Another unchecked</p></div></li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- [ ] Unchecked task\n- [x] Checked task\n- [ ] Another unchecked');
  });

  it('should convert mixed task states (todo, in-progress, done) correctly', () => {
    const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false" data-status="todo"><label><input type="checkbox"><span></span></label><div><p>Todo task</p></div></li>
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false" data-status="in-progress"><label><input type="checkbox"><span></span></label><div><p>In-progress task</p></div></li>
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="true" data-status="done"><label><input type="checkbox" checked><span></span></label><div><p>Done task</p></div></li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- [ ] Todo task\n- [/] In-progress task\n- [x] Done task');
  });

  it('should convert regular list items correctly', () => {
    const html = `<ul>
<li>Regular item 1</li>
<li>Regular item 2</li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- Regular item 1\n- Regular item 2');
  });

  it('should handle empty content', () => {
    expect(processHTMLToMarkdown('')).toBe('');
    expect(processHTMLToMarkdown('<p></p>')).toBe('');
  });

  it('should convert paragraphs correctly', () => {
    const html = '<p>Hello world</p><p>Second paragraph</p>';
    const result = processHTMLToMarkdown(html);
    expect(result).toBe('Hello world\n\nSecond paragraph');
  });

  it('should use data-checked attribute as source of truth', () => {
    // TipTap's official markdown extension uses data-checked as the source of truth
    // This is correct because TipTap's internal representation (JSON) is what matters
    const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false"><label><input type="checkbox" checked><span></span></label><div><p>Data attribute wins</p></div></li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- [ ] Data attribute wins');
  });

  it('should fall back to data-checked when checkbox is not present', () => {
    const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="true"><label><span></span></label><div><p>Data attribute wins</p></div></li>
</ul>`;

    const result = processHTMLToMarkdown(html);
    expect(result).toBe('- [x] Data attribute wins');
  });

  // Tests for nested task lists - these capture the bug reported
  describe('Nested Task Lists', () => {
    it('should preserve indentation for nested task lists (2 spaces per level)', () => {
      // TipTap structure: nested lists are INSIDE the <div> wrapper
      const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Parent task</p><ul class="task-list not-prose pl-0" data-type="taskList"><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Child task A</p></div></li><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Child task B</p></div></li></ul></div></li>
</ul>`;

      const result = processHTMLToMarkdown(html);
      const expected = `- [ ] Parent task
  - [ ] Child task A
  - [ ] Child task B`;
      expect(result).toBe(expected);
    });

    it('should handle multiple levels of nesting (3 levels)', () => {
      // TipTap structure: each nested list is inside its parent's <div>
      const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Level 1</p><ul class="task-list not-prose pl-0" data-type="taskList"><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Level 2</p><ul class="task-list not-prose pl-0" data-type="taskList"><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Level 3</p></div></li></ul></div></li></ul></div></li>
</ul>`;

      const result = processHTMLToMarkdown(html);
      // Indentation: Level 1 = 0, Level 2 = 2 spaces, Level 3 = 2 + 4 = 6 spaces
      const expected = `- [ ] Level 1
  - [ ] Level 2
      - [ ] Level 3`;
      expect(result).toBe(expected);
    });

    it('should handle nested tasks with mixed checked states', () => {
      // TipTap structure with mixed checked states
      const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Parent unchecked</p><ul class="task-list not-prose pl-0" data-type="taskList"><li class="custom-task-item" data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Child checked</p></div></li><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Child unchecked</p></div></li></ul></div></li>
</ul>`;

      const result = processHTMLToMarkdown(html);
      const expected = `- [ ] Parent unchecked
  - [x] Child checked
  - [ ] Child unchecked`;
      expect(result).toBe(expected);
    });

    it('should handle multiple parent tasks with nested children', () => {
      // TipTap structure with multiple parent tasks
      const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Parent 1</p><ul class="task-list not-prose pl-0" data-type="taskList"><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Child 1A</p></div></li></ul></div></li>
<li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Parent 2</p><ul class="task-list not-prose pl-0" data-type="taskList"><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Child 2A</p></div></li><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Child 2B</p></div></li></ul></div></li>
</ul>`;

      const result = processHTMLToMarkdown(html);
      const expected = `- [ ] Parent 1
  - [ ] Child 1A
- [ ] Parent 2
  - [ ] Child 2A
  - [ ] Child 2B`;
      expect(result).toBe(expected);
    });

    it('should handle the exact bug report scenario', () => {
      // This is the exact scenario from the bug report, using TipTap's actual HTML structure
      const html = `<ul class="task-list not-prose pl-0" data-type="taskList">
<li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Task breakdown debugging. Add subtasks for A, B, and C, with a joke in each line.</p><ul class="task-list not-prose pl-0" data-type="taskList"><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Subtask A: Verify task parsing - Why did the parser go to therapy? It had too many unresolved issues!</p></div></li><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Subtask B: Test nested task rendering - What do you call a task list that tells jokes? A pun-ch list!</p></div></li><li class="custom-task-item" data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Subtask C: Validate task state transitions - How do tasks stay in shape? They do check-box exercises!</p></div></li></ul></div></li>
</ul>`;

      const result = processHTMLToMarkdown(html);
      const expected = `- [ ] Task breakdown debugging. Add subtasks for A, B, and C, with a joke in each line.
  - [ ] Subtask A: Verify task parsing - Why did the parser go to therapy? It had too many unresolved issues!
  - [ ] Subtask B: Test nested task rendering - What do you call a task list that tells jokes? A pun-ch list!
  - [ ] Subtask C: Validate task state transitions - How do tasks stay in shape? They do check-box exercises!`;
      expect(result).toBe(expected);
    });
  });
});
