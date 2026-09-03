import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseUiComponentInventory,
  parseUiComponentMetadata,
} from '../src/lib/components/ui/component-metadata';
import { runUiComponentAudit } from './ui-component-audit';
import { buildUiComponentInventory } from './ui-component-inventory';

const auditScript = path.resolve(process.cwd(), 'scripts/ui-component-audit.ts');

function audit(mode: string): string {
  const result = runUiComponentAudit(mode);
  expect(result).toMatchObject({ exitCode: 0, stderr: '' });
  return result.stdout.trim();
}

describe('UI component metadata schema', () => {
  it('validates representative canonical and deprecated records', () => {
    expect(() =>
      parseUiComponentMetadata({
        id: 'button',
        source: 'src/lib/components/ui/button/button.svelte',
        publicImport: '$lib/components/ui/button',
        exports: ['Button'],
        category: 'primitive',
        owner: '007-B1',
        callers: ['src/routes/+page.svelte'],
        replacement: null,
        characterizationTest: 'src/lib/components/ui/button/button.test.ts',
        removalGate: 'Canonical behavior and accessibility tests pass.',
        dynamicImports: [],
        fixtures: [{ id: 'default', title: 'Default', states: ['default'] }],
      }),
    ).not.toThrow();

    expect(() =>
      parseUiComponentMetadata({
        id: 'legacy-dropdown',
        source: 'src/lib/components/ui/dropdown/Dropdown.svelte',
        publicImport: '$lib/components/ui/dropdown',
        exports: ['Dropdown'],
        category: 'deprecated-wrapper',
        owner: '007-B6',
        callers: ['src/lib/components/settings/mcp/McpServerCard.svelte'],
        replacement: '$lib/components/ui/select',
        characterizationTest: 'src/lib/components/ui/dropdown/Dropdown.test.ts',
        removalGate: 'All callers migrate and the import audit reaches zero.',
        dynamicImports: [],
        fixtures: [],
      }),
    ).not.toThrow();
  });

  it('names the repair path for invalid deprecated records', () => {
    expect(() =>
      parseUiComponentMetadata({
        id: 'legacy',
        source: 'src/lib/components/ui/legacy.svelte',
        publicImport: '$lib/components/ui/legacy.svelte',
        exports: ['default'],
        category: 'deprecated-wrapper',
        owner: '007-B5',
        callers: [],
        replacement: null,
        characterizationTest: null,
        removalGate: '',
        dynamicImports: [],
        fixtures: [],
      }),
    ).toThrow(/legacy.*replacement.*characterizationTest.*removalGate/s);
  });
});

