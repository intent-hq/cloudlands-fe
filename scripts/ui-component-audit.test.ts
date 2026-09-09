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

  it('classifies Kbd as a canonical design-system primitive', () => {
    expect(
      buildUiComponentInventory().components.find(
        (component) => component.publicImport === '$lib/components/ui/kbd',
      ),
    ).toMatchObject({
      source: 'src/lib/components/ui/kbd/index.ts',
      category: 'primitive',
      owner: 'design-system',
      replacement: null,
    });
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
      'src/lib/components/patterns/settings/custom-controls.ts',
      'src/routes/(app)/settings/+page.svelte',
    ]);
    expect(dropdownMenu?.callers).toHaveLength(16);
    expect(dropdownMenu?.callers).toContain('src/lib/components/chat/RegularAgentWelcome.svelte');
    expect(buildUiComponentInventory().components).toEqual(components);
  });

  it('is exhaustive, deterministic, and actionable', () => {
    expect(audit('check')).toMatch(/^UI component audit passed;/);
    expect(audit('inventory')).toBe(audit('inventory'));
    expect(audit('inventory').split('\n')).toEqual([...audit('inventory').split('\n')].sort());
  });

  it('reports raw-element files and occurrences against per-directory ceilings', () => {
    const report = JSON.parse(audit('raw-elements')) as {
      directories: Record<
        string,
        Record<string, { files: number; elements: number; ceiling: number }>
      >;
      failures: string[];
    };

    expect(Object.keys(report.directories)).toEqual(['src/features', 'src/lib', 'src/routes']);
    expect(report.failures).toEqual([]);
    for (const controls of Object.values(report.directories)) {
      for (const counts of Object.values(controls)) {
        expect(counts).toEqual({ files: 0, elements: 0, ceiling: 0 });
      }
    }
  });

  it('fails check when a raw-element file count exceeds its directory ceiling', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ui-component-raw-elements-'));
    try {
      const files = {
        'src/lib/components/ui/button/index.ts': "export const Button = 'button';",
        'src/lib/components/ui/button/button.svelte': '<button>primitive host</button>',
        'src/features/example/Controls.svelte': '<button>one</button><button>two</button><input />',
        'src/features/example/Attachment.svelte': '<input type="file" />',
        'scripts/ui-component-raw-element-allowlist.json': JSON.stringify({
          ceilings: {
            'src/features': { button: 0, input: 0, select: 0, textarea: 0 },
            'src/lib': { button: 0, input: 0, select: 0, textarea: 0 },
          },
          exceptions: [],
        }),
      };
      for (const [file, source] of Object.entries(files)) {
        const target = path.join(directory, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, source);
      }

      const report = runUiComponentAudit('raw-elements', directory);
      expect(report.exitCode).toBe(0);
      expect(JSON.parse(report.stdout).directories['src/features']).toMatchObject({
        button: { files: 1, elements: 2, ceiling: 0 },
        input: { files: 2, elements: 2, ceiling: 0 },
      });

      const result = runUiComponentAudit('check', directory);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('src/features: raw <button> files 1 exceed ceiling 0');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('publishes canonical tabs while keeping the deleted TabBar out of inventory', () => {
    const publicImports = buildUiComponentInventory().components.map(
      (component) => component.publicImport,
    );
    const dynamicOutput = audit('dynamic');

    expect(publicImports).toContain('$lib/components/ui/tabs');
    expect(publicImports).not.toContain('$lib/components/ui/TabBar.svelte');
    expect(dynamicOutput).not.toContain('$lib/components/ui/tabs');
    expect(dynamicOutput).not.toContain('$lib/components/ui/TabBar.svelte');
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
