import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  safeSubscriptionRowTransition,
  SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
  SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS,
  SUBSCRIPTION_LEADING_COLUMN_CLASS,
  SUBSCRIPTION_ROW_GEOMETRY_CLASS,
  SUBSCRIPTION_TRAILING_CONTROLS_CLASS,
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
  it('defines the shared row and leading-column geometry', () => {
    expect(SUBSCRIPTION_ROW_GEOMETRY_CLASS).toContain('min-h-9');
    expect(SUBSCRIPTION_ROW_GEOMETRY_CLASS).toContain('gap-2');
    expect(SUBSCRIPTION_ROW_GEOMETRY_CLASS).toContain('px-3!');
    expect(SUBSCRIPTION_ROW_GEOMETRY_CLASS).toContain('py-2!');
    expect(SUBSCRIPTION_LEADING_COLUMN_CLASS).toContain('h-(--agent-avatar-standard-surface-size)');
    expect(SUBSCRIPTION_LEADING_COLUMN_CLASS).toContain('w-(--agent-avatar-standard-surface-size)');
    expect(SUBSCRIPTION_TRAILING_CONTROLS_CLASS).toContain('ml-auto');
    expect(SUBSCRIPTION_TRAILING_CONTROLS_CLASS).toContain('shrink-0');
  });

  it('moves a clipped row from zero height and opacity to its measured natural box', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(rowStyle());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const node = document.createElement('div');
    const config = safeSubscriptionRowTransition(node);

    expect(config.duration).toBe(160);
    // Styles are tick-driven (not css/WAAPI) so the height mutation lands in
    // the same task as the followed-bottom scroll correction.
    expect(config.css).toBeUndefined();
    config.tick?.(0, 1);
    expect(node.style.overflow).toBe('hidden');
    expect(node.style.height).toBe('0px');
    expect(node.style.opacity).toBe('0');
    expect(node.style.transform).toBe('translateY(-2px)');
    config.tick?.(0.5, 0.5);
    expect(node.style.height).toBe('18px');
    expect(node.style.borderTopWidth).toBe('');
    config.tick?.(1, 0);
    expect(node.style.overflow).toBe('');
    expect(node.style.height).toBe('');
    expect(node.style.opacity).toBe('');
    expect(node.style.transform).toBe('');
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
