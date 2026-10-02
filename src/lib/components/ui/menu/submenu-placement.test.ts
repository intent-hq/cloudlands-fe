import { describe, expect, it } from 'vitest';
import { resolveSubmenuSide } from './submenu-placement';

describe('submenu collision fallback', () => {
  const padding = { left: 8, right: 8 };

  it.each(['left', 'right'] as const)(
    'uses vertical placement when neither side fits (%s)',
    (side) => {
      expect(resolveSubmenuSide(side, { left: 37, right: 187 }, 160, 200, 4, padding)).toBe(
        'bottom',
      );
    },
  );

  it('leaves ordinary horizontal placement and flipping to the collision engine', () => {
    expect(resolveSubmenuSide('right', { left: 32, right: 182 }, 160, 420, 4, padding)).toBe(
      'right',
    );
    expect(resolveSubmenuSide('right', { left: 228, right: 378 }, 160, 420, 4, padding)).toBe(
      'right',
    );
  });

  it('accounts for the configured gap and asymmetric viewport padding', () => {
    const trigger = { left: 28, right: 178 };
    const insets = { left: 8, right: 16 };
    expect(resolveSubmenuSide('right', trigger, 160, 358, 4, insets)).toBe('right');
    expect(resolveSubmenuSide('right', trigger, 160, 358, 5, insets)).toBe('bottom');
  });

  it('preserves an explicit vertical side or an unmeasured layout', () => {
    const trigger = { left: 0, right: 0 };
    expect(resolveSubmenuSide('top', trigger, 160, 200, 4, padding)).toBe('top');
    expect(resolveSubmenuSide('right', trigger, 0, 200, 4, padding)).toBe('right');
    expect(resolveSubmenuSide('left', trigger, 160, 0, 4, padding)).toBe('left');
  });
});
