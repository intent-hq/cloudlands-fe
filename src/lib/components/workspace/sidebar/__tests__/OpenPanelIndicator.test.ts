/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import OpenPanelIndicator from '../OpenPanelIndicator.svelte';

afterEach(cleanup);

describe('OpenPanelIndicator', () => {
  it('renders a passive accessible marker for canonical open state', () => {
    const { container, getByText } = render(OpenPanelIndicator, { props: { count: 1 } });
    const marker = container.querySelector<HTMLElement>('[data-panel-open-marker]')!;
    expect(marker.dataset.panelOpenState).toBe('open');
    expect(marker.dataset.panelOpenCount).toBe('1');
    expect(marker.getAttribute('aria-hidden')).toBe('true');
    expect(marker.querySelector('button, a, [tabindex]')).toBeNull();
    expect(getByText('Open in a panel').classList.contains('sr-only')).toBe(true);
  });

  it('distinguishes active duplicates and reserves no space when closed', async () => {
    const view = render(OpenPanelIndicator, { props: { count: 0 } });
    expect(view.container.childElementCount).toBe(0);
    await view.rerender({ count: 2, active: true, overlay: true });
    const marker = view.container.querySelector<HTMLElement>('[data-panel-open-marker]')!;
    expect(marker.dataset.panelOpenState).toBe('active');
    expect(marker.dataset.panelOpenCount).toBe('2');
    expect(marker.classList).toContain('absolute', 'z-20');
    expect(view.getByText('Active panel; open in 2 panels')).toBeTruthy();
  });
});
