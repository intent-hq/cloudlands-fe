import type { CatalogEntry } from './catalog';

export interface CatalogGroup {
  id: string;
  name: string;
  entries: CatalogEntry[];
}

export interface CatalogNavEntry {
  slug: string;
  name: string;
  href: string;
}

export const catalogShowcaseEntries: readonly CatalogNavEntry[] = [
  { slug: 'introduction', name: 'Introduction', href: '/sandbox' },
  { slug: 'recipes', name: 'Recipes', href: '/sandbox/recipes' },
  { slug: 'chat-composer', name: 'Chat composer', href: '/sandbox/chat-composer' },
  { slug: 'directory-picker', name: 'Directory picker', href: '/sandbox/directory-picker' },
  { slug: 'question-wizard', name: 'Question wizard', href: '/sandbox/question-wizard' },
];

export const catalogSystemEntries = [
  { slug: 'typography', name: 'Typography', href: '/sandbox/typography' },
  { slug: 'color', name: 'Color', href: '/sandbox/color' },
  { slug: 'sizes', name: 'Sizes', href: '/sandbox/sizes' },
  { slug: 'surfaces', name: 'Surfaces', href: '/sandbox/surfaces' },
  { slug: 'motion', name: 'Motion', href: '/sandbox/motion' },
  { slug: 'scrollbars', name: 'Scrollbars', href: '/sandbox/scrollbars' },
] as const satisfies readonly CatalogNavEntry[];

export type CatalogSystemSlug = (typeof catalogSystemEntries)[number]['slug'];

export function getCatalogSystemSlug(slug: string): CatalogSystemSlug | undefined {
  return catalogSystemEntries.find((entry) => entry.slug === slug)?.slug;
}

export function buildCatalogGroups(entries: CatalogEntry[]): CatalogGroup[] {
  return [
    { id: 'primitives', name: 'Components', category: 'primitive' },
    { id: 'patterns', name: 'Patterns', category: 'pattern' },
    { id: 'products', name: 'Product examples', category: 'product' },
  ].map(({ id, name, category }) => ({
    id,
    name,
    entries: entries.filter(
      (entry) =>
        entry.category === category ||
        (category === 'primitive' && entry.category === 'deprecated-wrapper'),
    ),
  }));
}

export function buildCatalogNavigation(entries: CatalogEntry[], query = '') {
  const search = query.trim().toLowerCase();
  return [
    { id: 'foundations', name: 'Foundations', entries: catalogSystemEntries },
    ...buildCatalogGroups(entries).map((group) => ({
      ...group,
      entries: [
        ...group.entries.map(({ slug, name }) => ({ slug, name, href: `/sandbox/${slug}` })),
        ...(group.id === 'products' ? catalogShowcaseEntries : []),
      ],
    })),
  ]
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        ({ name, slug }) => name.toLowerCase().includes(search) || slug.includes(search),
      ),
    }))
    .filter((group) => group.entries.length > 0);
}
