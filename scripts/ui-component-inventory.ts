import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  parseUiComponentInventory,
  type UiComponentCategory,
  type UiComponentInventory,
} from '../src/lib/components/ui/component-metadata';

const UI_IMPORT = '$lib/components/ui/';
const UI_ROOT = 'src/lib/components/ui';
const CHARACTERIZATION_GATE = 'scripts/ui-component-audit.test.ts';
const sortText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const primitiveFamilies = new Set([
  'badge',
  'breadcrumb',
  'button',
  'button-group',
  'checkbox',
  'dialog',
  'file-input',
  'input',
  'label',
  'menu',
  'scroll-area',
  'select',
  'separator',
  'sheet',
  'slider',
  'skeleton',
  'switch',
  'textarea',
  'toggle',
  'toggle-group',
]);
const patternFamilies = new Set([
  'card',
  'combobox',
  'indicators',
  'list',
  'panel-find-bar',
  'settings-field-row',
  'settings-page-shell',
  'settings-section',
  'sidebar',
  'toast',
  'tooltip',
]);
const standalonePatterns = new Map<string, string>([
  ['AnimatedNumber.svelte', '007-B1'],
  ['CollapsiblePanel.svelte', 'design-system'],
  ['CopyButton.svelte', '007-B1'],
  ['EditableName.svelte', '007-B2'],
  ['Header.svelte', 'design-system'],
  ['HoverCard.svelte', 'design-system'],
  ['ImageLightbox.svelte', 'design-system'],
  ['NavigationButtons.svelte', '007-B1'],
  ['PanelWrapper.svelte', 'design-system'],
  ['Portal.svelte', 'design-system'],
  ['RelativeTime.svelte', 'design-system'],
  ['RichTextarea.svelte', '007-B2'],
  ['SaveIndicator.svelte', '007-B1'],
  ['ScrollableSection.svelte', 'design-system'],
  ['ShimmerOverlay.svelte', '007-B1'],
  ['TypewriterText.svelte', 'design-system'],
  ['VirtualList.svelte', 'design-system'],
  ['VSCodePanel.svelte', 'design-system'],
  ['VSCodeScrollablePanel.svelte', 'design-system'],
]);
const deprecatedFamilies = new Map<string, { owner: string; replacement: string }>([
  [
    'dropdown',
    {
      owner: '007-B6',
      replacement: 'ledger:src/lib/components/ui/dropdown/dropdown-caller-ledger.ts',
    },
  ],
  ['dropdown-menu.svelte', { owner: '007-B5', replacement: '$lib/components/ui/menu' }],
  ['grouped-combobox', { owner: '007-B6', replacement: '$lib/components/ui/combobox' }],
  ['searchable-combobox', { owner: '007-B6', replacement: '$lib/components/ui/combobox' }],
  ['searchable-select', { owner: '007-B6', replacement: '$lib/components/ui/combobox' }],
]);
interface Policy {
  category: UiComponentCategory;
  owner: string;
  replacement: string | null;
  removalGate: string;
}

function policyFor(publicImport: string): Policy {
  const family = publicImport.slice(UI_IMPORT.length).split('/')[0];
  if (publicImport === `${UI_IMPORT}tabs`) {
    return {
      category: 'deletion-candidate',
      owner: '007-B7',
      replacement: 'delete: add a Bits-backed Tabs primitive only with a real consumer',
      removalGate: 'Static and dynamic callers remain zero and the inventory audit passes.',
    };
  }
  if (publicImport === `${UI_IMPORT}TabBar.svelte`) {
    return {
      category: 'deletion-candidate',
      owner: '007-B7',
      replacement: '$lib/components/layout/panel-system/PanelTabBar.svelte',
      removalGate: 'Static and dynamic callers remain zero and layout tab tests pass.',
    };
  }
  const deprecated = deprecatedFamilies.get(family);
  if (deprecated) {
    return {
      category: 'deprecated-wrapper',
      ...deprecated,
      removalGate: 'All static and dynamic callers migrate and replacement behavior tests pass.',
    };
  }
  if (primitiveFamilies.has(family)) {
    return {
      category: 'primitive',
      owner: ['breadcrumb', 'scroll-area'].includes(family)
        ? '012-F2'
        : ['file-input', 'slider'].includes(family)
          ? '008-B'
          : family === 'select'
            ? '007-B6'
            : family === 'dialog'
              ? '007-B4'
              : family === 'menu'
                ? '007-B5'
                : ['badge', 'button', 'button-group', 'skeleton'].includes(family)
                  ? '007-B1'
                  : [
                        'checkbox',
                        'input',
                        'label',
                        'switch',
                        'textarea',
                        'toggle',
                        'toggle-group',
                      ].includes(family)
                    ? '007-B2'
                    : family === 'sheet'
                      ? '007-B4'
                      : 'design-system',
      replacement: null,
      removalGate: 'Retain while exported; require metadata, fixtures, and behavioral coverage.',
    };
  }
  if (patternFamilies.has(family)) {
    return {
      category: 'pattern',
      owner: family.startsWith('settings-')
        ? '008-B'
        : ['sidebar', 'tooltip'].includes(family)
          ? '012-F2'
          : ['card', 'list'].includes(family)
            ? '012-E'
            : family === 'combobox'
              ? '007-B6'
              : ['indicators', 'skeleton', 'toast'].includes(family)
                ? '007-B1'
                : 'design-system',
      replacement: null,
      removalGate: 'Retain while callers need the pattern and catalog coverage remains current.',
    };
  }
  const standaloneOwner = standalonePatterns.get(family);
  if (standaloneOwner) {
    return {
      category: 'pattern',
      owner: standaloneOwner,
      replacement: null,
      removalGate: 'Retain while callers need the pattern and catalog coverage remains current.',
    };
  }
  return {
    category: 'product',
    owner: family === 'tab' ? '007-B7' : '007-B8',
    replacement: null,
    removalGate:
      'Move to the owning feature after caller and behavior characterization is complete.',
  };
}

