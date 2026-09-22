import { describe, expect, it } from 'vitest';
import { stampMarkdownImageDimensions } from './markdown-image-dimensions';
import { processMarkdownToHTML } from './markdown-processor';

const WS = 'ws-abc';

function dims(html: string): Array<{ width: string | null; height: string | null }> {
  const container = document.createElement('div');
  container.innerHTML = html;
  return Array.from(container.querySelectorAll('img'), (img) => ({
    width: img.getAttribute('width'),
    height: img.getAttribute('height'),
  }));
}

describe('stampMarkdownImageDimensions', () => {
  it('stamps width/height on the image whose original Markdown src matches', () => {
    const html = '<p><img src="workspace-asset://ws-abc/asset-1.png" alt="chart"></p>';

    const stamped = stampMarkdownImageDimensions(html, {
      'workspace-asset://ws-abc/asset-1.png': { width: 640, height: 480 },
    });

    expect(dims(stamped)).toEqual([{ width: '640', height: '480' }]);
    expect(stamped).toContain('alt="chart"');
    expect(stamped).toContain('src="workspace-asset://ws-abc/asset-1.png"');
  });

  it('returns the HTML unchanged when media is absent, empty, or does not match', () => {
    const html = '<p><img src="workspace-asset://ws-abc/asset-1.png" alt="chart"></p>';

    expect(stampMarkdownImageDimensions(html, undefined)).toBe(html);
    expect(stampMarkdownImageDimensions(html, {})).toBe(html);
    expect(
      stampMarkdownImageDimensions(html, {
        'workspace-asset://ws-abc/other.png': { width: 10, height: 10 },
      }),
    ).toBe(html);
  });

  it('stamps each matching image independently across multiple images', () => {
    const html =
      '<p><img src="https://example.com/a.png" alt="a"></p>' +
      '<p><img src="workspace-asset://ws-abc/b.png" alt="b"></p>' +
      '<p><img src="workspace-asset://ws-abc/c.png" alt="c"></p>';

    const stamped = stampMarkdownImageDimensions(html, {
      'workspace-asset://ws-abc/b.png': { width: 100, height: 50 },
      'workspace-asset://ws-abc/c.png': { width: 30, height: 60 },
    });

    expect(dims(stamped)).toEqual([
      { width: null, height: null },
      { width: '100', height: '50' },
      { width: '30', height: '60' },
    ]);
  });

  it('matches an intent file src after the processor rewrote and versioned it', async () => {
    const markdown = '![diagram](intent://local/file/docs/diagram.png)';
    const html = await processMarkdownToHTML(markdown, { workspaceId: WS, skipIfHTML: false });
    expect(html).toContain('src="workspace-file://ws-abc/docs/diagram.png?v=');

    const stamped = stampMarkdownImageDimensions(
      html,
      { 'intent://local/file/docs/diagram.png': { width: 1200, height: 800 } },
      WS,
    );

    expect(dims(stamped)).toEqual([{ width: '1200', height: '800' }]);
    expect(stamped).toContain('src="workspace-file://ws-abc/docs/diagram.png?v=');
  });

  it('matches a long-form intent src and a marked-encoded unicode path', async () => {
    const markdown =
      '![long](intent://local/ws-abc/file/out/long.png)\n\n![uni](intent://local/file/out/schéma.png)';
    const html = await processMarkdownToHTML(markdown, { workspaceId: WS, skipIfHTML: false });

    const stamped = stampMarkdownImageDimensions(
      html,
      {
        'intent://local/ws-abc/file/out/long.png': { width: 20, height: 10 },
        'intent://local/file/out/schéma.png': { width: 40, height: 30 },
      },
      WS,
    );

    expect(dims(stamped)).toEqual([
      { width: '20', height: '10' },
      { width: '40', height: '30' },
    ]);
  });

  it('leaves images that already declare dimensions and rejects invalid entries', () => {
    const sized = '<p><img src="workspace-asset://ws-abc/a.png" width="1" height="1"></p>';
    expect(
      stampMarkdownImageDimensions(sized, {
        'workspace-asset://ws-abc/a.png': { width: 640, height: 480 },
      }),
    ).toBe(sized);

    const html = '<p><img src="workspace-asset://ws-abc/a.png"></p>';
    for (const bad of [
      { width: 0, height: 10 },
      { width: 10.5, height: 10 },
      { width: -1, height: 10 },
      { width: Number.NaN, height: 10 },
    ]) {
      expect(stampMarkdownImageDimensions(html, { 'workspace-asset://ws-abc/a.png': bad })).toBe(
        html,
      );
    }
  });
});
