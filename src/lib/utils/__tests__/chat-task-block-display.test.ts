/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { processMarkdownToHTML } from '../markdown-processor';

const taskProposal = `@@@task
# Write docs
Document the chat task placeholder fix.

## Requirements
- Keep note editor placeholders intact
@@@`;

describe('chat task block display', () => {
  it('keeps the default transient placeholder for note/editor contexts', async () => {
    const html = await processMarkdownToHTML(taskProposal);

    expect(html).toContain('data-type="task-block"');
    expect(html).toContain('task-block-pending');
    expect(html).toContain('task-block-title-skeleton');
  });

  it('renders task proposal content without pending skeleton markup for chat display', async () => {
    const html = await processMarkdownToHTML(taskProposal, {
      taskBlockRenderMode: 'content',
    });

    expect(html).toContain('Write docs');
    expect(html).toContain('Document the chat task placeholder fix.');
    expect(html).not.toContain('@@@task');
    expect(html).not.toContain('data-type="task-block"');
    expect(html).not.toContain('task-block-pending');
    expect(html).not.toContain('task-block-title-skeleton');
  });
});
