/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { sanitizeMarkdownHTML } from './html-sanitizer';

describe('html-sanitizer', () => {
  it.each([
    ['cross-workspace', 'workspace-asset://other-ws/demo.webm', 'ws-abc'],
    ['unknown workspace', 'workspace-asset://ws-abc/demo.mp4', undefined],
    ['traversal', 'workspace-asset://ws-abc/../demo.webm', 'ws-abc'],
    ['encoded separator', 'workspace-asset://ws-abc/a%2Fdemo.mp4', 'ws-abc'],
    ['malformed escape', 'workspace-asset://ws-abc/bad%zz.webm', 'ws-abc'],
    ['encoded extension', 'workspace-asset://other-ws/demo%2E%77ebm', 'ws-abc'],
    ['duplicate backend', 'workspace-asset://ws-abc/demo.webm?backend=one&backend=two', 'ws-abc'],
    ['invalid backend', 'workspace-asset://ws-abc/demo.webm?backend=one%0A', 'ws-abc'],
    ['unknown query', 'workspace-asset://ws-abc/demo.webm?url=remote', 'ws-abc'],
    ['fragment', 'workspace-asset://ws-abc/demo.mp4#fragment', 'ws-abc'],
    ['scheme casing', 'WORKSPACE-ASSET://other-ws/demo.mp4', 'ws-abc'],
    ['whitespace', ' workspace-asset://other-ws/demo.mp4 ', 'ws-abc'],
  ])(
    'cannot bypass %s saved-video rejection using an image element',
    (_reason, src, workspaceId) => {
      const element = document.createElement('div');
      element.innerHTML = sanitizeMarkdownHTML(
        `<img src="${src}" alt="rejected"><video src="${src}"></video>`,
        workspaceId,
      );
      expect(element.querySelector('img[src], video[src]')).toBeNull();
    },
  );

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff'])(
    'leaves existing saved %s image policy unchanged',
    (extension) => {
      const src = `workspace-asset://other-ws/image.${extension}?backend=remote-1&v=render-1`;
      const element = document.createElement('div');
      element.innerHTML = sanitizeMarkdownHTML(`<img src="${src}">`);
      expect(element.querySelector('img')?.getAttribute('src')).toBe(src);
    },
  );

  it.each(['mp4', 'webm'])(
    'preserves same-workspace saved %s identity and safe player attributes',
    (extension) => {
      const src = `workspace-asset://ws-abc/saved.${extension}?backend=remote-1&v=render-1`;
      const element = document.createElement('div');
      element.innerHTML = sanitizeMarkdownHTML(
        `<video src="${src}" controls preload="metadata" playsinline onclick="alert(1)"></video>`,
        'ws-abc',
      );
      const video = element.querySelector('video');
      expect(video?.getAttribute('src')).toBe(src);
      expect(video?.controls).toBe(true);
      expect(video?.getAttribute('onclick')).toBeNull();
    },
  );

  it.each([undefined, 'other-workspace'])(
    'removes saved videos without matching workspace scope (%s)',
    (workspaceId) => {
      expect(
        sanitizeMarkdownHTML(
          '<video src="workspace-asset://ws-abc/saved.webm"></video>',
          workspaceId,
        ),
      ).not.toContain('<video');
    },
  );

  it.each([
    'workspace-asset://ws-abc/../saved.webm',
    'workspace-asset://ws-abc/a%2Fsaved.webm',
    'workspace-asset://ws-abc/saved.mov',
    'workspace-asset://ws-abc/saved.svg',
    'workspace-asset://ws-abc/saved.webm?backend=one&backend=two',
    'workspace-asset://ws-abc/saved.webm?backend=one%0A',
    'workspace-asset://ws-abc/saved.webm?url=remote',
    'workspace-asset://ws-abc/saved.webm#fragment',
  ])('rejects unsafe saved video source %s', (src) => {
    expect(sanitizeMarkdownHTML(`<video src="${src}"></video>`, 'ws-abc')).not.toContain('<video');
  });

  it('preserves diff block data attributes', () => {
    const html = '<div data-type="diff-block" data-diff-code="abc123"></div>';

    expect(sanitizeMarkdownHTML(html)).toContain('data-diff-code="abc123"');
  });

  it('allows workspace-file:// image sources', () => {
    const html = '<img src="workspace-file://ws-abc/docs/shot.png" alt="shot">';

    expect(sanitizeMarkdownHTML(html, 'ws-abc')).toContain(
      'src="workspace-file://ws-abc/docs/shot.png"',
    );
  });

  it('allows workspace-file:// videos and their player attributes', () => {
    const html =
      '<video src="workspace-file://ws-abc/out/demo.mp4" controls preload="metadata" playsinline poster="workspace-file://ws-abc/out/poster.png" data-name="demo"></video>';

    const sanitized = sanitizeMarkdownHTML(html, 'ws-abc');
    expect(sanitized).toContain('src="workspace-file://ws-abc/out/demo.mp4"');
    expect(sanitized).toContain('controls');
    expect(sanitized).toContain('preload="metadata"');
    expect(sanitized).toContain('playsinline');
    expect(sanitized).toContain('data-name="demo"');
  });

  it('strips cross-workspace image sources', () => {
    const html = '<img src="workspace-file://other-workspace/docs/shot.png" alt="shot">';

    const sanitized = sanitizeMarkdownHTML(html, 'current-workspace');

    expect(sanitized).toContain('<img');
    expect(sanitized).not.toContain('workspace-file://');
  });

  it('removes cross-workspace videos', () => {
    const html = '<video src="workspace-file://other-workspace/out/demo.mp4" controls></video>';

    expect(sanitizeMarkdownHTML(html, 'current-workspace')).not.toContain('<video');
  });

  it.each(['https://example.com/demo.mp4', 'file:///tmp/demo.mp4'])(
    'strips videos with a non-workspace source: %s',
    (src) => {
      expect(sanitizeMarkdownHTML(`<video src="${src}" controls></video>`)).not.toContain('<video');
    },
  );

  it('strips workspace-file:// from anchor hrefs (media-src only scheme)', () => {
    const html = '<a href="workspace-file://ws-abc/docs/shot.png">open</a>';

    const sanitized = sanitizeMarkdownHTML(html);
    expect(sanitized).not.toContain('workspace-file://');
    expect(sanitized).toContain('open');
  });

  it('still strips javascript: image sources', () => {
    const html = '<img src="javascript:alert(1)" alt="x">';

    expect(sanitizeMarkdownHTML(html)).not.toContain('javascript:');
  });

  it('preserves the narrowly allowlisted KaTeX accessibility and radical markup', () => {
    const html =
      '<span class="math-inline" data-math-source="$x$"><span class="katex"><span class="katex-mathml"><math><semantics><mrow><msqrt><mi>x</mi></msqrt></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></span><svg viewBox="0 0 1 1"><path d="M0 0"></path></svg></span></span>';
    const sanitized = sanitizeMarkdownHTML(html);

    expect(sanitized).toContain('data-math-source="$x$"');
    expect(sanitized).toContain('<math>');
    expect(sanitized).toContain('<msqrt>');
    expect(sanitized).toContain('<annotation encoding="application/x-tex">x</annotation>');
    expect(sanitized).toContain('<path d="M0 0"></path>');
  });

  it('still strips executable attributes and protocols from math-shaped HTML', () => {
    const html =
      '<span data-math-source="$x$" onclick="alert(1)"><math onload="alert(2)"><mrow><mi>x</mi></mrow></math><svg><a href="javascript:alert(3)">x</a></svg></span>';
    const sanitized = sanitizeMarkdownHTML(html);

    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('onload');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).toContain('<math>');
  });

  it('preserves only constrained KaTeX layout declarations when explicitly enabled', () => {
    const html =
      '<span class="math-inline" data-math-source="$x$"><span class="katex"><span style="height:1.2em; top:-0.3em; border-width:0.04em; position:relative; color:red; background:url(javascript:alert(1))">x</span></span></span>';

    const sanitized = sanitizeMarkdownHTML(html, undefined, {
      preserveKatexLayoutStyles: true,
    });

    expect(sanitized).toContain(
      'style="height:1.2em;top:-0.3em;border-width:0.04em;position:relative;"',
    );
    expect(sanitized).not.toContain('color:');
    expect(sanitized).not.toContain('background:');
    expect(sanitized).not.toContain('javascript:');
  });

  it('strips styles outside generated KaTeX descendants and without explicit opt-in', () => {
    const katex =
      '<span class="math-inline" data-math-source="$x$"><span class="katex"><span style="height:1em">x</span></span></span>';
    const forged =
      '<span class="math-inline" data-math-source="$x$"><span style="height:1em">x</span></span>';

    expect(sanitizeMarkdownHTML(katex)).not.toContain('style=');
    expect(
      sanitizeMarkdownHTML(forged, undefined, { preserveKatexLayoutStyles: true }),
    ).not.toContain('style=');
  });
});
