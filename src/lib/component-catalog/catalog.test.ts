import { describe, expect, it } from 'vitest';
import { canonicalComponentManifest } from '$lib/components/ui/manifest';
import { catalogEntries, getCatalogEntry } from './catalog';
import { buildCatalogGroups } from './catalog-navigation';
import { catalogRenderers } from './catalog-renderers';

describe('static component catalog', () => {
  it('loads stable, unique entries and schema-shaped fixture metadata', () => {
    const slugs = catalogEntries.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(catalogEntries.length).toBeGreaterThan(0);

    for (const entry of catalogEntries) {
      expect(entry.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(entry.fixtures.length).toBeGreaterThan(0);
      expect(getCatalogEntry(entry.slug)).toBe(entry);
      for (const fixture of entry.fixtures) {
        expect(fixture.id).not.toBe('');
        expect(fixture.title).not.toBe('');
        expect(fixture.states.length).toBeGreaterThan(0);
      }
    }
  });

  it('returns undefined for an unknown static fixture route', () => {
    expect(getCatalogEntry('not-a-catalog-entry')).toBeUndefined();
  });

  it('registers exactly one real preview renderer for every canonical fixture', () => {
    const manifestIds = canonicalComponentManifest.map(({ id }) => id).sort();
    expect(Object.keys(catalogRenderers).sort()).toEqual(manifestIds);

    for (const component of canonicalComponentManifest) {
      expect(catalogRenderers[component.id], component.id).toBeDefined();
      for (const fixture of component.fixtures) {
        expect(catalogRenderers[component.id], `${component.id}/${fixture.id}`).toBeDefined();
      }
    }
  });

  it('derives navigation groups from catalog source entries without losing future modules', () => {
    const groups = buildCatalogGroups(catalogEntries);
    const groupedSlugs = groups.flatMap(({ entries }) => entries.map(({ slug }) => slug));

    expect(groupedSlugs.sort()).toEqual(catalogEntries.map(({ slug }) => slug).sort());
    expect(new Set(groupedSlugs).size).toBe(groupedSlugs.length);
    expect(groups.find(({ id }) => id === 'products')?.entries.map(({ slug }) => slug)).toEqual([
      'chat-polish',
      'new-workspace',
      'proposal-card',
    ]);
    expect(
      buildCatalogGroups([
        {
          slug: 'input',
          name: 'Input',
          description: 'Future canonical field',
          category: 'primitive',
          source: 'src/lib/components/ui/input/input.svelte',
          fixtures: [{ id: 'default', title: 'Default', states: ['default'] }],
        },
      ])[0].id,
    ).toBe('fields');
  });
});