function walk(directory: string, predicate: (file: string) => boolean): string[] {
  const files: string[] = [];
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => sortText(a.name, b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target, predicate));
    else if (predicate(target)) files.push(target);
  }
  return files;
}

function isProductionSource(file: string): boolean {
  const normalized = file.split(path.sep).join('/');
  return (
    /\.(?:ts|svelte)$/.test(file) &&
    !file.includes('/__tests__/') &&
    !/\.(?:test|spec)\.ts$/.test(file) &&
    !/Harness\.svelte$/.test(file) &&
    !normalized.endsWith(`${UI_ROOT}/index.ts`) &&
    !normalized.endsWith(`${UI_ROOT}/manifest.ts`)
  );
}

function readImportSpecifiers(source: string): {
  staticImports: string[];
  dynamicImports: string[];
} {
  const dynamicImports = [...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => match[1],
  );
  const staticImports = [
    ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
  return { staticImports, dynamicImports };
}

function resolveUiImport(root: string, importer: string, specifier: string): string | null {
  const relative = specifier.startsWith('$lib/')
    ? `src/lib/${specifier.slice('$lib/'.length)}`
    : specifier.startsWith('.')
      ? path.normalize(path.join(path.dirname(importer), specifier))
      : specifier.startsWith('src/')
        ? specifier
        : null;
  if (!relative || !relative.replaceAll(path.sep, '/').startsWith(`${UI_ROOT}/`)) return null;
  const candidates = [
    relative,
    `${relative}.ts`,
    `${relative}.svelte`,
    path.join(relative, 'index.ts'),
    relative.endsWith('.js') ? relative.slice(0, -3) + '.ts' : '',
  ].filter(Boolean);
  return (
    candidates.find((candidate) => {
      const target = path.join(root, candidate);
      return fs.existsSync(target) && fs.statSync(target).isFile();
    }) ?? null
  );
}

function isModuleInternal(file: string, source: string): boolean {
  if (file === source) return true;
  return source.endsWith('/index.ts') && file.startsWith(`${path.dirname(source)}/`);
}

function exportedNames(source: string, file: string): string[] {
  if (file.endsWith('.svelte')) return ['default'];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const statement of ast.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) names.add(item.name.text);
      } else names.add('*');
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return [...names].sort(sortText);
}

function nearestPublicModule(source: string, modules: Map<string, string>): string | null {
  for (const [publicImport, moduleSource] of modules) {
    if (moduleSource === source) return publicImport;
    if (moduleSource.endsWith('/index.ts') && path.dirname(moduleSource) === path.dirname(source)) {
      return publicImport;
    }
  }
  return null;
}

