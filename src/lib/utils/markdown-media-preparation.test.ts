/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { processMarkdownToHTML } from './markdown-processor';
import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from './markdown-worker';

let activeMediaParses: string[];
let reply: ((html: string) => void) | undefined;
beforeEach(() => {
  activeMediaParses = [];
  reply = undefined;
  const set = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!.set!;
  vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(function (
    this: Element,
    html: string,
  ) {
    // A detached active-document element can fetch media. Inert templates and
    // separate sanitizer documents cannot use the head document's loader.
    if (
      this.ownerDocument === document &&
      !(this instanceof HTMLTemplateElement) &&
      /<(?:img|video|source)\b[^>]*(?:src|poster)=/i.test(html)
    )
      activeMediaParses.push(html);
    set.call(this, html);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Markdown media stays inert throughout preparation', () => {
  for (const mentions of [false, true]) {
    it.each([
      'workspace-file://ws/output.png',
      'intent://local/file/output.png',
      'https://example.com/output.png',
      'workspace-asset://ws/output.png',
    ])(
      `does not create load-capable media while parsing %s (mentions=${mentions})`,
      async (url) => {
        const html = await processMarkdownToHTML(
          `${mentions ? '@note/spec @src/a.ts' : 'No mentions.'} ![preview](${url})`,
          { workspaceId: 'ws' },
        );
        expect(activeMediaParses).toEqual([]);
        expect(html).toContain('alt="preview"');
        expect(html).toContain(url.startsWith('intent:') ? 'workspace-file://ws/output.png' : url);
        if (mentions) expect(html).toContain('data-mention="true"');
      },
    );
  }

  it('preserves canonical mentions and media through cache reuse', async () => {
    const markdown = '@note/spec @src/cache.ts ![cached](workspace-file://ws/cache.png)';
    const options = { workspaceId: 'ws', workspaceFileVersion: 'stable' };
    const first = await processMarkdownToHTML(markdown, options);
    const cached = await processMarkdownToHTML(markdown, options);
    expect(cached).toBe(first);
    expect(cached).toContain('data-mention="true"');
    expect(cached).toContain('workspace-file://ws/cache.png?v=stable');
    expect(activeMediaParses).toEqual([]);
  });

  for (const isStreaming of [false, true]) {
    it(`keeps real worker completion inert after remote placement (streaming=${isStreaming})`, async () => {
      class WorkerStub {
        onmessage?: (event: { data: MarkdownWorkerResponse }) => void;
        postMessage(request: MarkdownWorkerRequest) {
          reply = (html) => this.onmessage?.({ data: { id: request.id, html, error: null } });
        }
      }
      vi.stubGlobal('Worker', WorkerStub);
      let local = true;
      const view = render(MarkdownViewer, {
        content: `${isStreaming} ${'paragraph '.repeat(600)} ![late](workspace-file://ws/late.png)`,
        workspaceId: 'ws',
        isStreaming,
        canOpenFile: () => local,
      });
      await waitFor(() => expect(reply).toBeTypeOf('function'));
      reply!('<p>@note/spec <img alt="late" src="workspace-file://ws/late.png"></p>');
      local = false;
      await waitFor(() =>
        expect(view.container.querySelector('[data-testid="media-unavailable"]')).not.toBeNull(),
      );
      expect(activeMediaParses).toEqual([]);
      expect(view.container.querySelector('[src^="workspace-file:"]')).toBeNull();
      expect(view.container.querySelector('[data-mention="true"]')).not.toBeNull();
    });
  }
});
