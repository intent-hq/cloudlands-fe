import { describe, expect, it } from 'vitest';
import { computeRevealScrollTop, findRevealIndex } from '../reveal-scroll';

const view = { itemHeight: 25, viewHeight: 250 };

describe('computeRevealScrollTop', () => {
  it('keeps the scroll position for a fully visible row', () => {
    expect(computeRevealScrollTop({ ...view, index: 13, viewTop: 125 })).toBeNull();
    expect(computeRevealScrollTop({ ...view, index: 5, viewTop: 125 })).toBeNull();
    expect(computeRevealScrollTop({ ...view, index: 14, viewTop: 125 })).toBeNull();
  });

  it('scrolls a row clipped at the bottom just enough to show it', () => {
    expect(computeRevealScrollTop({ ...view, index: 10, viewTop: 10 })).toBe(25);
  });

  it('scrolls a row clipped at the top just enough to show it', () => {
    expect(computeRevealScrollTop({ ...view, index: 4, viewTop: 110 })).toBe(100);
  });

  it('centers a row that is fully out of view', () => {
    expect(computeRevealScrollTop({ ...view, index: 30, viewTop: 0 })).toBe(30 * 25 - 125 + 12.5);
    expect(computeRevealScrollTop({ ...view, index: 2, viewTop: 500 })).toBe(0);
  });

  it('treats a sub-pixel overlap from fractional zoom as visible', () => {
    expect(computeRevealScrollTop({ ...view, index: 14, viewTop: 124.8 })).toBeNull();
    expect(computeRevealScrollTop({ ...view, index: 5, viewTop: 125.4 })).toBeNull();
  });

  it('never returns a negative scroll position', () => {
    expect(computeRevealScrollTop({ ...view, index: 0, viewTop: 300 })).toBe(0);
  });
});

describe('findRevealIndex', () => {
  const ws = '/repo';

  it('prefers the exact workspace path over an earlier suffix match', () => {
    const paths = ['/repo/app', '/repo/app/lib', '/repo/lib'];
    expect(findRevealIndex(paths, 'lib/', ws)).toBe(2);
    expect(findRevealIndex(paths, 'lib', ws)).toBe(2);
  });

  it('falls back to a suffix match when no exact path is present', () => {
    expect(findRevealIndex(['/repo/app', '/repo/app/lib'], 'lib', ws)).toBe(1);
  });

  it('matches absolute targets and reports a missing row', () => {
    expect(findRevealIndex(['/repo/src', '/repo/src/a.ts'], '/repo/src/a.ts', ws)).toBe(1);
    expect(findRevealIndex(['/repo/src'], 'docs/', ws)).toBe(-1);
  });
});
