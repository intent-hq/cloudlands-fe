// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { toggleFixtures } from '$lib/components/ui/toggle/toggle.fixtures';
import BasicCatalogPreview from './BasicCatalogPreview.svelte';

afterEach(cleanup);

describe('BasicCatalogPreview Toggle fixtures', () => {
  it('renders every declared canonical state with real labeled Toggle controls', async () => {
    const fixture = toggleFixtures[0];
    const view = render(BasicCatalogPreview, {
      props: { componentId: 'toggle', fixture },
    });
    const renderedStates = Array.from(
      view.container.querySelectorAll('[data-catalog-rendered-state]'),
    ).flatMap((element) => element.getAttribute('data-catalog-rendered-state')?.split(' ') ?? []);

    expect(new Set(renderedStates)).toEqual(new Set(fixture.states));
    expect(view.getByRole('button', { name: 'Pinned' }).getAttribute('aria-pressed')).toBe('true');
    expect(
      view.getByRole('button', { name: 'Disabled pressed' }).getAttribute('aria-pressed'),
    ).toBe('true');

    const interactive = view.getByRole('button', { name: 'Interactive' });
    await fireEvent.click(interactive);
    expect(interactive.getAttribute('aria-pressed')).toBe('true');
    expect(view.getByRole('status', { name: 'Interactive toggle value' }).textContent).toBe('true');
  });
});
