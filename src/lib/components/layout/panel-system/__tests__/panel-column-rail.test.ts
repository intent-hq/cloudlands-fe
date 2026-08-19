/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelColumnRail from '../PanelColumnRail.svelte';

afterEach(cleanup);

describe('PanelColumnRail', () => {
  it('renders the active 2px outlined icon and selects counts 1 through 4', async () => {
    const onCountChange = vi.fn();
    const { container } = render(PanelColumnRail, {
      props: { count: 2, onCountChange },
    });

    const trigger = screen.getByRole('button', { name: 'Panel columns: 2' });
    expect(trigger.textContent?.trim()).toBe('2');
    const icon = container.querySelector('[data-panel-column-count-icon] svg')!;
    expect(icon.getAttribute('stroke-width')).toBe('2');
    expect(icon.querySelectorAll('rect')).toHaveLength(2);

    await fireEvent.click(trigger);
    const options = await screen.findAllByRole('menuitemradio');
    expect(options).toHaveLength(4);
    expect(screen.getByRole('menuitemradio', { name: '1 column' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '2 columns' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '3 columns' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '4 columns' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('menuitemradio', { name: '4 columns' }));
    expect(onCountChange).toHaveBeenCalledOnce();
    expect(onCountChange).toHaveBeenCalledWith(4);
  });
});
