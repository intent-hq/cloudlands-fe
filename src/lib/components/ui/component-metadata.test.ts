import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from './component-metadata';
import { canonicalComponentManifest } from './manifest';
import { selectMetadata } from './select/select.meta';

describe('component metadata usage contract', () => {
  it('keeps existing metadata valid without usage', () => {
    const { usage: _usage, ...metadata } = selectMetadata;
    expect(parseUiComponentMetadata(metadata)).toEqual(metadata);
    expect(parseUiComponentMetadata(metadata).usage).toBeUndefined();
  });

  it('preserves authored snippet formatting', () => {
    const usage = '\n  <Select options={options} />\n';
    expect(parseUiComponentMetadata({ ...selectMetadata, usage }).usage).toBe(usage);
  });

  it.each(['', '  \n\t', 42, null])('rejects empty or non-string usage: %j', (usage) => {
    expect(() => parseUiComponentMetadata({ ...selectMetadata, usage })).toThrow(/usage/);
  });
});

const publicModules = import.meta.glob<Record<string, unknown>>('./*/index.ts');

it('provides usage for every public parts-style component entry', async () => {
  const compoundIds: string[] = [];
  for (const entry of canonicalComponentManifest) {
    const load = publicModules[`./${entry.id}/index.ts`];
    if (!load) continue;
    const exports = await load();
    const hasParts = (parts: Record<string, unknown>) =>
      typeof parts.Root === 'function' &&
      ['Content', 'Item', 'List', 'Scrollbar'].some((part) => typeof parts[part] === 'function');
    const compound =
      hasParts(exports) ||
      (typeof exports.ListContainer === 'function' && typeof exports.ListItem === 'function') ||
      Object.values(exports).some(
        (value) =>
          value !== null && typeof value === 'object' && hasParts(value as Record<string, unknown>),
      );
    if (!compound) continue;
    compoundIds.push(entry.id);
    expect(entry.usage?.trim(), `${entry.id} requires a working usage snippet`).toBeTruthy();
  }
  expect(compoundIds).toEqual(expect.arrayContaining(['select', 'dialog', 'menu', 'sidebar']));
});
