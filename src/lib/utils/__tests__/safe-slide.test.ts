/**
 * Tests for safeSlide — slide transition that degrades to a no-op when the
 * node has no layout box (e.g. inside a display:none keep-alive tab wrapper),
 * instead of producing NaN keyframe values that Chrome's Web Animations API
 * rejects with "Invalid keyframe value for property height: NaNpx".
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { prefersReducedMotion, safeFade, safeSlide } from '../animations';

function makeNode(computed: Partial<CSSStyleDeclaration>): Element {
  const node = document.createElement('div');
  document.body.appendChild(node);
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    opacity: '1',
    height: '100px',
    width: '200px',
    paddingTop: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    paddingRight: '0px',
    marginTop: '0px',
    marginBottom: '0px',
    marginLeft: '0px',
    marginRight: '0px',
    borderTopWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderRightWidth: '0px',
    ...computed,
  } as CSSStyleDeclaration);
  return node;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('safeSlide', () => {
  it('returns a real slide transition when the node is laid out', () => {
    const node = makeNode({ height: '100px' });
    const config = safeSlide(node, { axis: 'y', duration: 200 });
    expect(config.duration).toBe(200);
    expect(config.css).toBeTypeOf('function');
    const css = config.css!(0.5, 0.5);
    expect(css).toContain('height:');
    expect(css).not.toContain('NaN');
  });

  it('degrades to a no-op when computed height is "auto" (no layout box)', () => {
    const node = makeNode({ height: 'auto' });
    const config = safeSlide(node, { axis: 'y', duration: 200 });
    expect(config.duration).toBe(0);
    expect(config.css).toBeUndefined();
  });

  it('checks width for axis: "x"', () => {
    const laidOut = makeNode({ width: '200px' });
    expect(safeSlide(laidOut, { axis: 'x', duration: 150 }).duration).toBe(150);

    vi.restoreAllMocks();
    const notLaidOut = makeNode({ width: 'auto' });
    const config = safeSlide(notLaidOut, { axis: 'x', duration: 150 });
    expect(config.duration).toBe(0);
  });

  it('defaults to the y axis when no axis is given', () => {
    const node = makeNode({ height: 'auto', width: '200px' });
    expect(safeSlide(node, { duration: 100 }).duration).toBe(0);
  });

  it('never emits NaN in css output for a laid-out node', () => {
    const node = makeNode({ height: '48px', paddingTop: '8px', paddingBottom: '8px' });
    const config = safeSlide(node, { axis: 'y', duration: 200 });
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(config.css!(t, 1 - t)).not.toContain('NaN');
    }
  });
});

describe('reduced motion', () => {
  it('disables slide and fade transitions through the shared policy', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const node = makeNode({ height: '100px' });

    expect(prefersReducedMotion()).toBe(true);
    expect(safeSlide(node, { duration: 200 })).toEqual({ duration: 0 });
    expect(safeFade(node, { duration: 200 })).toEqual({ duration: 0 });
  });
});
