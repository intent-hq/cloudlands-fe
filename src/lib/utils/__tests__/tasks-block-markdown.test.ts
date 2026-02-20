/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { processMarkdownToHTML } from '../markdown-processor';

describe('Task Block - Markdown Processing', () => {
  describe('Parsing (Markdown → HTML)', () => {
    it('should recognize legacy ```task block and convert to skeleton loader', async () => {
      const markdown = `\`\`\`task
# My Task
Task content here.
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should create a skeleton pending div with checkbox
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-pending');
      expect(html).toContain('task-block-checkbox');
      expect(html).toContain('task-block-title-skeleton');
    });

    it('should recognize new @@@task block and convert to skeleton loader', async () => {
      const markdown = `@@@task
# My Task
Task content here.
@@@`;

      const html = await processMarkdownToHTML(markdown);

      // Should create a skeleton pending div with checkbox
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-pending');
      expect(html).toContain('task-block-checkbox');
      expect(html).toContain('task-block-title-skeleton');
    });

    it('should render skeleton loader for legacy ```task block', async () => {
      const markdown = `\`\`\`task
# Authentication System
Build JWT-based auth.

## Requirements
- Login endpoint
- Logout endpoint
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should have skeleton structure (content not shown, just placeholder)
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-pending');
      expect(html).toContain('task-block-checkbox');
    });

    it('should render skeleton loader for new @@@task block', async () => {
      const markdown = `@@@task
# Authentication System
Build JWT-based auth.

## Requirements
- Login endpoint
- Logout endpoint
@@@`;

      const html = await processMarkdownToHTML(markdown);

      // Should have skeleton structure (content not shown, just placeholder)
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-pending');
      expect(html).toContain('task-block-checkbox');
    });

    it('should render multiple legacy ```task blocks as skeleton loaders', async () => {
      const markdown = `\`\`\`task
# Task One
Content one.

\`\`\`

\`\`\`task
# Task Two
Content two.

\`\`\`

\`\`\`task
# Task Three
Content three.
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // One skeleton per task block
      expect(html.match(/data-type="task-block"/g)?.length).toBe(3);
      expect(html.match(/task-block-checkbox/g)?.length).toBe(3);
    });

    it('should render multiple @@@task blocks as skeleton loaders', async () => {
      const markdown = `@@@task
# Task One
Content one.
@@@

@@@task
# Task Two
Content two.
@@@

@@@task
# Task Three
Content three.
@@@`;

      const html = await processMarkdownToHTML(markdown);

      // One skeleton per task block
      expect(html.match(/data-type="task-block"/g)?.length).toBe(3);
      expect(html.match(/task-block-checkbox/g)?.length).toBe(3);
    });

    it('should render mixed legacy and new task block syntax', async () => {
      const markdown = `\`\`\`task
# Legacy Task
Content.
\`\`\`

@@@task
# New Task
Content.
@@@`;

      const html = await processMarkdownToHTML(markdown);

      // Both should be rendered
      expect(html.match(/data-type="task-block"/g)?.length).toBe(2);
      expect(html.match(/task-block-checkbox/g)?.length).toBe(2);
    });

    it('should handle empty tasks block', async () => {
      const markdown = `\`\`\`task
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should render empty state
      expect(html).toContain('task-block-empty');
      expect(html).toContain('No task defined');
    });

    it('should handle task with no content body', async () => {
      const markdown = `\`\`\`task
# Task Without Content
\`\`\`

\`\`\`task
# Another Task
Has content.
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Both should render as skeleton loaders
      expect(html.match(/task-block-pending/g)?.length).toBe(2);
    });

    it('should not include script tags in output', async () => {
      const markdown = `\`\`\`task
# Task with <script>alert('xss')</script>
Content here.
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Script should not appear (skeleton doesn't show title anyway)
      expect(html).not.toContain('<script>');
    });
  });
});
