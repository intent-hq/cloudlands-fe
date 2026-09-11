/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { tick } from 'svelte';
import DOMPurify from 'dompurify';
import { createEditorConfig } from './editor-config';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

describe('processMarkdownForDisplay error path', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./tiptap-task-list-extension');
    vi.doUnmock('dompurify');
  });

  it('sanitizes the fallback when parsing throws', async () => {
    vi.resetModules();
    // A re-imported sanitizer needs its own hooks, not a second set on the shared instance.
    vi.doMock('dompurify', () => ({ default: DOMPurify(window) }));
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

    expect(html).toMatch(/src="workspace-file:\/\/ws-abc\/docs\/shot\.png\?v=[A-Za-z0-9._-]+"/);
    expect(html).toContain('alt="shot"');
  });

  it('rewrites long-form intent file image links for the current workspace', async () => {
    const html = await processMarkdownToHTML('![shot](intent://local/ws-xyz/file/shot.webp)', {
      workspaceId: 'ws-xyz',
    });

    expect(html).toMatch(/src="workspace-file:\/\/ws-xyz\/shot\.webp\?v=[A-Za-z0-9._-]+"/);
  });

  it('cache-busts image URLs with a fresh token per render, even on a cache hit', async () => {
    const md = '![shot](intent://local/file/regenerated.png)';
    const first = await processMarkdownToHTML(md, { workspaceId: 'ws-abc' });
    const second = await processMarkdownToHTML(md, { workspaceId: 'ws-abc' });
    const srcOf = (html: string) => /src="([^"]*)"/.exec(html)![1];

    expect(srcOf(first)).toMatch(/^workspace-file:\/\/ws-abc\/regenerated\.png\?v=/);
    expect(srcOf(second)).toMatch(/^workspace-file:\/\/ws-abc\/regenerated\.png\?v=/);
    expect(srcOf(first)).not.toBe(srcOf(second));
  });

  it('reuses an explicit workspaceFileVersion so re-renders keep identical image URLs', async () => {
    const md = '![shot](intent://local/file/stable.png)';
    const options = { workspaceId: 'ws-abc', workspaceFileVersion: 'render-1' };
    const first = await processMarkdownToHTML(md, options);
    const second = await processMarkdownToHTML(md, options);

    expect(first).toContain('src="workspace-file://ws-abc/stable.png?v=render-1"');
    expect(second).toBe(first);
  });

  it('does not rewrite cross-workspace long-form intent file image links', async () => {
    const html = await processMarkdownToHTML('![shot](intent://local/other-ws/file/secret.png)', {
      workspaceId: 'ws-xyz',
    });

    expect(html).not.toContain('workspace-file://');
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

describe('markdown-processor inline workspace file videos', () => {
  it.each(['webm', 'mp4'])(
    'round-trips a saved %s asset through the note editor',
    async (extension) => {
      const src = `workspace-asset://ws-abc/mfr7-1234abcd.${extension}?backend=remote-1&v=render-1`;
      const markdown = `![saved demo](${src})`;
      const html = await processMarkdownToHTML(markdown, { workspaceId: 'ws-abc' });
      const element = document.createElement('div');
      const editor = new Editor(
        createEditorConfig({
          element,
          content: html,
          editable: true,
          onUpdate: () => {},
          useMarkdown: true,
          workspace: { id: 'ws-abc' },
          enableMentions: false,
        }),
      );
      await tick();
      try {
        expect(editor.getJSON().content?.some((node) => node.type === 'video')).toBe(true);
        expect(editor.getHTML()).not.toContain('workspace-file://');
        expect(processHTMLToMarkdown(editor.getHTML())).toBe(markdown);
        const reloaded = document.createElement('div');
        reloaded.innerHTML = await processMarkdownToHTML(processHTMLToMarkdown(editor.getHTML()), {
          workspaceId: 'ws-abc',
        });
        expect(reloaded.querySelector('video')?.getAttribute('src')).toBe(src);
        expect(reloaded.querySelector('img')).toBeNull();
      } finally {
        await tick();
        editor.destroy();
      }
    },
  );

  it.each([
    'workspace-asset://other-ws/demo.webm',
    'workspace-asset://ws-abc/../demo.webm',
    'workspace-asset://ws-abc/demo.svg',
    'workspace-asset://ws-abc/demo.mov',
    'workspace-asset://ws-abc/demo.webm?unexpected=1',
    'https://example.com/demo.webm',
    'javascript:alert(1)',
  ])('does not allow raw video with an unsafe source %s', async (src) => {
    const html = await processMarkdownToHTML(`<video src="${src}" controls></video>`, {
      workspaceId: 'ws-abc',
    });
    expect(html).not.toContain('<video');
  });

  it('renders allowlisted video markdown as a playable workspace video', async () => {
    const html = await processMarkdownToHTML('![demo](intent://local/file/out/demo.mp4)', {
      workspaceId: 'ws-abc',
    });

    expect(html).toContain('<video');
    expect(html).toContain('src="workspace-file://ws-abc/out/demo.mp4"');
    expect(html).toContain('controls');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('playsinline');
    expect(html).toContain('data-name="demo"');
  });

  it.each(['mov', 'svg'])('does not rewrite non-allowlisted %s media', async (extension) => {
    const html = await processMarkdownToHTML(`![demo](intent://local/file/out/demo.${extension})`, {
      workspaceId: 'ws-abc',
    });

    expect(html).not.toContain('<video');
    expect(html).not.toContain('workspace-file://');
  });

  it('survives the note editor and saves the original portable markdown link', async () => {
    const markdown = '![demo](intent://local/file/out/demo.webm)';
    const html = await processMarkdownToHTML(markdown, { workspaceId: 'ws-abc' });
    const element = document.createElement('div');
    const editor = new Editor(
      createEditorConfig({
        element,
        content: html,
        editable: false,
        onUpdate: () => {},
        useMarkdown: true,
        workspace: { id: 'ws-abc' },
        enableMentions: false,
      }),
    );

    expect(editor.getHTML()).toContain('video');
    expect(processHTMLToMarkdown(editor.getHTML())).toBe(markdown);
    editor.destroy();
  });
});
