import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldReduceMotion } from './motion-preference';

afterEach(() => {
  document.documentElement.className = '';
  vi.restoreAllMocks();
});

describe('shouldReduceMotion', () => {
  it('uses the system preference without an explicit override', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(shouldReduceMotion(document)).toBe(true);
  });

  it('lets the sandbox full-motion choice override the system preference', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    document.documentElement.classList.add('catalog-full-motion');
    expect(shouldReduceMotion(document)).toBe(false);
  });

  it('gives the explicit reduced-motion choice precedence', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    document.documentElement.classList.add('catalog-reduced-motion', 'catalog-full-motion');
    expect(shouldReduceMotion(document)).toBe(true);
  });
});