describe('UI component inventory gate', () => {
  it('validates the checked-in inventory and its folder template', () => {
    const inventory = buildUiComponentInventory();
    expect(() => parseUiComponentInventory(inventory)).not.toThrow();
    expect(inventory.folderTemplate).toEqual(
      expect.objectContaining({
        implementation: expect.any(String),
        publicModule: expect.any(String),
        metadata: expect.any(String),
        behavioralTest: expect.any(String),
        fixture: expect.any(String),
      }),
    );
  });

  it('keeps Select canonical and distinct from searchable Combobox behavior', () => {
    const select = buildUiComponentInventory().components.find(
      (component) => component.publicImport === '$lib/components/ui/select',
    );
    expect(select).toMatchObject({
      category: 'primitive',
      owner: '007-B6',
      replacement: null,
    });
    expect(select?.replacement).not.toBe('$lib/components/ui/combobox');
  });

  it('keeps Dialog and Menu in their canonical primitive lanes', () => {
    const components = buildUiComponentInventory().components;
    expect(
      components.find((component) => component.publicImport === '$lib/components/ui/dialog'),
    ).toMatchObject({ category: 'primitive', owner: '007-B4', replacement: null });
    expect(
      components.find((component) => component.publicImport === '$lib/components/ui/menu'),
    ).toMatchObject({ category: 'primitive', owner: '007-B5', replacement: null });
  });

  it('resolves relative callers with deterministic component counts', () => {
    const components = buildUiComponentInventory().components;
    const toggleGroup = components.find(
      (component) => component.publicImport === '$lib/components/ui/toggle-group',
    );
    const dropdownMenu = components.find(
      (component) => component.publicImport === '$lib/components/ui/dropdown-menu.svelte',
    );

    expect(toggleGroup?.callers).toEqual([
      'src/features/layout/tab-types/AgentViewSettingsDropdown.svelte',
      'src/features/layout/tab-types/NoteViewSettingsDropdown.svelte',
      'src/lib/component-catalog/CatalogControls.svelte',
      'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
      'src/lib/components/settings/ColorThemeSettings.svelte',
    ]);
    expect(dropdownMenu?.callers).toHaveLength(17);
    expect(dropdownMenu?.callers).toContain('src/lib/components/chat/RegularAgentWelcome.svelte');
    expect(buildUiComponentInventory().components).toEqual(components);
  });

  it('is exhaustive, deterministic, and actionable', () => {
    expect(audit('check')).toMatch(/^UI component audit passed;/);
    expect(audit('inventory')).toBe(audit('inventory'));
    expect(audit('inventory').split('\n')).toEqual([...audit('inventory').split('\n')].sort());
  });

  it('publishes the audited Toggle-only binary-control boundary', () => {
    const binaryControls = JSON.parse(audit('binary-controls')) as Array<{
      kind: string;
      exemption: string | null;
    }>;
    const checkboxControls = JSON.parse(audit('checkbox-controls')) as Array<{
      exemption: string | null;
    }>;
    const productToggles = JSON.parse(audit('product-toggle-controls')) as Array<{
      selfClosing: boolean;
      size: string | null;
      hasAriaLabel: boolean;
      hasSourceDerivedAriaLabel: boolean;
      hasVariant: boolean;
      variant: string | null;
      exemption: string | null;
    }>;

    expect(binaryControls).toHaveLength(14);
    expect(binaryControls.filter(({ kind }) => kind === 'checkbox-import')).toHaveLength(7);
    expect(binaryControls.filter(({ kind }) => kind === 'switch-import')).toHaveLength(7);
    expect(binaryControls.filter(({ kind }) => kind.startsWith('toggle-'))).toEqual([]);
    expect(binaryControls.every(({ exemption }) => exemption !== null)).toBe(true);
    expect(checkboxControls).toHaveLength(5);
    expect(checkboxControls.every(({ exemption }) => exemption !== null)).toBe(true);
    expect(productToggles).toHaveLength(62);
    expect(productToggles.filter(({ exemption }) => exemption === null)).toHaveLength(55);
    expect(
      productToggles
        .filter(({ exemption }) => exemption === null)
        .every(
          ({ selfClosing, size, hasAriaLabel, hasSourceDerivedAriaLabel, hasVariant, variant }) =>
            selfClosing &&
            size === 'xs' &&
            hasAriaLabel &&
            hasSourceDerivedAriaLabel &&
            !hasVariant &&
            variant === null,
        ),
    ).toBe(true);
  });

  it('removes zero-reference tabs from inventory without unresolved imports', () => {
    const legacyTabs = ['$lib/components/ui/tabs', '$lib/components/ui/TabBar.svelte'];
    const publicImports = buildUiComponentInventory().components.map(
      (component) => component.publicImport,
    );
    const dynamicOutput = audit('dynamic');

    expect(publicImports).not.toEqual(expect.arrayContaining(legacyTabs));
    for (const publicImport of legacyTabs) {
      expect(dynamicOutput).not.toContain(publicImport);
    }
    expect(audit('check')).toMatch(/^UI component audit passed;/);
  });

  it('publishes dependency boundaries with repair imports', () => {
    const output = audit('boundaries');
    expect(output).toContain('primitive');
    expect(output).toContain('forbidden=$features/,$store/,electron');
    expect(output).toContain('repair=$lib/components/ui/<component>');
  });

  it('enforces actionable primitive, pattern, and product boundaries through the CLI', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ui-component-audit-'));
    try {
      const files = {
        'src/lib/components/ui/button/index.ts': "export const Button = 'button';",
        'src/lib/components/ui/button/button.svelte':
          "<script>import '$store/renderer/state';</script>",
        'src/lib/components/ui/list/index.ts': "export const List = 'list';",
        'src/lib/components/ui/list/list.svelte': "<script>import 'electron';</script>",
        'src/lib/components/ui/ProductCard.svelte':
          "<script>import '$store/renderer/state'; import '$features/workspace/state'; import '$features/workspace/main/service';</script>",
      };
      for (const [file, source] of Object.entries(files)) {
        const target = path.join(directory, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, source);
      }

      const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
      const result = spawnSync(process.execPath, [tsxCli, auditScript, 'check'], {
        encoding: 'utf8',
        env: { ...process.env, UI_COMPONENT_AUDIT_ROOT: directory },
        timeout: 120_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'button/button.svelte: primitive imports $store/; repair=$lib/components/ui/<component>',
      );
      expect(result.stderr).toContain(
        'list/list.svelte: pattern imports electron; repair=$lib/components/ui/<primitive>',
      );
      expect(result.stderr).toContain(
        'ProductCard.svelte: product imports $features/*/main/; repair=$features/<owner>/components/<component>',
      );
      expect(result.stderr).not.toContain('product imports $store/');
      expect(result.stderr).not.toContain('product imports $features/;');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
