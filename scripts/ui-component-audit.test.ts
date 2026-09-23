// @ui-invariant
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
import {
  buildButtonBackgroundAudit,
  buildPatternAdoptionAudit,
  buildRawPrincipalAvatarAudit,
  legacyUiCallerFailures,
  runUiComponentAudit,
} from './ui-component-audit';
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
  it('rejects new static and dynamic legacy callers without blocking removal or canonical adoption', () => {
    const inventory = buildUiComponentInventory();
    const component = inventory.components.find(
      (entry) => entry.publicImport === '$lib/components/ui/dropdown-menu.svelte',
    )!;
    const metadata = parseUiComponentMetadata({
      ...component,
      publicImport: '$lib/components/ui/menu',
      category: 'primitive',
      legacyImports: [component.publicImport],
      callers: ['src/features/existing/Actions.svelte'],
      replacement: null,
    });
    const withCallers = (callers: string[], dynamicImports: string[] = []) => ({
      ...inventory,
      components: [{ ...component, callers, dynamicImports }],
    });

    expect(legacyUiCallerFailures(withCallers(metadata.callers), [metadata])).toEqual([]);
    expect(legacyUiCallerFailures(withCallers([]), [metadata])).toEqual([]);
    expect(
      legacyUiCallerFailures(
        withCallers(
          [...metadata.callers, 'src/features/new/Overflow.svelte'],
          ['src/features/new/Context.svelte'],
        ),
        [metadata],
      ),
    ).toEqual([
      expect.stringContaining('src/features/new/Context.svelte: new legacy caller'),
      expect.stringContaining('src/features/new/Overflow.svelte: new legacy caller'),
    ]);
    expect(legacyUiCallerFailures({ ...inventory, components: [] }, [metadata])).toEqual([]);
  });

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
      'src/lib/component-catalog/CatalogControls.svelte',
      'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
      'src/lib/components/patterns/settings/custom-controls.ts',
      'src/routes/(app)/settings/+page.svelte',
    ]);
    expect(dropdownMenu?.callers.length).toBeLessThanOrEqual(11);
    expect(dropdownMenu?.callers).toEqual([...new Set(dropdownMenu?.callers)].sort());
    // DiagramBlock migrated to DiagramActionsMenu's canonical Menu in d9229ea037.
    expect(dropdownMenu?.callers).not.toContain(
      'src/lib/components/notes/primitives/DiagramBlock.svelte',
    );
    expect(
      components.find((component) => component.publicImport === '$lib/components/ui/menu')?.callers,
    ).toContain('src/lib/components/diagrams/DiagramActionsMenu.svelte');
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

