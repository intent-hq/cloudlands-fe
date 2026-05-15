/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
} from 'vitest';
import { processMarkdownToHTML } from '../markdown-processor';

describe('Task Block - Markdown Processing', () => {
  describe('Parsing (Markdown → HTML)', () => {
    it('should render legacy ```task block as normal code block (legacy syntax removed)', async () => {
      const markdown = `\`\`\`task
# My Task
Task content here.
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should render as a normal code block, NOT a skeleton loader
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).not.toContain('data-type="task-block"');
      expect(html).not.toContain('task-block-pending');
      expect(html).not.toContain('task-block-checkbox');
      expect(html).not.toContain('task-block-title-skeleton');
    });

    it('should render @@@task block as skeleton loader', async () => {
      const markdown = `@@@task
# My Task
Task content here.
@@@`;

      const html = await processMarkdownToHTML(markdown);

      // @@@task blocks should render as skeleton loaders
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-pending');
      expect(html).toContain('task-block-checkbox');
      expect(html).toContain('task-block-title-skeleton');
    });

    it('should render @@@task block as readable content for completed chat messages', async () => {
      const markdown = `@@@task
# My Task
Task content here.
@@@`;

      const html = await processMarkdownToHTML(markdown, { taskBlockRenderMode: 'content' });

      expect(html).toContain('My Task');
      expect(html).toContain('Task content here.');
      expect(html).not.toContain('data-type="task-block"');
      expect(html).not.toContain('task-block-pending');
      expect(html).not.toContain('task-block-checkbox');
      expect(html).not.toContain('task-block-title-skeleton');
    });

    it('should render converted task links without pending placeholder markup', async () => {
      const markdown = `# Tasks

- [ ] [My Task](intent://local/task/task-123)

Task content here.`;

      const html = await processMarkdownToHTML(markdown);

      // Raw @@@task blocks may be a transient pre-conversion state, but the
      // persisted converted state must not keep rendering the pending skeleton.
      expect(html).toContain('My Task');
      expect(html).not.toContain('@@@task');
      expect(html).not.toContain('data-type="task-block"');
      expect(html).not.toContain('task-block-pending');
      expect(html).not.toContain('task-block-placeholder');
      expect(html).not.toContain('task-block-title-skeleton');
    });

    it('should render legacy ```task block with content as normal code block (legacy syntax removed)', async () => {
      const markdown = `\`\`\`task
# Authentication System
Build JWT-based auth.

## Requirements
- Login endpoint
- Logout endpoint
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should render as a normal code block, NOT a skeleton loader
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).not.toContain('data-type="task-block"');
      expect(html).not.toContain('task-block-pending');
      expect(html).not.toContain('task-block-checkbox');
    });

    it('should render @@@task block with content as skeleton loader', async () => {
      const markdown = `@@@task
# Authentication System
Build JWT-based auth.

## Requirements
- Login endpoint
- Logout endpoint
@@@`;

      const html = await processMarkdownToHTML(markdown);

      // @@@task blocks should render as skeleton loaders
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-pending');
      expect(html).toContain('task-block-checkbox');
      expect(html).toContain('task-block-title-skeleton');
    });

    it('should render multiple legacy ```task blocks as normal code blocks (legacy syntax removed)', async () => {
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

      // Should render as normal code blocks, NOT skeleton loaders
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).not.toContain('data-type="task-block"');
      expect(html).not.toContain('task-block-checkbox');
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

      // All @@@task blocks should render as skeleton loaders
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-pending');
      expect(html).toContain('task-block-checkbox');
    });

    it('should render mixed legacy and new task block syntax correctly', async () => {
      const markdown = `\`\`\`task
# Legacy Task
Content.
\`\`\`

@@@task
# New Task
Content.
@@@`;

      const html = await processMarkdownToHTML(markdown);

      // ```task renders as code block, @@@task renders as skeleton loader
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).toContain('data-type="task-block"');
      expect(html).toContain('task-block-checkbox');
    });

    it('should handle empty backtick tasks block as normal code block (legacy syntax removed)', async () => {
      const markdown = `\`\`\`task
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should render as normal code block, NOT empty task state
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).not.toContain('task-block-empty');
      expect(html).not.toContain('No task defined');
    });

    it('should handle backtick task with no content body as normal code block (legacy syntax removed)', async () => {
      const markdown = `\`\`\`task
# Task Without Content
\`\`\`

\`\`\`task
# Another Task
Has content.
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should render as normal code blocks, NOT skeleton loaders
      expect(html).toContain('<pre>');
      expect(html).toContain('<code');
      expect(html).not.toContain('task-block-pending');
    });

    it('should not include script tags in output', async () => {
      const markdown = `\`\`\`task
# Task with <script>alert('xss')</script>
Content here.
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Script should not appear (HTML entities are escaped in code blocks)
      expect(html).not.toContain('<script>');
    });
  });
});
