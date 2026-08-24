/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

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

describe('markdown-processor inline workspace file images', () => {
  it('rewrites short-form intent file image links using the workspaceId option', async () => {
    const html = await processMarkdownToHTML('![shot](intent://local/file/docs/shot.png)', {
      workspaceId: 'ws-abc',
    });

    expect(html).toContain('src="workspace-file://ws-abc/docs/shot.png"');
    expect(html).toContain('alt="shot"');
  });

  it('rewrites long-form intent file image links without a workspaceId option', async () => {
    const html = await processMarkdownToHTML('![shot](intent://local/ws-xyz/file/shot.webp)');

    expect(html).toContain('src="workspace-file://ws-xyz/shot.webp"');
  });

  it('does not produce a workspace-file src for traversal paths', async () => {
    const html = await processMarkdownToHTML('![x](intent://local/file/../secret.png)', {
      workspaceId: 'ws-abc',
    });

    expect(html).not.toContain('workspace-file://');
  });

  it('keeps the workspace-file src through sanitization', async () => {
    const html = await processMarkdownToHTML('![shot](intent://local/file/a.png)', {
      workspaceId: 'ws-abc',
    });

    expect(html).toContain('<img');
    expect(html).toContain('workspace-file://ws-abc/a.png');
  });

  it('caches per workspaceId', async () => {
    const md = '![shot](intent://local/file/cache-test.png)';
    const a = await processMarkdownToHTML(md, { workspaceId: 'ws-a' });
    const b = await processMarkdownToHTML(md, { workspaceId: 'ws-b' });

    expect(a).toContain('workspace-file://ws-a/cache-test.png');
    expect(b).toContain('workspace-file://ws-b/cache-test.png');
  });
});