describe('Button background override guard', () => {
  // Minimal tree so `check` can build the inventory and raw-element policy for a temp root.
  const scaffold = {
    'src/lib/components/ui/button/index.ts': "export const Button = 'button';",
    'src/lib/components/ui/button/button.svelte': '<button>primitive host</button>',
    'scripts/ui-component-raw-element-allowlist.json': JSON.stringify({
      ceilings: {
        'src/features': { button: 0, input: 0, select: 0, textarea: 0 },
        'src/lib': { button: 0, input: 0, select: 0, textarea: 0 },
      },
      exceptions: [],
    }),
  };

  function withFixtures(files: Record<string, string>, run: (root: string) => void) {
    const root = mkdtempSync(path.join(tmpdir(), 'button-background-audit-'));
    try {
      for (const [file, source] of Object.entries({ ...scaffold, ...files })) {
        const target = path.join(root, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, source);
      }
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('fails a Button that sets an opaque bg-* class without a variant, naming file:line and the repair', () => {
    withFixtures(
      {
        'src/features/example/Accept.svelte': [
          '<div>',
          '  <Button class="bg-primary text-primary-foreground" onclick={() => count > 1 && accept()}>',
          '    Apply',
          '  </Button>',
          '  <Button',
          '    type="button"',
          '    class={cn("h-8", "bg-success text-success-foreground", extra)}',
          '  >',
          '    Open',
          '  </Button>',
          '  <Button class:bg-danger={armed}>Delete</Button>',
          '  <Button class={variant === "danger" ? "bg-danger" : "bg-primary"}>Apply</Button>',
          '  <Button class="bg-[#2563eb] text-white">Hex</Button>',
          '  <Button class="bg-[var(--brand)] bg-(--accent)">Variable</Button>',
          '  <Button class="{active ? "bg-primary" : "bg-danger"}">Quoted</Button>',
          "  <Button title={'Don\\'t'} class=\"bg-primary\">Escaped</Button>",
          '  <Button {...{ class: "bg-primary" }}>Spread</Button>',
          '  <Button {...{ class: "bg-muted" }} class="bg-primary">Overridden</Button>',
          '  {#if ready}<Button class={`bg-${tone} bg-primary`}>Nested</Button>{/if}',
          '</div>',
        ].join('\n'),
      },
      (root) => {
        const audit = buildButtonBackgroundAudit(root);
        expect(audit.findings).toEqual([
          { file: 'src/features/example/Accept.svelte', line: 2, classes: ['bg-primary'] },
          { file: 'src/features/example/Accept.svelte', line: 5, classes: ['bg-success'] },
          { file: 'src/features/example/Accept.svelte', line: 11, classes: ['bg-danger'] },
          {
            file: 'src/features/example/Accept.svelte',
            line: 12,
            classes: ['bg-danger', 'bg-primary'],
          },
          { file: 'src/features/example/Accept.svelte', line: 13, classes: ['bg-[#2563eb]'] },
          {
            file: 'src/features/example/Accept.svelte',
            line: 14,
            classes: ['bg-(--accent)', 'bg-[var(--brand)]'],
          },
          {
            file: 'src/features/example/Accept.svelte',
            line: 15,
            classes: ['bg-danger', 'bg-primary'],
          },
          { file: 'src/features/example/Accept.svelte', line: 16, classes: ['bg-primary'] },
          { file: 'src/features/example/Accept.svelte', line: 17, classes: ['bg-primary'] },
          { file: 'src/features/example/Accept.svelte', line: 18, classes: ['bg-primary'] },
          { file: 'src/features/example/Accept.svelte', line: 19, classes: ['bg-primary'] },
        ]);
        expect(audit.failures[0]).toMatch(
          /^src\/features\/example\/Accept\.svelte:2: <Button> without variant sets bg-primary; .*use variant="primary"/,
        );

        const result = runUiComponentAudit('check', root);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(
          'Accept.svelte:2: <Button> without variant sets bg-primary',
        );
        expect(result.stderr).toContain(
          'Accept.svelte:5: <Button> without variant sets bg-success',
        );
      },
    );
  });

  it('passes Buttons with a variant, translucent, state-prefixed, transparent, or non-colour bg-* classes', () => {
    withFixtures(
      {
        'src/features/example/Fine.svelte': [
          '<script lang="ts">',
          '  const example: string = \'<Button class="bg-primary">documented bad example</Button>\';',
          '</script>',
          '<!-- <Button class="bg-primary">commented-out call site</Button> -->',
          '<Button variant="primary" class="bg-primary text-primary-foreground">Apply</Button>',
          '<Button {variant} class="bg-danger">Delete</Button>',
          '<Button class="bg-success/10 text-success hover:bg-muted focus-visible:bg-accent dark:bg-muted">Soft</Button>',
          '<Button class="bg-transparent bg-cover bg-gradient-to-r bg-[url(/x.png)]">Ghost</Button>',
          '<Button class="bg-[length:200px_100px] bg-(image:--hero) bg-[linear-gradient(red,blue)] bg-[#2563eb]/40 bg-[var(--brand)]/[0.5]">Arbitrary</Button>',
          '<Button class={cn("px-2", active && "bg-muted/50")}>Toggle</Button>',
          '<Button class={cn("px-2")} title="bg-primary" data-tone={tone === "bg-danger"}>Plain</Button>',
          '<Button bind:variant class="bg-primary">Bound</Button>',
          '<Button {...{ variant: "primary" }} class="bg-primary">Spread variant</Button>',
          '<Button {...{ class: "bg-primary" }} variant="primary">Spread class</Button>',
          '<Button {...{ class: "bg-primary" }} class="px-2">Spread overridden</Button>',
          '<Button {...props} class="bg-primary">Runtime spread</Button>',
          '<Button {...{ ...props, class: "bg-primary" }}>Nested runtime spread</Button>',
          '<ButtonGroup class="bg-primary"><span class="bg-primary">not a Button</span></ButtonGroup>',
          '<style>',
          '  /* <Button class="bg-primary">in a style comment</Button> */',
          '</style>',
        ].join('\n'),
        'src/routes/sandbox/button/+page.svelte': '<Button class="bg-primary">fixture</Button>',
        'src/features/example/__tests__/Harness.svelte': '<Button class="bg-primary">test</Button>',
      },
      (root) => {
        const audit = buildButtonBackgroundAudit(root);
        expect(audit).toMatchObject({ count: 0, ceiling: 0, findings: [], failures: [] });
        expect(runUiComponentAudit('check', root).stderr).not.toContain('<Button> without variant');
      },
    );
  });

  it('fails closed on a Svelte file the parser rejects, naming the file and diagnostic instead of throwing', () => {
    withFixtures(
      {
        'src/features/example/Broken.svelte': '<div>\n<Button class={>',
        'src/features/example/Accept.svelte': '<Button class="bg-primary">Apply</Button>',
      },
      (root) => {
        const audit = buildButtonBackgroundAudit(root);
        expect(audit.findings).toEqual([
          { file: 'src/features/example/Accept.svelte', line: 1, classes: ['bg-primary'] },
        ]);
        expect(audit.failures).toHaveLength(2);
        expect(audit.failures[0]).toMatch(
          /^src\/features\/example\/Broken\.svelte:2:16: svelte parse error \(js_parse_error\): Unexpected token$/,
        );
        expect(audit.failures[1]).toMatch(
          /^src\/features\/example\/Accept\.svelte:1: <Button> without variant sets bg-primary/,
        );

        const report = runUiComponentAudit('button-backgrounds', root);
        expect(report.exitCode).toBe(0);
        expect(JSON.parse(report.stdout)).toMatchObject({ count: 1, failures: audit.failures });

        const result = runUiComponentAudit('check', root);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(
          'Broken.svelte:2:16: svelte parse error (js_parse_error): Unexpected token',
        );
        expect(result.stderr).toContain(
          'Accept.svelte:1: <Button> without variant sets bg-primary',
        );
      },
    );
  });

  it('keeps the checked-in tree at the zero ceiling', () => {
    expect(buildButtonBackgroundAudit()).toMatchObject({ count: 0, ceiling: 0, failures: [] });
  });
});

describe('raw principal avatar image guard', () => {
  const scaffold = {
    'src/lib/components/ui/button/index.ts': "export const Button = 'button';",
    'src/lib/components/ui/button/button.svelte': '<button>primitive host</button>',
    'scripts/ui-component-raw-element-allowlist.json': JSON.stringify({
      ceilings: {
        'src/features': { button: 0, input: 0, select: 0, textarea: 0 },
        'src/lib': { button: 0, input: 0, select: 0, textarea: 0 },
      },
      exceptions: [],
    }),
  };

  function withFixtures(files: Record<string, string>, run: (root: string) => void) {
    const root = mkdtempSync(path.join(tmpdir(), 'principal-avatar-audit-'));
    try {
      for (const [file, source] of Object.entries({ ...scaffold, ...files })) {
        const target = path.join(root, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, source);
      }
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('fails a raw <img> whose src binds an avatarUrl expression, naming file:line and PrincipalAvatar', () => {
    withFixtures(
      {
        'src/lib/components/settings/HostedWorkspaceRoster.svelte': [
          '<ul>',
          '  {#each members as member}',
          '    <li><img src={member.avatarUrl} alt="" class="rounded-full" /></li>',
          '  {/each}',
          '  <img alt="" src="{person.avatarUrl}" />',
          '  <img src={avatarUrl ?? placeholder} alt="" />',
          '</ul>',
        ].join('\n'),
      },
      (root) => {
        const audit = buildRawPrincipalAvatarAudit(root);
        expect(audit.findings).toEqual([
          { file: 'src/lib/components/settings/HostedWorkspaceRoster.svelte', line: 3 },
          { file: 'src/lib/components/settings/HostedWorkspaceRoster.svelte', line: 5 },
          { file: 'src/lib/components/settings/HostedWorkspaceRoster.svelte', line: 6 },
        ]);
        expect(audit.failures[0]).toMatch(
          /^src\/lib\/components\/settings\/HostedWorkspaceRoster\.svelte:3: raw <img> binds src to an avatarUrl expression; .*<PrincipalAvatar /,
        );

        const result = runUiComponentAudit('check', root);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(
          'HostedWorkspaceRoster.svelte:3: raw <img> binds src to an avatarUrl expression',
        );
        expect(result.stderr).toContain('PrincipalAvatar');
      },
    );
  });

  it('passes the PrincipalAvatar component itself and images that do not bind avatarUrl', () => {
    withFixtures(
      {
        'src/lib/components/ui/PrincipalAvatar.svelte': [
          '<script lang="ts">',
          '  let { avatarUrl, label } = $props();',
          '</script>',
          '<img src={avatarUrl} alt="" />',
        ].join('\n'),
        'src/features/example/Fine.svelte': [
          '<script lang="ts">',
          "  const example: string = '<img src={user.avatarUrl} />';",
          '  let avatarUrl = $state(null);',
          '</script>',
          '<!-- <img src={user.avatarUrl} /> -->',
          '<PrincipalAvatar {avatarUrl} label={user.login} />',
          '<img src={workspace.iconUrl} alt="" data-avatar-url={avatarUrl} />',
          '<img src="/static/avatarUrl.png" alt="" />',
          '<style>',
          '  /* <img src={user.avatarUrl} /> */',
          '</style>',
        ].join('\n'),
        'src/routes/sandbox/avatar/+page.svelte': '<img src={user.avatarUrl} alt="" />',
        'src/features/example/__tests__/Harness.svelte': '<img src={user.avatarUrl} alt="" />',
      },
      (root) => {
        const audit = buildRawPrincipalAvatarAudit(root);
        expect(audit).toMatchObject({ count: 0, ceiling: 0, findings: [], failures: [] });
        expect(runUiComponentAudit('check', root).stderr).not.toContain('avatarUrl');
      },
    );
  });

  it('keeps the checked-in tree at the zero ceiling', () => {
    expect(buildRawPrincipalAvatarAudit()).toMatchObject({ count: 0, ceiling: 0, failures: [] });
  });
});

describe('settings pattern adoption', () => {
  it('accepts standalone field rows and still flags sections without a schema form', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'settings-pattern-audit-'));
    const settings = path.join(root, 'src/lib/components/settings');
    mkdirSync(settings, { recursive: true });
    try {
      writeFileSync(
        path.join(settings, 'CustomSettings.svelte'),
        '<SettingsFieldRow id="custom" label="Custom"><CustomControl /></SettingsFieldRow>',
      );
      writeFileSync(
        path.join(settings, 'FormSettings.svelte'),
        '<SettingsSection><SettingsForm schema={schema} /></SettingsSection>',
      );
      writeFileSync(
        path.join(settings, 'UnmigratedSettings.svelte'),
        '<SettingsSection><CustomControl /></SettingsSection>',
      );
      expect(buildPatternAdoptionAudit(root).patterns.settingsForm.findings).toEqual([
        { file: 'src/lib/components/settings/UnmigratedSettings.svelte', occurrences: 1 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
