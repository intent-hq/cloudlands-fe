// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalComponentManifest } from '../src/lib/components/ui/manifest';
import { uiComponentGuardrails } from './ui-component-guardrails';
import { buildUiComponentInventory } from './ui-component-inventory';
import {
  buildUiInternalImportLedger,
  buildUiMigrationLedger,
  countRawUiControls,
  structuralGuardrailFailures,
  validateMigrationReplacement,
} from './ui-component-manifest';

const root = process.cwd();
const canonicalImports = [
  'badge',
  'breadcrumb',
  'button',
  'button-group',
  'card',
  'checkbox',
  'combobox',
  'dialog',
  'file-input',
  'indicators',
  'input',
  'label',
  'list',
  'menu',
  'scroll-area',
  'select',
  'separator',
  'settings-field-row',
  'settings-page-shell',
  'settings-section',
  'sheet',
  'sidebar',
  'skeleton',
  'slider',
  'switch',
  'textarea',
  'toggle',
  'toggle-group',
  'tooltip',
] as const;

describe('Gate C public component contract', () => {
  it('publishes a discoverability API while preserving canonical subpaths', () => {
    const rootApi = readFileSync(path.join(root, 'src/lib/components/ui/index.ts'), 'utf8');
    for (const publicImport of canonicalImports) {
      expect(rootApi, publicImport).toContain(`from './${publicImport}'`);
      expect(existsSync(path.join(root, `src/lib/components/ui/${publicImport}/index.ts`))).toBe(
        true,
      );
    }
    expect(rootApi).toContain("from './manifest'");
  });

  it('keeps catalog fixtures out of runtime component barrels', () => {
    for (const publicImport of canonicalImports) {
      const barrel = readFileSync(
        path.join(root, `src/lib/components/ui/${publicImport}/index.ts`),
        'utf8',
      );
      expect(barrel, publicImport).not.toMatch(/export\s+\{[^}]*Fixtures[^}]*\}\s+from/);
    }
  });

  it('aggregates schema-validated source metadata with fixtures and verification owners', () => {
    expect(canonicalComponentManifest.map(({ publicImport }) => publicImport)).toEqual(
      canonicalImports.map((component) => `$lib/components/ui/${component}`).sort(),
    );
    for (const component of canonicalComponentManifest) {
      expect(component.fixtures.length, component.publicImport).toBeGreaterThan(0);
      expect(component.characterizationTest, component.publicImport).toBeTruthy();
      expect(component.owner, component.publicImport).toBeTruthy();
      expect(existsSync(path.join(root, component.source)), component.source).toBe(true);
    }
  });
});

describe('Gate C generated migration ledger', () => {
  it('derives every deprecated entry and validates imports or ledger references', () => {
    const inventory = buildUiComponentInventory();
    const ledger = buildUiMigrationLedger(root);
    expect(ledger.map(({ oldImport }) => oldImport)).toEqual(
      inventory.components
        .filter(({ category }) => category === 'deprecated-wrapper')
        .map(({ publicImport }) => publicImport)
        .sort(),
    );
    for (const entry of ledger) {
      expect(
        validateMigrationReplacement(entry.replacement, inventory, root),
        entry.oldImport,
      ).toBe(null);
      expect(entry.characterizationTest, entry.oldImport).toBeTruthy();
      expect(entry.owner, entry.oldImport).toBeTruthy();
      expect(entry.removalGate, entry.oldImport).toMatch(/zero|migrate|callers/i);
    }

    expect(
      ledger.find(({ oldImport }) => oldImport.endsWith('dropdown-menu.svelte'))?.callers,
    ).toHaveLength(17);
    expect(ledger.find(({ oldImport }) => oldImport.endsWith('/dropdown'))).toMatchObject({
      replacement: 'ledger:src/lib/components/ui/dropdown/dropdown-caller-ledger.ts',
      callers: expect.arrayContaining(['src/lib/components/settings/mcp/McpServerCard.svelte']),
    });
    expect(buildUiMigrationLedger(root)).toEqual(ledger);
  });

  it('removes reconciled B7/B8 shims while retaining measured B5/B6 adapters', () => {
    const inventory = buildUiComponentInventory();
    const publicImports = inventory.components.map(({ publicImport }) => publicImport);
    const reconciledImports = [
      '$lib/components/ui/FileActionsDropdown.svelte',
      '$lib/components/ui/OpenComboButton.svelte',
      '$lib/components/ui/ProviderIcon.svelte',
      '$lib/components/ui/ViewSettingsDropdown.svelte',
      '$lib/components/ui/WorkspaceActionsMenu.svelte',
      '$lib/components/ui/agent-avatar/AgentAvatar.svelte',
      '$lib/components/ui/agent-avatar/AgentAvatarWithState.svelte',
      '$lib/components/ui/agent-avatar/avatar-state',
      '$lib/components/ui/content-header',
      '$lib/components/ui/diff',
      '$lib/components/ui/tab',
    ];
    expect(publicImports).not.toEqual(expect.arrayContaining(reconciledImports));
    expect(existsSync(path.join(root, 'src/lib/components/icons/ProviderIcon.svelte'))).toBe(false);

    const retained = new Map(
      buildUiMigrationLedger(root).map((entry) => [entry.oldImport, entry.callers.length]),
    );
    expect(retained.get('$lib/components/ui/dropdown-menu.svelte')).toBe(17);
    expect(retained.get('$lib/components/ui/dropdown')).toBe(7);
    expect(retained.get('$lib/components/ui/grouped-combobox')).toBe(1);
    expect(retained.get('$lib/components/ui/searchable-combobox')).toBe(1);
    expect(retained.get('$lib/components/ui/searchable-select')).toBe(1);
  });
});

