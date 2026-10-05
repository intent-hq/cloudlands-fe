// @vitest-environment node
// @ui-invariant
// Inspect public exports without evaluating browser-only component initialization.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { warmImport } from '../../../test/warm-import';
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

warmImport(async () => {
  await Promise.all(
    canonicalComponentManifest.map((entry) => publicModules[`./${entry.id}/index.ts`]?.()),
  );
});

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

// Every flat `ui/*.svelte` is either the `source` of a manifest entry (so the
// catalog contract runs axe over its fixtures) or opts out with a leading
// `<!-- @catalog-exempt: <reason> -->`. PrincipalAvatar shipped an unnamed
// tooltip trigger (#2803) because nothing required either.
const UI_DIR = 'src/lib/components/ui';
const CATALOG_EXEMPT_MARKER = '@catalog-exempt:';
const CATALOG_SUPPORT_FILE = /(?:\.preview|Harness|Consumer)\.svelte$/;

type CatalogExemption = { kind: 'exempt'; reason: string } | { kind: null };

function readLeadingHtmlComments(content: string): string[] {
  const comments: string[] = [];
  let rest = content.replace(/^\uFEFF/, '').trimStart();
  while (rest.startsWith('<!--')) {
    const end = rest.indexOf('-->');
    if (end === -1) break;
    comments.push(rest.slice(4, end));
    rest = rest.slice(end + 3).trimStart();
  }
  return comments;
}

function readCatalogExemption(content: string): CatalogExemption {
  for (const comment of readLeadingHtmlComments(content)) {
    const marker = comment.indexOf(CATALOG_EXEMPT_MARKER);
    if (marker !== -1) {
      return {
        kind: 'exempt',
        reason: comment.slice(marker + CATALOG_EXEMPT_MARKER.length).trim(),
      };
    }
  }
  return { kind: null };
}

function listFlatUiComponents(root = process.cwd()): string[] {
  return readdirSync(path.join(root, UI_DIR), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith('.svelte') && !CATALOG_SUPPORT_FILE.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

describe('catalog coverage for flat ui components', () => {
  it.each([
    [
      '<!-- @catalog-exempt: context provider -->\n<script>',
      { kind: 'exempt', reason: 'context provider' },
    ],
    [
      '\n  <!-- lead -->\n<!--\n  @catalog-exempt: harness\n-->\n<div />',
      { kind: 'exempt', reason: 'harness' },
    ],
    ['<!-- @catalog-exempt: -->\n<script>', { kind: 'exempt', reason: '' }],
    [
      '<script>\n// @catalog-exempt: too late\n</script>\n<!-- @catalog-exempt: too late -->',
      { kind: null },
    ],
    ['<script>', { kind: null }],
  ])('reads the exemption only from leading HTML comments: %j', (content, expected) => {
    expect(readCatalogExemption(content)).toEqual(expected);
  });

  it('requires a manifest entry or an explicit @catalog-exempt reason for every flat ui/*.svelte', () => {
    const manifestSources = new Set(canonicalComponentManifest.map((entry) => entry.source));
    const components = listFlatUiComponents();
    expect(components).toContain('PrincipalAvatar.svelte');
    expect(components).not.toContain('SurfaceContextHarness.svelte');

    const violations: string[] = [];
    for (const name of components) {
      const source = `${UI_DIR}/${name}`;
      if (manifestSources.has(source)) continue;
      const exemption = readCatalogExemption(
        readFileSync(path.join(process.cwd(), source), 'utf8'),
      );
      if (exemption.kind === 'exempt' && exemption.reason) continue;
      violations.push(
        exemption.kind === 'exempt'
          ? `${source}: \`${CATALOG_EXEMPT_MARKER}\` requires a reason`
          : `${source}: not the source of any entry in ui/manifest.ts; add a *.meta.ts with fixtures so the catalog contract covers it, or open the file with \`<!-- ${CATALOG_EXEMPT_MARKER} <reason> -->\``,
      );
    }
    expect(violations).toEqual([]);
  });
});
