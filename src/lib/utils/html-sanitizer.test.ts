/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { sanitizeMarkdownHTML } from './html-sanitizer';

describe('html-sanitizer', () => {
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
});