export function buildUiComponentInventory(root = process.cwd()): UiComponentInventory {
  const absoluteUiRoot = path.join(root, UI_ROOT);
  const modules = new Map<string, string>();
  for (const file of walk(absoluteUiRoot, (target) => target.endsWith('/index.ts'))) {
    if (file.includes('/__tests__/')) continue;
    const relativeDirectory = path
      .relative(absoluteUiRoot, path.dirname(file))
      .split(path.sep)
      .join('/');
    if (!relativeDirectory) continue;
    modules.set(
      `${UI_IMPORT}${relativeDirectory}`,
      path.relative(root, file).split(path.sep).join('/'),
    );
  }
  for (const file of fs
    .readdirSync(absoluteUiRoot)
    .filter((name) => name.endsWith('.svelte'))
    .sort(sortText)) {
    modules.set(`${UI_IMPORT}${file}`, `${UI_ROOT}/${file}`);
  }

  const sourceFiles = walk(path.join(root, 'src'), isProductionSource);
  const importsByFile = new Map<
    string,
    ReturnType<typeof readImportSpecifiers> & {
      staticSources: string[];
      dynamicSources: string[];
    }
  >();
  const importedSources = new Map<string, string>();
  for (const file of sourceFiles) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const imports = readImportSpecifiers(fs.readFileSync(file, 'utf8'));
    const staticSources = imports.staticImports
      .map((specifier) => resolveUiImport(root, relative, specifier))
      .filter((source): source is string => source !== null);
    const dynamicSources = imports.dynamicImports
      .map((specifier) => resolveUiImport(root, relative, specifier))
      .filter((source): source is string => source !== null);
    importsByFile.set(relative, { ...imports, staticSources, dynamicSources });
    for (const specifier of [...imports.staticImports, ...imports.dynamicImports]) {
      const resolved = resolveUiImport(root, relative, specifier);
      if (resolved && specifier.startsWith(UI_IMPORT)) importedSources.set(specifier, resolved);
    }
  }
  for (const [specifier, source] of importedSources) {
    if (!nearestPublicModule(source, modules)) modules.set(specifier, source);
  }

  const aliases = new Map<string, string[]>();
  for (const [specifier, source] of importedSources) {
    const owner = nearestPublicModule(source, modules);
    if (owner && owner !== specifier)
      aliases.set(owner, [...(aliases.get(owner) ?? []), specifier]);
  }

  const importOwnersByFile = new Map<
    string,
    ReturnType<typeof readImportSpecifiers> & {
      staticOwners: Set<string>;
      dynamicOwners: Set<string>;
    }
  >();
  for (const [file, imports] of importsByFile) {
    importOwnersByFile.set(file, {
      staticImports: imports.staticImports,
      dynamicImports: imports.dynamicImports,
      staticOwners: new Set(
        imports.staticSources
          .map((source) => nearestPublicModule(source, modules))
          .filter((owner): owner is string => owner !== null),
      ),
      dynamicOwners: new Set(
        imports.dynamicSources
          .map((source) => nearestPublicModule(source, modules))
          .filter((owner): owner is string => owner !== null),
      ),
    });
  }

  const components = [...modules.entries()].map(([publicImport, source]) => {
    const importNames = [publicImport, ...(aliases.get(publicImport) ?? [])];
    const callers = new Set<string>();
    const dynamicImports = new Set<string>();
    for (const [file, imports] of importOwnersByFile) {
      if (isModuleInternal(file, source)) continue;
      if (
        imports.staticOwners.has(publicImport) ||
        imports.staticImports.some((specifier) => importNames.includes(specifier))
      )
        callers.add(file);
      if (
        imports.dynamicOwners.has(publicImport) ||
        imports.dynamicImports.some((specifier) => importNames.includes(specifier))
      )
        dynamicImports.add(file);
    }
    const policy = policyFor(publicImport);
    const sourceDirectory = path.dirname(path.join(root, source));
    const sourceBase = path.basename(source).replace(/\.(?:svelte|ts)$/, '');
    const existingTest = source.endsWith('/index.ts')
      ? walk(sourceDirectory, (file) => /\.(?:test|spec)\.ts$/.test(file))[0]
      : [
          path.join(sourceDirectory, `${sourceBase}.test.ts`),
          path.join(sourceDirectory, '__tests__', `${sourceBase}.test.ts`),
        ].find((file) => fs.existsSync(file));
    const characterizationTest = ['deprecated-wrapper', 'deletion-candidate'].includes(
      policy.category,
    )
      ? existingTest
        ? path.relative(root, existingTest).split(path.sep).join('/')
        : CHARACTERIZATION_GATE
      : existingTest
        ? path.relative(root, existingTest).split(path.sep).join('/')
        : null;
    const id = publicImport
      .slice(UI_IMPORT.length)
      .replace(/\.(?:svelte|ts)$/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase();
    return {
      id,
      source,
      publicImport,
      legacyImports: [...new Set(aliases.get(publicImport) ?? [])].sort(sortText),
      exports: exportedNames(fs.readFileSync(path.join(root, source), 'utf8'), source),
      ...policy,
      callers: [...callers].sort(sortText),
      characterizationTest,
      dynamicImports: [...dynamicImports].sort(sortText),
      fixtures: [],
    };
  });

  return parseUiComponentInventory({
    version: 1,
    folderTemplate: {
      implementation: '<component>/<component>.svelte',
      publicModule: '<component>/index.ts',
      metadata: '<component>/<component>.meta.ts',
      behavioralTest: '<component>/<component>.test.ts',
      fixture: '<component>/<component>.fixtures.ts',
      variantRecipe: '<component>/<component>.variants.ts',
    },
    dependencyRules: [
      {
        layer: 'primitive',
        allowed: ['svelte', 'bits-ui', '$lib/utils', './'],
        forbidden: ['$features/', '$store/', 'electron', '$lib/client', '$lib/services'],
        repair: '$lib/components/ui/<component>',
      },
      {
        layer: 'pattern',
        allowed: ['$lib/components/ui/', '$lib/utils', 'svelte', 'bits-ui'],
        forbidden: ['$features/*/main/', 'electron'],
        repair: '$lib/components/ui/<primitive>',
      },
      {
        layer: 'product',
        allowed: ['$features/', '$store/', '$lib/components/ui/'],
        forbidden: ['$features/*/main/', 'electron'],
        repair: '$features/<owner>/components/<component>',
      },
    ],
    components: components.sort((a, b) => sortText(a.publicImport, b.publicImport)),
  });
}
