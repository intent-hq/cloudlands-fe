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

export const catalogSystemEntries: readonly CatalogNavEntry[] = [
  { slug: 'motion', name: 'Motion', href: '/sandbox/motion' },
  { slug: 'scrollbars', name: 'Scrollbars', href: '/sandbox/scrollbars' },
  { slug: 'sizes', name: 'Sizes', href: '/sandbox/sizes' },
  { slug: 'surfaces', name: 'Surfaces', href: '/sandbox/surfaces' },
];

const groupDefinitions = [
  { id: 'actions', name: 'Actions & status', match: /badge|button|toggle|status|progress|alert/ },
  {
    id: 'fields',
    name: 'Fields & choices',
    match: /input|select|combobox|checkbox|switch|slider|radio|textarea|label/,
  },
  { id: 'navigation', name: 'Navigation', match: /tab|sidebar|breadcrumb|pagination|navigation/ },
  { id: 'settings-patterns', name: 'Settings patterns', match: /settings/ },
  { id: 'overlays', name: 'Overlays', match: /dialog|sheet|menu|popover|tooltip|dropdown|command/ },
] as const;

export function buildCatalogGroups(entries: CatalogEntry[]): CatalogGroup[] {
  const buckets = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const definition = groupDefinitions.find(({ match }) =>
      match.test(`${entry.slug} ${entry.source}`),
    );
    const id =
      definition?.id ??
      (entry.category === 'pattern'
        ? 'patterns'
        : entry.category === 'product'
          ? 'products'
          : 'primitives');
    const items = buckets.get(id) ?? [];
    items.push(entry);
    buckets.set(id, items);
  }

  const known = groupDefinitions.flatMap(({ id, name }) => {
    const entries = buckets.get(id);
    return entries ? [{ id, name, entries }] : [];
  });
  const fallback = [
    { id: 'primitives', name: 'Primitives' },
    { id: 'patterns', name: 'Patterns' },
    { id: 'products', name: 'Product components' },
  ].flatMap(({ id, name }) => {
    const entries = buckets.get(id);
    return entries ? [{ id, name, entries }] : [];
  });
  return [...known, ...fallback];
}
