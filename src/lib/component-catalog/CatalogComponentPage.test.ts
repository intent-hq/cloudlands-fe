/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import CatalogComponentPage from './CatalogComponentPage.svelte';
import { getCatalogEntry } from './catalog';

afterEach(cleanup);

describe('catalog component docs page', () => {
  it('operates the lazily loaded component preview', async () => {
    render(CatalogComponentPage, { props: { entry: getCatalogEntry('button')! } });
    const button = await screen.findByRole('button', { name: '1. Primary' }, { timeout: 10_000 });
    await fireEvent.click(button);
    expect(screen.getByLabelText('Button click count').textContent).toBe('1');
  });

  it.each(['button', 'select', 'dialog'])('shows import-only guidance for %s', async (slug) => {
    render(CatalogComponentPage, {
      props: { entry: { ...getCatalogEntry(slug)!, usage: undefined } },
    });
    expect(screen.getAllByRole('table')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('tab', { name: 'Import' }));
    const name = slug[0].toUpperCase() + slug.slice(1);
    expect(screen.getByRole('tabpanel').textContent?.trim()).toBe(
      `import { ${name} } from '$lib/components/ui/${slug}';`,
    );
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it.each(['select', 'dialog'])('renders the authored %s composition', async (slug) => {
    const entry = getCatalogEntry(slug)!;
    render(CatalogComponentPage, { props: { entry } });
    await fireEvent.click(screen.getByRole('tab', { name: 'Usage' }));
    expect(screen.getByRole('tabpanel').textContent?.trim()).toBe(entry.usage);
  });

  it('renders authored usage verbatim', async () => {
    const usage = '<Button onclick={() => alert("Saved")}>Save</Button>';
    render(CatalogComponentPage, { props: { entry: { ...getCatalogEntry('button')!, usage } } });
    await fireEvent.click(screen.getByRole('tab', { name: 'Usage' }));
    expect(screen.getByRole('tabpanel').textContent?.trim()).toBe(usage);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it.each([
    { slug: 'select', incomplete: true },
    { slug: 'button', incomplete: false },
  ])('reports shared-only reference coverage for $slug', ({ slug, incomplete }) => {
    render(CatalogComponentPage, { props: { entry: getCatalogEntry(slug)! } });
    expect(
      screen.queryByText('Reference incomplete: only shared props are documented') !== null,
    ).toBe(incomplete);
  });
});
