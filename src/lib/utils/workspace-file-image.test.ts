import { describe, expect, it } from 'vitest';
import {
  intentFileImageUrlToWorkspaceFileUrl,
  intentFileMediaUrlToWorkspaceFile,
  parseIntentFileTarget,
  rewriteIntentFileImageSrcs,
  workspaceFileMediaUrlToIntentFileUrl,
} from './workspace-file-image';

const WS = 'ws-1234';

describe('intentFileImageUrlToWorkspaceFileUrl', () => {
  it('converts short-form links using the current workspace ID', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl('intent://local/file/docs/shot.png', WS)).toBe(
      `workspace-file://${WS}/docs/shot.png`,
    );
  });

  it('converts long-form links for the current workspace', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl(`intent://local/${WS}/file/a.jpeg`, WS)).toBe(
      `workspace-file://${WS}/a.jpeg`,
    );
  });

  it('compares the decoded long-form workspace ID with the current workspace', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl('intent://local/ws%2D1234/file/a.png', WS)).toBe(
      `workspace-file://${WS}/a.png`,
    );
    expect(
      intentFileImageUrlToWorkspaceFileUrl('intent://local/other%2Dws/file/a.png', WS),
    ).toBeNull();
  });

  it('returns null for a different long-form workspace ID', () => {
    expect(
      intentFileImageUrlToWorkspaceFileUrl('intent://local/other-ws/file/a.jpeg', WS),
    ).toBeNull();
  });

  it('returns null for long-form links without a current workspace ID', () => {
    expect(intentFileImageUrlToWorkspaceFileUrl(`intent://local/${WS}/file/a.png`)).toBeNull();
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
    ['malformed workspace id encoding', 'intent://local/ws%ZZ/file/a.png'],
    ['missing path', 'intent://local/file/'],
    ['not an intent url', 'https://example.com/a.png'],
  ])('returns null for %s', (_name, url) => {
    expect(intentFileImageUrlToWorkspaceFileUrl(url, WS)).toBeNull();
  });
});

describe('intentFileMediaUrlToWorkspaceFile', () => {
  it.each([
    ['mp4', 'video'],
    ['webm', 'video'],
    ['png', 'image'],
  ] as const)('returns the media kind for %s files', (extension, kind) => {
    expect(
      intentFileMediaUrlToWorkspaceFile(`intent://local/file/out/demo.${extension}`, WS),
    ).toEqual({
      url: `workspace-file://${WS}/out/demo.${extension}`,
      kind,
    });
  });

  it.each(['mov', 'svg'])('rejects non-allowlisted %s files', (extension) => {
    expect(
      intentFileMediaUrlToWorkspaceFile(`intent://local/file/out/demo.${extension}`, WS),
    ).toBeNull();
  });

  it('maps workspace video URLs back to portable markdown URLs', () => {
    expect(workspaceFileMediaUrlToIntentFileUrl(`workspace-file://${WS}/out/demo.mp4`)).toBe(
      'intent://local/file/out/demo.mp4',
    );
  });

  it('parses a safe workspace file target without requiring a supported media extension', () => {
    expect(parseIntentFileTarget('intent://local/file/art/logo.svg', WS)).toEqual({
      workspaceId: WS,
      path: 'art/logo.svg',
      encodedPath: 'art/logo.svg',
    });
  });
});

describe('rewriteIntentFileImageSrcs', () => {
  it('rewrites intent file image sources in img tags', () => {
    const html = '<p><img src="intent://local/file/docs/shot.png" alt="shot"></p>';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(
      `<p><img src="workspace-file://${WS}/docs/shot.png" alt="shot"></p>`,
    );
  });

  it('rewrites matching long-form image sources', () => {
    const html = `<img src="intent://local/${WS}/file/docs/shot.png" alt="shot">`;

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(
      `<img src="workspace-file://${WS}/docs/shot.png" alt="shot">`,
    );
  });

  it('emits a controlled video element for workspace video links', () => {
    const html = '<p><img src="intent://local/file/out/demo.mp4" alt="demo"></p>';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(
      `<p><video src="workspace-file://${WS}/out/demo.mp4" controls preload="metadata" playsinline class="markdown-video" data-name="demo"></video></p>`,
    );
  });

  it('leaves cross-workspace long-form image sources untouched', () => {
    const html = '<img src="intent://local/other-ws/file/secret.png" alt="secret">';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(html);
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

  it.each(['svg', 'mov'])('marks unsupported %s media for a viewer placeholder', (extension) => {
    const html = `<img src="intent://local/file/out/demo.${extension}" alt="demo">`;

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(
      `<img src="intent://local/file/out/demo.${extension}" alt="demo" data-media-unsupported="${extension}">`,
    );
  });

  it('does not rewrite intent URLs outside img src attributes', () => {
    const html = '<a href="intent://local/file/a.png">link</a>';

    expect(rewriteIntentFileImageSrcs(html, WS)).toBe(html);
  });
});
