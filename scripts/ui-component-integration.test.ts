// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalComponentManifest } from '../src/lib/components/ui/manifest';
import { uiComponentGuardrails } from './ui-component-guardrails';
import { buildUiComponentInventory } from './ui-component-inventory';
import {
  binaryControlGuardrailFailures,
  buildBinaryControlLedger,
  buildCheckboxControlLedger,
  buildProductToggleLedger,
  buildUiInternalImportLedger,
  buildUiMigrationLedger,
  checkboxControlGuardrailFailures,
  countRawUiControls,
  productToggleGuardrailFailures,
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
      '$lib/components/ui/grouped-combobox',
      '$lib/components/ui/searchable-combobox',
      '$lib/components/ui/searchable-select',
    ];
    expect(publicImports).not.toEqual(expect.arrayContaining(reconciledImports));
    expect(existsSync(path.join(root, 'src/lib/components/icons/ProviderIcon.svelte'))).toBe(false);

    const retained = new Map(
      buildUiMigrationLedger(root).map((entry) => [entry.oldImport, entry.callers.length]),
    );
    expect(retained.get('$lib/components/ui/dropdown-menu.svelte')).toBe(17);
    expect(retained.get('$lib/components/ui/dropdown')).toBe(7);
  });
});

describe('Gate C structural ratchets', () => {
  it('keeps binary-control and menu caller metadata aligned with source imports', () => {
    const inventory = buildUiComponentInventory();
    for (const id of ['checkbox', 'switch', 'toggle', 'menu']) {
      const metadata = canonicalComponentManifest.find((component) => component.id === id);
      const derived = inventory.components.find((component) => component.id === id);
      expect(metadata?.callers, id).toEqual(derived?.callers);
    }
  });

  it('rejects native and custom-role product checkboxes outside reviewed contexts', () => {
    const syntheticRoot = mkdtempSync(path.join(os.tmpdir(), 'checkbox-control-guardrail-'));
    try {
      const productRoot = path.join(syntheticRoot, 'src/features/example');
      mkdirSync(productRoot, { recursive: true });
      writeFileSync(
        path.join(productRoot, 'Example.svelte'),
        `<input type="checkbox" />\n<div role="checkbox"></div>\n<button role={'menuitemcheckbox'}></button>\n`,
      );

      expect(checkboxControlGuardrailFailures(syntheticRoot)).toEqual([
        'src/features/example/Example.svelte:1: native-input bypasses the checkbox design-system boundary; use $lib/components/ui/toggle Toggle or add a reviewed contextual exemption',
        'src/features/example/Example.svelte:2: checkbox-role bypasses the checkbox design-system boundary; use $lib/components/ui/toggle Toggle or add a reviewed contextual exemption',
        'src/features/example/Example.svelte:3: menuitemcheckbox-role bypasses the checkbox design-system boundary; use $lib/components/ui/menu Menu.CheckboxItem or add a reviewed contextual exemption',
      ]);
    } finally {
      rmSync(syntheticRoot, { recursive: true, force: true });
    }
  });

  it('rejects product Checkbox/Switch imports and removed Toggle binary modes', () => {
    const syntheticRoot = mkdtempSync(path.join(os.tmpdir(), 'binary-control-guardrail-'));
    try {
      const productRoot = path.join(syntheticRoot, 'src/features/example');
      mkdirSync(productRoot, { recursive: true });
      writeFileSync(
        path.join(productRoot, 'Example.svelte'),
        `<script>\nimport { Checkbox } from '$lib/components/ui/checkbox';\nimport { Switch } from '$lib/components/ui/switch';\nimport { Toggle } from '$lib/components/ui/toggle';\n</script>\n<Checkbox />\n<Switch />\n<Toggle variant="switch" />\n<Toggle variant={'indicator'} />\n<Toggle size="sm">Inline label</Toggle>\n<Toggle size="xs" ariaLabel="Literal label" />\n<Toggle size="xs" ariaLabel={'Literal expression'} />\n<Toggle size="xs" ariaLabel={m.example()} />\n`,
      );

      expect(binaryControlGuardrailFailures(syntheticRoot)).toEqual([
        'src/features/example/Example.svelte:2: imports Checkbox outside the approved TipTap task-checkbox and test/catalog contexts; use $lib/components/ui/toggle Toggle',
        'src/features/example/Example.svelte:3: imports Switch outside test/catalog characterization; use $lib/components/ui/toggle Toggle',
        'src/features/example/Example.svelte:8: uses removed Toggle switch compatibility mode; use the default compact Toggle',
        'src/features/example/Example.svelte:9: uses removed Toggle indicator compatibility mode; use the default compact Toggle',
      ]);
      expect(productToggleGuardrailFailures(syntheticRoot)).toEqual([
        'src/features/example/Example.svelte:8: product Toggle violates the compact binary-control contract (set size="xs"; provide a localized/source-derived ariaLabel expression; use the default variant without an explicit variant prop)',
        'src/features/example/Example.svelte:9: product Toggle violates the compact binary-control contract (set size="xs"; provide a localized/source-derived ariaLabel expression; use the default variant without an explicit variant prop)',
        'src/features/example/Example.svelte:10: product Toggle violates the compact binary-control contract (render no inline content and keep the visible label external; set size="xs"; provide a localized/source-derived ariaLabel expression)',
        'src/features/example/Example.svelte:11: product Toggle violates the compact binary-control contract (replace the literal ariaLabel with a localized/source-derived expression)',
        'src/features/example/Example.svelte:12: product Toggle violates the compact binary-control contract (replace the literal ariaLabel with a localized/source-derived expression)',
      ]);
    } finally {
      rmSync(syntheticRoot, { recursive: true, force: true });
    }
  });

  it('tracks aliased Toggle imports and rejects expression-valued variants', () => {
    const syntheticRoot = mkdtempSync(path.join(os.tmpdir(), 'aliased-toggle-guardrail-'));
    try {
      const productRoot = path.join(syntheticRoot, 'src/features/example');
      mkdirSync(productRoot, { recursive: true });
      writeFileSync(
        path.join(productRoot, 'Example.svelte'),
        `<script>
import { Toggle as AliasedToggle } from '$lib/components/ui/toggle';
import DirectToggle from '$lib/components/ui/toggle/toggle.svelte';
const dynamicVariant = 'group';
</script>
<AliasedToggle size="xs" ariaLabel={m.valid()} />
<AliasedToggle size="xs" ariaLabel={m.dynamic()} variant={dynamicVariant} />
<DirectToggle size="xs" ariaLabel={m.direct()} variant={undefined} />
`,
      );

      expect(buildProductToggleLedger(syntheticRoot)).toMatchObject([
        { line: 6, hasVariant: false, variant: null },
        { line: 7, hasVariant: true, variant: null },
        { line: 8, hasVariant: true, variant: null },
      ]);
      expect(productToggleGuardrailFailures(syntheticRoot)).toEqual([
        'src/features/example/Example.svelte:7: product Toggle violates the compact binary-control contract (use the default variant without an explicit variant prop)',
        'src/features/example/Example.svelte:8: product Toggle violates the compact binary-control contract (use the default variant without an explicit variant prop)',
      ]);
    } finally {
      rmSync(syntheticRoot, { recursive: true, force: true });
    }
  });

  it('records only explicit semantic and test/catalog binary-control exemptions', () => {
    const syntheticRoot = mkdtempSync(path.join(os.tmpdir(), 'binary-control-exemptions-'));
    try {
      const files = new Map([
        [
          'src/lib/components/tiptap/TaskItemNodeView.svelte',
          `<script>import { Checkbox } from '$lib/components/ui/checkbox';</script>\n<Checkbox />\n`,
        ],
        [
          'src/lib/component-catalog/Controls.svelte',
          `<script>import { Switch } from '$lib/components/ui/switch';</script>\n<Switch />\n`,
        ],
        [
          'src/lib/components/example/__tests__/BinaryHarness.svelte',
          `<script>import { Switch } from '$lib/components/ui/switch';</script>\n<Toggle variant="switch" />\n`,
        ],
      ]);
      for (const [file, source] of files) {
        const target = path.join(syntheticRoot, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, source);
      }

      const ledger = buildBinaryControlLedger(syntheticRoot);
      expect(ledger).toHaveLength(4);
      expect(ledger.every(({ exemption }) => exemption !== null)).toBe(true);
      expect(binaryControlGuardrailFailures(syntheticRoot)).toEqual([]);
      expect(buildProductToggleLedger(syntheticRoot).every(({ exemption }) => exemption)).toBe(
        true,
      );
      expect(productToggleGuardrailFailures(syntheticRoot)).toEqual([]);
    } finally {
      rmSync(syntheticRoot, { recursive: true, force: true });
    }
  });

  it('records approved sandbox, task-list, and test/catalog contexts without violations', () => {
    const syntheticRoot = mkdtempSync(path.join(os.tmpdir(), 'checkbox-control-exemptions-'));
    try {
      const files = [
        'src/lib/components/markdown/MarkdownViewer.svelte',
        'src/lib/components/tiptap/TaskItemNodeView.svelte',
        'src/routes/sandbox/example/+page.svelte',
        'src/lib/component-catalog/CheckboxPreview.svelte',
        'src/lib/components/example/__tests__/CheckboxHarness.svelte',
      ];
      for (const file of files) {
        const target = path.join(syntheticRoot, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, '<input type="checkbox" />\n');
      }

      const ledger = buildCheckboxControlLedger(syntheticRoot);
      expect(ledger.map(({ file }) => file)).toEqual(files.sort());
      expect(ledger.every(({ exemption }) => exemption !== null)).toBe(true);
      expect(checkboxControlGuardrailFailures(syntheticRoot)).toEqual([]);
    } finally {
      rmSync(syntheticRoot, { recursive: true, force: true });
    }
  });

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
    for (const tag of ['button', 'input', 'select', 'textarea'] as const) {
      expect(counts[tag], tag).toBeLessThanOrEqual(uiComponentGuardrails.rawControls[tag]);
    }
  });
});
