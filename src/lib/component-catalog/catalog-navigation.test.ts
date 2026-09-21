import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { catalogEntries, getCatalogEntry } from './catalog';
import { buildCatalogNavigation, getCatalogSystemSlug } from './catalog-navigation';
import CatalogShell from './CatalogShell.svelte';
import CatalogRoute from '../../routes/sandbox/[slug]/+page.svelte';

const route = vi.hoisted(() => ({
  params: { slug: 'typography' },
  url: new URL('http://localhost/sandbox/typography'),
}));
vi.mock('$app/state', () => ({ page: route }));
afterEach(cleanup);
const previewReadyWait = { timeout: 10_000 };

it('groups discovery levels while preserving existing destinations', () => {
  const groups = buildCatalogNavigation(catalogEntries);
  expect(groups.map(({ name }) => name)).toEqual([
    'Foundations',
    'Components',
    'Patterns',
    'Product examples',
  ]);
  expect(groups[0].entries.map(({ slug }) => slug)).toEqual([
    'typography',
    'color',
    'sizes',
    'surfaces',
    'motion',
    'scrollbars',
  ]);
  for (const slug of ['button', 'settings-field-row', 'rows', 'dropdown', 'searchable-select']) {
    expect(getCatalogEntry(slug)).toBeDefined();
    expect(groups.flatMap(({ entries }) => entries)).toContainEqual(
      expect.objectContaining({ slug, href: `/sandbox/${slug}` }),
    );
  }
  expect(groups[3].entries).toContainEqual({
    slug: 'recipes',
    name: 'Recipes',
    href: '/sandbox/recipes',
  });
  expect(getCatalogSystemSlug('sizes')).toBe('sizes');
  expect(getCatalogSystemSlug('missing')).toBeUndefined();
});

it('filters names and slugs across groups and clears with Escape', async () => {
  render(CatalogShell, { props: { activeSlug: 'button', activePath: '/sandbox/button' } });
  const nav = within(screen.getByRole('navigation', { name: 'Component catalog' }));
  const input = nav.getByRole('searchbox', { name: 'Search catalog' });
  await fireEvent.input(input, { target: { value: '  TYPO  ' } });
  expect(nav.getByRole('link', { name: 'Typography' }).getAttribute('href')).toBe(
    '/sandbox/typography',
  );
  expect(nav.queryByRole('link', { name: 'Button', exact: true })).toBeNull();
  await fireEvent.input(input, { target: { value: 'chat-composer' } });
  expect(nav.getByRole('link', { name: 'Chat composer' }).getAttribute('href')).toBe(
    '/sandbox/chat-composer',
  );
  await fireEvent.input(input, { target: { value: 'no-such-entry' } });
  expect(nav.getByRole('status')).toBeTruthy();
  await fireEvent.keyDown(input, { key: 'Escape' });
  expect(nav.queryByRole('status')).toBeNull();
  expect(nav.getByRole('link', { name: 'Button', exact: true }).getAttribute('href')).toBe(
    '/sandbox/button',
  );
});

it.each([
  ['typography', 'Typography'],
  ['color', 'Color'],
  ['sizes', 'Sizes'],
  ['motion', 'Motion'],
  ['surfaces', 'Surfaces'],
])('renders the %s URL through the dynamic route', async (slug, name) => {
  route.params.slug = slug;
  route.url = new URL(`http://localhost/sandbox/${slug}`);
  render(CatalogRoute);
  expect(await screen.findByRole('heading', { level: 1, name })).toBeTruthy();
  if (slug === 'sizes') expect(screen.queryByRole('table')).toBeNull();
  if (slug === 'typography') expect(screen.getAllByRole('row')).toHaveLength(6);
});

it.each([
  ['notify', 'Notify', '[data-toast-layout]'],
  ['confirm', 'Confirm', '[role="dialog"]'],
  ['settings', 'Settings', '[data-slot="settings-page"]'],
  ['collection', 'Collection', '[data-slot="list-view"]'],
  ['screen', 'Screen', '[data-slot="screen"]'],
  ['action-menu', 'Action Menu', 'button[aria-haspopup="menu"]'],
  ['form', 'Form', 'form'],
])(
  'renders the documented %s pattern URL with a real preview through the dynamic route',
  async (slug, name, landmark) => {
    route.params.slug = slug;
    route.url = new URL(`http://localhost/sandbox/${slug}`);
    const { container } = render(CatalogRoute);
    expect(await screen.findByRole('heading', { level: 1, name })).toBeTruthy();
    expect(screen.queryByText('Fixture not found')).toBeNull();
    const groups = buildCatalogNavigation(catalogEntries);
    expect(groups.find(({ name: groupName }) => groupName === 'Patterns')?.entries).toContainEqual(
      expect.objectContaining({ slug, href: `/sandbox/${slug}` }),
    );

    const previews = await waitFor(() => {
      const regions = [...container.querySelectorAll(`[data-catalog-preview="${slug}"]`)];
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) expect(region.childElementCount).toBeGreaterThan(0);
      return regions;
    }, previewReadyWait);
    expect(getCatalogEntry(slug)?.fixtures).toHaveLength(previews.length);
    for (const preview of previews) expect(preview.querySelector(landmark)).not.toBeNull();
  },
  15_000,
);

it('resolves the legacy spinner URL to the loading indicator without dropping its query', async () => {
  expect(getCatalogEntry('spinner')).toBe(getCatalogEntry('loading-indicator'));
  expect(catalogEntries.some(({ slug }) => slug === 'spinner')).toBe(false);
  route.params.slug = 'spinner';
  route.url = new URL('http://localhost/sandbox/spinner?theme=dark&width=420');
  render(CatalogRoute);
  expect(
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Loading indicator' },
      { timeout: 10_000 },
    ),
  ).toBeTruthy();
  expect(screen.queryByText('Fixture not found')).toBeNull();
  expect(route.url.search).toBe('?theme=dark&width=420');
});
