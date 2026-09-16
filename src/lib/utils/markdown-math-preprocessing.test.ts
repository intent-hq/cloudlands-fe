/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMarkdownCache,
  processHTMLToMarkdown,
  processMarkdownToHTML,
} from './markdown-processor';
import { processMarkdownWorkerRequest, type MarkdownWorkerRequest } from './markdown-worker';

let failWorker = false;
const requests: MarkdownWorkerRequest[] = [];
class TestWorker {
  onmessage?: (event: { data: Awaited<ReturnType<typeof processMarkdownWorkerRequest>> }) => void;
  postMessage(request: MarkdownWorkerRequest) {
    requests.push(request);
    if (failWorker) throw new Error('Exercise production main-thread fallback');
    void processMarkdownWorkerRequest(request).then((data) => this.onmessage?.({ data }));
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('math source through preprocessing and worker dispatch', () => {
  it.each([
    { renderMath: false, fail: false },
    { renderMath: true, fail: false },
    { renderMath: false, fail: true },
    { renderMath: true, fail: true },
  ])(
    'preserves source and anchors with $renderMath rendering and fallback=$fail',
    async ({ renderMath, fail }) => {
      vi.stubGlobal('Worker', TestWorker);
      failWorker = fail;
      requests.length = 0;
      clearMarkdownCache();
      const source =
        '<!--anchor:cmt-review:start-->$a<b$ and $c>d$<!--anchor:cmt-review:end-->\n\n' +
        String.raw`\[a<b>c\]` +
        '\n\n<img src=x onerror=alert(1)>';
      const filler = 'safe filler '.repeat(500).trim();
      const largeSource = `${filler}\n\n${source}`;
      const main = await processMarkdownToHTML(source, {
        renderMath,
        preserveAnchors: true,
        skipIfHTML: false,
      });
      expect(requests).toHaveLength(0);
      const large = await processMarkdownToHTML(largeSource, {
        renderMath,
        preserveAnchors: true,
        skipIfHTML: false,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].markdown).toContain('$a<b$ and $c>d$');
      expect(requests[0].markdown).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(requests[0].markdown).not.toContain('__MARKDOWN_SOURCE_');
      for (const [html, original] of [
        [main, source],
        [large, largeSource],
      ]) {
        const container = document.createElement('div');
        container.innerHTML = html;
        expect(container.querySelectorAll('[data-anchor-id]')).toHaveLength(2);
        expect(container.querySelector('img, script, [onerror]')).toBeNull();
        expect(container.querySelectorAll('.katex')).toHaveLength(renderMath ? 3 : 0);
        expect(processHTMLToMarkdown(html, { preserveAnchors: true })).toBe(original);
      }
      expect(
        await processMarkdownToHTML(largeSource, {
          renderMath,
          preserveAnchors: true,
          skipIfHTML: false,
        }),
      ).toBe(large);
      expect(requests).toHaveLength(1);

      const blockSource = `${filler}\n\n<!--anchor:cmt-block:start-->$a<b$<!--anchor:cmt-block:end-->\n# Following heading\n\`\`\`text\n$not-math$\n\`\`\``;
      const blocks = document.createElement('div');
      blocks.innerHTML = await processMarkdownToHTML(blockSource, {
        renderMath,
        preserveAnchors: true,
        skipIfHTML: false,
      });
      expect(requests).toHaveLength(2);
      expect(blocks.querySelector('h1')?.textContent).toBe('Following heading');
      expect(blocks.querySelector('pre code')?.textContent?.trim()).toBe('$not-math$');
      expect(blocks.querySelectorAll('.katex')).toHaveLength(renderMath ? 1 : 0);
      expect(blocks.querySelectorAll('[data-anchor-id]')).toHaveLength(2);
    },
  );
});
