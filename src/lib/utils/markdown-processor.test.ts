/**
 * @vitest-environment jsdom
 */
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  processHTMLToMarkdown,
  processMarkdownToHTML,
} from './markdown-processor';

describe('processMarkdownForDisplay error path', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./tiptap-task-list-extension');
  });

  it('sanitizes the fallback when parsing throws', async () => {
    vi.resetModules();
    vi.doMock('./tiptap-task-list-extension', () => ({
      createTiptapTaskListMarked: () => ({
        parse: () => {
          throw new Error('parse failed');
        },
      }),
    }));

    const { processMarkdownForDisplay } = await import('./markdown-processor');
    const html = await processMarkdownForDisplay('<img src=x onerror="alert(1)">');

    expect(html).not.toContain('onerror');
  });
});

describe('markdown-processor diff blocks', () => {
  const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new';

  it('converts diff fenced code blocks to diff block HTML', async () => {
    const html = await processMarkdownToHTML(`\`\`\`diff\n${diff}\n\`\`\``);

    expect(html).toContain('data-type="diff-block"');
    expect(html).toContain('data-diff-code=');
  });

  it('converts diff block HTML to markdown', () => {
    const encoded = btoa(unescape(encodeURIComponent(diff)));
    const html = `<div data-type="diff-block" data-diff-code="${encoded}"></div>`;

    expect(processHTMLToMarkdown(html)).toBe(`\`\`\`diff\n${diff}\n\`\`\``);
  });
});
