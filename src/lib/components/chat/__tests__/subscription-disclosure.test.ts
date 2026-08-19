import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  safeSubscriptionRowTransition,
  SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
  SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS,
} from '../subscription-disclosure';

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
    expect(config.css?.(1, 0)).not.toContain('border-top-width');
    expect(config.css?.(1, 0)).toContain('opacity:1;transform:translateY(0px)');
  });

  it('uses inset separators that do not add to settled row or list height', () => {
    expect(SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS).toContain('before:absolute');
    expect(SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS).toContain('before:h-px');
    expect(SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS).toContain('first:before:hidden');
    expect(SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS).not.toMatch(/\bborder-/);
    expect(SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS).not.toMatch(/\bborder-/);
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
