/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import CatalogComponentPage from './CatalogComponentPage.svelte';
import { getCatalogEntry } from './catalog';

afterEach(cleanup);

describe('catalog component docs page', () => {
  it('switches between live preview, fixture source, and prop inspection', async () => {
    const entry = getCatalogEntry('button');
    expect(entry).toBeDefined();
    const { container } = render(CatalogComponentPage, { props: { entry: entry! } });

    expect(screen.getByRole('heading', { name: 'Button', level: 1 })).toBeTruthy();
    expect(container.querySelectorAll('[data-catalog-preview="button"]')).toHaveLength(2);
    expect(screen.getByRole('table', { name: 'Button API reference' })).toBeTruthy();

    const codeTab = screen.getByRole('tab', { name: 'Code' });
    await fireEvent.click(codeTab);
    expect(codeTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText(/from '\$lib\/components\/ui\/button'/).length).toBeGreaterThan(1);

    await fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
    expect(screen.getByRole('table', { name: 'Button playground props' })).toBeTruthy();
    expect(screen.getAllByText('variant').length).toBeGreaterThan(0);
  });
});
