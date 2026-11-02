import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlipReorderHarness from './__tests__/FlipReorderHarness.svelte';

// jsdom has no Web Animations API; src/test-setup.ts supplies a getAnimations default.
// Without it, Svelte's animate:flip throws while a keyed each drops a row, aborting the
// flush so later effects never re-run (cloudlands-fe#3856).

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-item]')].map((row) => row.dataset.item);
}

function effectRevision(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-testid="effect-revision"]')?.dataset.revision;
}

describe('unit-test animation shims', () => {
  it('applies an animate:flip reorder that drops a row, and later effects still run', async () => {
    const { container, rerender } = render(FlipReorderHarness, {
      props: { items: ['a', 'b', 'c'], revision: 0 },
    });
    expect(rows(container)).toEqual(['a', 'b', 'c']);
    expect(effectRevision(container)).toBe('0');

    // Insert ahead of the list and drop the last row, as a capped list does on refresh.
    await rerender({ items: ['new', 'a', 'b'], revision: 1 });
    expect(rows(container)).toEqual(['new', 'a', 'b']);
    expect(effectRevision(container)).toBe('1');

    // A later update must still reach both the list and the effect.
    await rerender({ items: ['b', 'new'], revision: 2 });
    expect(rows(container)).toEqual(['b', 'new']);
    expect(effectRevision(container)).toBe('2');
  });

  it('lets a test simulate running animations and restores the default afterwards', () => {
    const element = document.createElement('div');
    expect(element.getAnimations()).toEqual([]);

    const running = { playState: 'running' } as Animation;
    const spy = vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([running]);
    expect(element.getAnimations()).toEqual([running]);

    spy.mockRestore();
    expect(element.getAnimations()).toEqual([]);
  });
});
