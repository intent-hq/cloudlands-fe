import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeSubscriptionRowTransition } from '../subscription-disclosure';

function rowStyle(): CSSStyleDeclaration {
  return {
    height: '36px',
    opacity: '1',
    paddingTop: '0px',
    paddingBottom: '0px',
    marginTop: '0px',
    marginBottom: '0px',
    borderTopWidth: '1px',
    borderBottomWidth: '0px',
  } as CSSStyleDeclaration;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('safeSubscriptionRowTransition', () => {
  it('moves a clipped row from zero height and opacity to its measured natural box', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(rowStyle());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const config = safeSubscriptionRowTransition(document.createElement('div'));

    expect(config.duration).toBe(160);
    expect(config.css?.(0, 1)).toContain('overflow:hidden;height:0px');
    expect(config.css?.(0, 1)).toContain('opacity:0;transform:translateY(-2px)');
    expect(config.css?.(1, 0)).toContain('height:36px');
    expect(config.css?.(1, 0)).toContain('border-top-width:1px');
    expect(config.css?.(1, 0)).toContain('opacity:1;transform:translateY(0px)');
  });

  it('is immediate under reduced motion and safe without a measured box', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    expect(safeSubscriptionRowTransition(document.createElement('div'))).toEqual({ duration: 0 });

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      ...rowStyle(),
      height: 'auto',
    } as CSSStyleDeclaration);
    expect(safeSubscriptionRowTransition(document.createElement('div'))).toEqual({ duration: 0 });
  });
});
