// @vitest-environment node
// @ui-invariant
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UI_INVARIANT_EXEMPT_MARKER,
  UI_INVARIANT_MARKER,
  inspectUiInvariantSuites,
  listUiInvariantSuites,
  readHeaderMarker,
  requiresUiInvariantMarker,
} from './ui-invariant-suites.mjs';

const inventoryConsumer = [
  "import { describe, it } from 'vitest';",
  "import { buildUiComponentInventory } from '../../scripts/ui-component-inventory';",
  'it("x", () => buildUiComponentInventory());',
].join('\n');
const ledgerConsumer = [
  "import { fooMetadata } from './foo.meta';",
  'it("x", () => expect(fooMetadata.callers).toHaveLength(2));',
].join('\n');

describe('ui invariant suite markers', () => {
  it('reads the gate marker from leading line or block comments only', () => {
    expect(readHeaderMarker(`// ${UI_INVARIANT_MARKER}\nimport x from 'y';`)).toEqual({
      kind: 'gate',
    });
    expect(
      readHeaderMarker(`// @vitest-environment node\n// ${UI_INVARIANT_MARKER}\nimport x;`),
    ).toEqual({ kind: 'gate' });
    expect(
      readHeaderMarker(
        `/**\n * @vitest-environment jsdom\n * ${UI_INVARIANT_MARKER}\n */\nimport x;`,
      ),
    ).toEqual({ kind: 'gate' });
    expect(readHeaderMarker(`import x from 'y';\n// ${UI_INVARIANT_MARKER}`)).toEqual({
      kind: null,
    });
    expect(readHeaderMarker(`// ${UI_INVARIANT_MARKER}s are documented elsewhere`)).toEqual({
      kind: null,
    });
  });

  it('reads the exemption marker with its reason', () => {
    expect(readHeaderMarker(`// ${UI_INVARIANT_EXEMPT_MARKER} ledger only\nimport x;`)).toEqual({
      kind: 'exempt',
      reason: 'ledger only',
    });
    expect(readHeaderMarker(`/* ${UI_INVARIANT_EXEMPT_MARKER} ledger only */\nimport x;`)).toEqual({
      kind: 'exempt',
      reason: 'ledger only',
    });
    expect(readHeaderMarker(`// ${UI_INVARIANT_EXEMPT_MARKER}\nimport x;`)).toEqual({
      kind: 'exempt',
      reason: '',
    });
  });

  it('requires a marker for inventory consumers and *.meta caller ledger assertions', () => {
    expect(requiresUiInvariantMarker(inventoryConsumer)).toBe(true);
    expect(requiresUiInvariantMarker(ledgerConsumer)).toBe(true);
    expect(
      requiresUiInvariantMarker("import { fooMetadata } from './foo.meta';\nexpect(fooMetadata);"),
    ).toBe(false);
    expect(
      requiresUiInvariantMarker("readFileSync(new URL('x', import.meta.url));\nconst callers = 1;"),
    ).toBe(false);
    expect(requiresUiInvariantMarker("import { render } from '@testing-library/svelte';")).toBe(
      false,
    );
  });

  it('names the file and both accepted markers when a qualifying suite is unmarked', () => {
    const result = inspectUiInvariantSuites([
      { path: 'src/lib/components/ui/foo/foo-callers.test.ts', content: ledgerConsumer },
      { path: 'src/lib/components/ui/bar/bar.test.ts', content: inventoryConsumer },
      { path: 'src/lib/components/ui/baz/baz.test.ts', content: "import { render } from 'x';" },
    ]);
    expect(result.suites).toEqual([]);
    expect(result.violations).toHaveLength(2);
    for (const [file, violation] of [
      ['src/lib/components/ui/bar/bar.test.ts', result.violations[0]],
      ['src/lib/components/ui/foo/foo-callers.test.ts', result.violations[1]],
    ]) {
      expect(violation).toContain(file);
      expect(violation).toContain(`// ${UI_INVARIANT_MARKER}`);
      expect(violation).toContain(`// ${UI_INVARIANT_EXEMPT_MARKER} <reason>`);
    }
  });

  it('admits marked suites, records reasoned exemptions, and rejects bare exemptions', () => {
    const result = inspectUiInvariantSuites([
      { path: 'z/marked.test.ts', content: `// ${UI_INVARIANT_MARKER}\n${ledgerConsumer}` },
      { path: 'a/unrelated-marked.test.ts', content: `// ${UI_INVARIANT_MARKER}\nimport x;` },
      {
        path: 'm/exempt.test.ts',
        content: `// ${UI_INVARIANT_EXEMPT_MARKER} related covers it\n${ledgerConsumer}`,
      },
      { path: 'n/bare.test.ts', content: `// ${UI_INVARIANT_EXEMPT_MARKER}\n${ledgerConsumer}` },
    ]);
    expect(result.suites).toEqual(['a/unrelated-marked.test.ts', 'z/marked.test.ts']);
    expect(result.exempt).toEqual([{ path: 'm/exempt.test.ts', reason: 'related covers it' }]);
    expect(result.violations).toEqual([
      `n/bare.test.ts: \`${UI_INVARIANT_EXEMPT_MARKER}\` requires a reason`,
    ]);
  });

  it('keeps the checked-in tree complete and the gate script marker-driven', () => {
    const result = listUiInvariantSuites(process.cwd());
    expect(result.violations).toEqual([]);
    expect(result.suites).toEqual(
      expect.arrayContaining([
        'scripts/design-token-audit.test.ts',
        'scripts/ui-component-audit.test.ts',
        'scripts/ui-component-integration.test.ts',
        'scripts/neutral-border-audit.test.ts',
        'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.test.ts',
        'src/lib/components/__tests__/disclosure-chevron-inventory.test.ts',
        'src/lib/components/ui/__tests__/ProductCompatibilityInventory.test.ts',
        'src/lib/components/ui/toggle/toggle-caller-regression.test.ts',
        'src/lib/components/ui/dropdown/Dropdown.test.ts',
      ]),
    );
    const scripts = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).scripts;
    expect(scripts['test:ui-invariants']).toBe('node scripts/ui-invariant-suites.mjs');
  });
});
