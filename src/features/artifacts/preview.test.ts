import { describe, expect, it } from 'vitest';
import {
  buildPreviewDocument,
  isAllowedArtifactImageSource,
  parsePreviewStateMessage,
} from './preview';

describe('isolated artifact preview contract', () => {
  it('accepts bounded JSON state and rejects unrelated messages and oversized/non-JSON state', () => {
    expect(
      parsePreviewStateMessage({
        type: 'intent-artifact:state',
        state: { variant: 'compact', count: 2 },
      }),
    ).toEqual({ variant: 'compact', count: 2 });
    expect(parsePreviewStateMessage({ type: 'intent-artifact:state', state: null })).toBeNull();
    expect(parsePreviewStateMessage({ type: 'other', state: {} })).toBeUndefined();
    expect(
      parsePreviewStateMessage({ type: 'intent-artifact:state', state: 'x'.repeat(32769) }),
    ).toBeUndefined();
    expect(
      parsePreviewStateMessage({ type: 'intent-artifact:state', state: { run: () => {} } }),
    ).toBeUndefined();
  });
  it('boots a bridge without allowing state strings to inject markup', () => {
    const doc = new DOMParser().parseFromString(
      buildPreviewDocument('<button>Try</button>', { text: '</script><img src=x>' }),
      'text/html',
    );
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('img')).toBeNull();
    const policy = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(() => buildPreviewDocument('x'.repeat(200001))).toThrow();
  });
  it('accepts local raster sources but refuses active or external image URLs', () => {
    expect(isAllowedArtifactImageSource('workspace-asset://ws/picture.png')).toBe(true);
    expect(isAllowedArtifactImageSource('intent://local/file/screens/one.png')).toBe(true);
    expect(isAllowedArtifactImageSource('data:image/png;base64,AAAA')).toBe(true);
    for (const src of [
      'javascript:alert(1)',
      'https://example.org/tracker',
      'data:image/svg+xml;base64,AAAA',
      'file:///etc/passwd',
    ])
      expect(isAllowedArtifactImageSource(src)).toBe(false);
  });
});
