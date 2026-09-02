import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SidebarExpandableSearch from './SidebarExpandableSearch.svelte';
import SidebarHeaderAction from './SidebarHeaderAction.svelte';

describe('SidebarExpandableSearch', () => {
  it('expands with focus, clears on Escape, and restores trigger focus', async () => {
    const view = render(SidebarExpandableSearch, {
      props: { placeholder: 'Search agents...', scope: 'agents' },
    });
    const trigger = view.getByRole('button', { name: 'Search agents...' });
    await fireEvent.click(trigger);

    const input = view.getByRole('searchbox', { name: 'Search agents...' });
    expect(document.activeElement).toBe(input);
    await fireEvent.input(input, { target: { value: 'café' } });
    expect((input as HTMLInputElement).value).toBe('café');
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(view.queryByRole('searchbox')).toBeNull());
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Search agents...' }));
  });

  it('uses identical 28px targets and 14px glyph boxes for plus, search, and close', () => {
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function () {
        if (this instanceof HTMLElement && this.matches('button[data-sidebar-action]')) {
          const size = this.className.includes('size-7') ? 28 : 0;
          return new DOMRect(0, 0, size, size);
        }
        if (this instanceof SVGElement && this.matches('[data-sidebar-action-icon]')) {
          const size = this.getAttribute('class')?.includes('size-3.5') ? 14 : 0;
          return new DOMRect(0, 0, size, size);
        }
        return new DOMRect();
      });

    const views = (['plus', 'search', 'close'] as const).map((icon) =>
      render(SidebarHeaderAction, { props: { icon, label: icon } }),
    );
    const targets = views.map((view, index) =>
      view
        .getByRole('button', { name: ['plus', 'search', 'close'][index] })
        .getBoundingClientRect(),
    );
    const glyphs = views.map((view, index) =>
      view.container
        .querySelector<SVGElement>(
          `[data-sidebar-action-icon="${['plus', 'search', 'close'][index]}"]`,
        )!
        .getBoundingClientRect(),
    );

    expect(targets.map(({ width, height }) => [width, height])).toEqual([
      [28, 28],
      [28, 28],
      [28, 28],
    ]);
    expect(glyphs.map(({ width, height }) => [width, height])).toEqual([
      [14, 14],
      [14, 14],
      [14, 14],
    ]);
    rectSpy.mockRestore();
  });
});
