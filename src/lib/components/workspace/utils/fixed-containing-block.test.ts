import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFixedContainingBlockOffset } from './fixed-containing-block';

describe('getFixedContainingBlockOffset', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the padding-box origin of a backdrop-filter containing block', () => {
    const ancestor = document.createElement('div');
    const node = document.createElement('div');
    ancestor.append(node);

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transform: 'none',
      translate: 'none',
      rotate: 'none',
      scale: 'none',
      perspective: 'none',
      filter: 'none',
      backdropFilter: 'blur(24px)',
      contain: 'none',
      contentVisibility: 'visible',
      willChange: 'auto',
    } as CSSStyleDeclaration);
    vi.spyOn(ancestor, 'getBoundingClientRect').mockReturnValue({
      left: 296,
      top: 35,
    } as DOMRect);
    Object.defineProperties(ancestor, {
      clientLeft: { value: 1 },
      clientTop: { value: 1 },
    });

    expect(getFixedContainingBlockOffset(node)).toEqual({ x: 297, y: 36 });
  });

  it('uses the viewport origin when no ancestor creates a containing block', () => {
    const node = document.createElement('div');
    document.body.append(node);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transform: 'none',
      translate: 'none',
      rotate: 'none',
      scale: 'none',
      perspective: 'none',
      filter: 'none',
      backdropFilter: 'none',
      contain: 'none',
      contentVisibility: 'visible',
      willChange: 'auto',
    } as CSSStyleDeclaration);

    expect(getFixedContainingBlockOffset(node)).toEqual({ x: 0, y: 0 });
    node.remove();
  });
});
