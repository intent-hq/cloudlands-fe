import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './reduced-motion';

afterEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-reduce-motion');
  vi.restoreAllMocks();
});

describe('catalog motion preferences', () => {
  it('uses battery reduction and lets an explicit full preview override it', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    document.documentElement.setAttribute('data-reduce-motion', '');
    expect(prefersReducedMotion(document)).toBe(true);
    document.documentElement.classList.add('catalog-full-motion');
    expect(prefersReducedMotion(document)).toBe(false);
  });

  it('uses the system preference without an explicit override', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(prefersReducedMotion(document)).toBe(true);
  });

  it('lets the sandbox full-motion choice override the system preference', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    document.documentElement.classList.add('catalog-full-motion');
    expect(prefersReducedMotion(document)).toBe(false);
  });

  it('gives the explicit reduced-motion choice precedence', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    document.documentElement.classList.add('catalog-reduced-motion', 'catalog-full-motion');
    expect(prefersReducedMotion(document)).toBe(true);
  });
});