describe('Gate C structural ratchets', () => {
  it('rejects repository-relative internal imports with canonical repair guidance', () => {
    const syntheticRoot = mkdtempSync(path.join(os.tmpdir(), 'ui-component-guardrail-'));
    try {
      const buttonRoot = path.join(syntheticRoot, 'src/lib/components/ui/button');
      mkdirSync(buttonRoot, { recursive: true });
      mkdirSync(path.join(syntheticRoot, 'src/features/example'), { recursive: true });
      writeFileSync(
        path.join(buttonRoot, 'index.ts'),
        "export { default as Button } from './button.svelte';\n",
      );
      writeFileSync(path.join(buttonRoot, 'button.svelte'), '<button>Button</button>\n');
      writeFileSync(
        path.join(syntheticRoot, 'src/features/example/Example.svelte'),
        "<script>import Button from 'src/lib/components/ui/button/button.svelte';</script>\n<Button />\n",
      );

      expect(structuralGuardrailFailures(syntheticRoot)).toContain(
        'src/lib/components/ui/button/button.svelte: internal UI import has 1 callers (ceiling=0); use $lib/components/ui/button; catalog=/sandbox/button',
      );
    } finally {
      rmSync(syntheticRoot, { recursive: true, force: true });
    }
  });

  it('keeps every internal-file bypass in an exact, source-derived migration ledger', () => {
    const ledger = buildUiInternalImportLedger(root);
    expect(
      ledger.some(({ oldImport }) => oldImport === '$lib/components/ui/button/button.svelte'),
    ).toBe(true);
    for (const entry of ledger) {
      const ceiling = uiComponentGuardrails.internalImports[entry.oldImport];
      expect(ceiling, `${entry.oldImport} is not registered`).toBeDefined();
      expect(entry.callers.length + entry.dynamicCallers.length, entry.oldImport).toBe(ceiling);
      expect(entry.callers.length + entry.dynamicCallers.length, entry.oldImport).toBeGreaterThan(
        0,
      );
      expect(entry.canonicalImport, entry.oldImport).toMatch(/^\$lib\/components\/ui\//);
      expect(entry.catalogEntry, entry.oldImport).toMatch(/^\/sandbox\//);
    }
    expect(Object.keys(uiComponentGuardrails.internalImports).sort()).toEqual(
      ledger.map(({ oldImport }) => oldImport).sort(),
    );
  });

  it('ratchets raw controls outside approved primitive implementations', () => {
    const counts = countRawUiControls(root);
    expect(counts).toEqual(uiComponentGuardrails.rawControls);
    expect(Object.keys(counts)).toEqual(['button', 'input', 'select', 'textarea']);
  });
});
