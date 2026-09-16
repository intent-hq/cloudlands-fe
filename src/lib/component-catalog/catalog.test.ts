import { describe, expect, it } from 'vitest';
import { canonicalPatternManifest } from '$lib/components/patterns/manifest';
import { canonicalComponentManifest } from '$lib/components/ui/manifest';
import { catalogEntries, getCatalogEntry } from './catalog';
import { getCatalogComponentName } from './catalog-export';
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

  it('registers every canonical pattern family under its documented slug', () => {
    for (const pattern of canonicalPatternManifest) {
      const entry = getCatalogEntry(pattern.id);
      expect(entry, pattern.id).toMatchObject({
        category: 'pattern',
        source: pattern.source,
        publicImport: pattern.publicImport,
        fixtures: pattern.fixtures,
      });
      expect([...(entry?.exports ?? [])].sort()).toEqual([...pattern.exports].sort());
    }
    expect(
      buildCatalogGroups(catalogEntries)
        .find(({ id }) => id === 'patterns')
        ?.entries.map(({ slug }) => slug),
    ).toEqual(expect.arrayContaining(canonicalPatternManifest.map(({ id }) => id)));
  });

  it('resolves the legacy spinner slug to the loading indicator entry', () => {
    expect(getCatalogEntry('spinner')).toBe(getCatalogEntry('loading-indicator'));
    expect(catalogEntries.map(({ slug }) => slug)).not.toContain('spinner');
  });

  it('publishes the loading indicator under its canonical name and import', () => {
    const entry = getCatalogEntry('loading-indicator');
    expect(entry).toMatchObject({
      name: 'Loading indicator',
      source: 'src/lib/components/ui/indicators/IntentMarkLoader.svelte',
      publicImport: '$lib/components/ui/indicators',
    });
    expect(entry?.exports?.[0]).toBe('IntentMarkLoader');
  });

  it('registers exactly one real preview renderer for every canonical fixture', () => {
    const rendererIds = [
      ...canonicalComponentManifest.map(({ id }) => id),
      ...canonicalPatternManifest.map(({ id }) => id),
      'modals',
      'model-picker',
      'popovers',
      'rows',
      'screen-states',
      'fields',
      'subscription-rows',
    ].sort();
    expect(Object.keys(catalogRenderers).sort()).toEqual(rendererIds);

    for (const component of [...canonicalComponentManifest, ...canonicalPatternManifest]) {
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
      'fields',
      'modals',
      'model-picker',
      'popovers',
      'proposal-card',
      'rows',
      'screen-states',
      'subscription-rows',
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
    ).toBe('primitives');
  });
});

const exportAliases: Record<string, string> = {
  kbd: 'ShortcutChip',
  list: 'ListContainer',
  'loading-indicator': 'IntentMarkLoader',
  'chat-polish': 'ChatMessage',
  modals: 'Dialog',
  popovers: 'Menu',
  fields: 'FormRow',
  rows: 'ListRow',
  'screen-states': 'EmptyState',
  'subscription-rows': 'EventSubscriptionsCard',
  collection: 'ListView',
  confirm: 'confirm',
  notify: 'notify',
  settings: 'SettingsForm',
};

it.each(catalogEntries)('resolves the public component export for $slug', (entry) => {
  const expected =
    exportAliases[entry.slug] ??
    entry.slug.replace(/(^|-)([a-z])/g, (_, _separator, letter: string) => letter.toUpperCase());
  expect(getCatalogComponentName(entry)).toBe(expected);
  expect(entry.exports).toContain(expected);
});

const componentModules = import.meta.glob([
  '/src/lib/components/**/index.ts',
  '/src/lib/components/**/*.svelte',
]);

function resolvesToModule(specifier: string): boolean {
  const path = specifier.replace(/^\$lib\//, '/src/lib/');
  return path in componentModules || `${path}/index.ts` in componentModules;
}

it.each(catalogEntries)('publishes resolvable import guidance for $slug', (entry) => {
  if (entry.publicImport) {
    expect(resolvesToModule(entry.publicImport), entry.publicImport).toBe(true);
  }
  const usageSpecifiers = [
    ...(entry.usage ?? '').matchAll(/from '(\$lib\/components\/[^']+)'/g),
  ].map(([, specifier]) => specifier);
  for (const specifier of usageSpecifiers) {
    expect(resolvesToModule(specifier), `${entry.slug}: ${specifier}`).toBe(true);
  }
});

it.each(['chat-polish', 'proposal-card'])(
  'shows a default-component import example for %s',
  (slug) => {
    const entry = getCatalogEntry(slug)!;
    const match = /^import (\w+) from '(\$lib\/components\/[^']+\.svelte)';$/m.exec(
      entry.usage ?? '',
    );
    expect(match, entry.usage).not.toBeNull();
    expect(match?.[1]).toBe(getCatalogComponentName(entry));
    expect(resolvesToModule(match![2])).toBe(true);
  },
);

it('skips default exports, bare parts, and lowercase helpers when selecting an alias', () => {
  expect(
    getCatalogComponentName({
      slug: 'example',
      exports: [
        'default',
        'Root',
        'Item',
        'Content',
        'exampleMetadata',
        'useExample',
        'ExampleView',
      ],
    }),
  ).toBe('ExampleView');
});
