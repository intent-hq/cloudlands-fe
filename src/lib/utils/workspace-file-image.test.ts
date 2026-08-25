import { describe, expect, it } from 'vitest';
import {
  intentFileImageUrlToWorkspaceFileUrl,
  rewriteIntentFileImageSrcs,
} from './workspace-file-image';

const WS = 'ws-1234';

describe('intentFileImageUrlToWorkspaceFileUrl', () => {
  it('converts short-form links using the current workspace ID', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl('intent://local/file/docs/shot.png', WS)).toBe(
      `workspace-file://${WS}/docs/shot.png`,
    );
  });

  it('converts long-form links carrying their own workspace ID', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl('intent://local/other-ws/file/a.jpeg', WS)).toBe(
      'workspace-file://other-ws/a.jpeg',
    );
  });

  it('returns null for short-form links without a current workspace ID', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl('intent://local/file/a.png')).toBeNull();
  });

  it('percent-encodes path segments', () => {
    expect(
      intentFileImageUrlToWorkspaceFileUrl('intent://local/file/my%20dir/img%201.webp', WS),
    ).toBe(`workspace-file://${WS}/my%20dir/img%201.webp`);
  });

  it('drops query and fragment', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl('intent://local/file/a.gif?x=1#y', WS)).toBe(
      `workspace-file://${WS}/a.gif`,
    );
  });

  it.each([
    ['non-file link', 'intent://local/note/abc'],
    ['non-image extension', 'intent://local/file/readme.md'],
    ['svg (excluded from allowlist)', 'intent://local/file/logo.svg'],
    ['traversal segment', 'intent://local/file/../secret.png'],
    ['encoded traversal segment', 'intent://local/file/%2e%2e/secret.png'],
    ['empty segment (doubled slash)', 'intent://local/file//etc/a.png'],
    ['encoded slash in segment', 'intent://local/file/a%2Fb.png'],
    ['backslash in segment', 'intent://local/file/a%5Cb.png'],
    ['windows drive prefix', 'intent://local/file/C:/a.png'],
    ['unsafe workspace id', 'intent://local/..%2F..%2Fx/file/a.png'],
    ['missing path', 'intent://local/file/'],
    ['not an intent url', 'https://example.com/a.png'],
  ])('returns null for %s', (_name, url) => {
    expect(intentFileImageUrlToWorkspaceFileUrl(url, WS)).toBeNull();
  });
});

describe('rewriteIntentFileImageSrcs', () => {
  it('rewrites intent file image sources in img tags', () => {
    const html = '<p><img src="intent://local/file/docs/shot.png" alt="shot"></p>';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(
      `<p><img src="workspace-file://${WS}/docs/shot.png" alt="shot"></p>`,
    );
  });

  it('decodes entity-encoded ampersands before parsing', () => {
    const html = '<img src="intent://local/file/a.png?x=1&amp;y=2" alt="">';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(
      `<img src="workspace-file://${WS}/a.png" alt="">`,
    );
  });

  it('leaves non-intent image sources untouched', () => {
    const html = '<img src="https://example.com/a.png" alt="">';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(html);
  });

  it('leaves invalid intent file links untouched', () => {
    const html = '<img src="intent://local/file/../x.png" alt="">';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(html);
  });

  it('does not rewrite intent URLs outside img src attributes', () => {
    const html = '<a href="intent://local/file/a.png">link</a>';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(html);
  });
});
