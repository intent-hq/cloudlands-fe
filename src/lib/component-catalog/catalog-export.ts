import type { CatalogEntry } from './catalog';

const componentParts = new Set([
  'Root',
  'Item',
  'Content',
  'Close',
  'Trigger',
  'Action',
  'Body',
  'Header',
  'Footer',
  'Title',
  'Description',
  'Portal',
  'Overlay',
  'Group',
  'Label',
  'Separator',
  'CheckboxGroup',
  'CheckboxItem',
  'RadioGroup',
  'RadioItem',
  'Sub',
  'SubContent',
  'SubTrigger',
  'Arrow',
  'Callout',
  'Scrollbar',
  'Thumb',
  'List',
  'Link',
]);

export function getCatalogComponentName(entry: Pick<CatalogEntry, 'slug' | 'exports'>): string {
  const canonicalName = entry.slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return (
    entry.exports?.find((name) => name === canonicalName) ??
    entry.exports?.find((name) => /^[A-Z]/.test(name) && !componentParts.has(name)) ??
    canonicalName
  );
}
