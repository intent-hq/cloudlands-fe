import fs from 'node:fs';
import path from 'node:path';
import type { UiComponentInventory } from '../src/lib/components/ui/component-metadata';
import { uiComponentGuardrails } from './ui-component-guardrails';
import { buildUiComponentInventory } from './ui-component-inventory';

const UI_ROOT = 'src/lib/components/ui';
const sortText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

export interface UiMigrationLedgerEntry {
  oldImport: string;
  replacement: string;
  callers: string[];
  dynamicCallers: string[];
  characterizationTest: string;
  owner: string;
  removalGate: string;
}

export interface UiInternalImportLedgerEntry {
  oldImport: string;
  canonicalImport: string;
  callers: string[];
  dynamicCallers: string[];
  catalogEntry: string;
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function productionSource(file: string): boolean {
  const normalized = file.split(path.sep).join('/');
  const internalRoute =
    normalized.includes('/src/routes/sandbox/') ||
    normalized.includes('/src/routes/(app)/test-') ||
    normalized.includes('/src/routes/(app)/workspace/[id]/terminal-test/');
  return (
    /\.(?:ts|svelte)$/.test(file) &&
    !internalRoute &&
    !file.includes('/__tests__/') &&
    !/\.(?:test|spec)\.ts$/.test(file) &&
    !/(?:test-harness|Harness|TestWrapper)\.svelte$/.test(file) &&
    !normalized.endsWith(`${UI_ROOT}/index.ts`) &&
    !normalized.endsWith(`${UI_ROOT}/manifest.ts`)
  );
}

function imports(source: string): Array<{ specifier: string; dynamic: boolean }> {
  const dynamic = [...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => ({
    specifier: match[1],
    dynamic: true,
  }));
  const staticImports = [
    ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
  ].map((match) => ({ specifier: match[1], dynamic: false }));
  return [...staticImports, ...dynamic];
}

function resolveUiSource(root: string, importer: string, specifier: string): string | null {
  const unresolved = specifier.startsWith('$lib/')
    ? `src/lib/${specifier.slice('$lib/'.length)}`
    : specifier.startsWith('.')
      ? path.join(path.dirname(importer), specifier)
      : specifier.startsWith('src/')
        ? specifier
        : null;
  if (!unresolved) return null;
  const relative = path.normalize(unresolved).split(path.sep).join('/');
  if (!relative.startsWith(`${UI_ROOT}/`)) return null;
  for (const candidate of [
    relative,
    `${relative}.ts`,
    `${relative}.svelte`,
    path.join(relative, 'index.ts'),
    relative.endsWith('.js') ? `${relative.slice(0, -3)}.ts` : '',
  ].filter(Boolean)) {
    const absolute = path.join(root, candidate);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile())
      return candidate.split(path.sep).join('/');
  }
  return null;
}

function ownerForSource(source: string, inventory: UiComponentInventory) {
  return inventory.components.find(
    (component) =>
      component.source === source ||
      (component.source.endsWith('/index.ts') &&
        path.posix.dirname(component.source) === path.posix.dirname(source)),
  );
}

export function buildUiMigrationLedger(root = process.cwd()): UiMigrationLedgerEntry[] {
  return buildUiComponentInventory(root)
    .components.filter(
      (
        component,
      ): component is typeof component & { replacement: string; characterizationTest: string } =>
        component.category === 'deprecated-wrapper' &&
        component.replacement !== null &&
        component.characterizationTest !== null,
    )
    .map((component) => ({
      oldImport: component.publicImport,
      replacement: component.replacement,
      callers: component.callers,
      dynamicCallers: component.dynamicImports,
      characterizationTest: component.characterizationTest,
      owner: component.owner,
      removalGate: component.removalGate,
    }))
    .sort((left, right) => sortText(left.oldImport, right.oldImport));
}

export function validateMigrationReplacement(
  replacement: string,
  inventory: UiComponentInventory,
  root = process.cwd(),
): string | null {
  if (replacement.startsWith('ledger:')) {
    const target = replacement.slice('ledger:'.length);
    return fs.existsSync(path.join(root, target)) ? null : `missing ledger ${target}`;
  }
  if (replacement.startsWith('$lib/components/ui/')) {
    return inventory.components.some(({ publicImport }) => publicImport === replacement)
      ? null
      : `missing canonical UI import ${replacement}`;
  }
  const alias = replacement.startsWith('$features/')
    ? `src/features/${replacement.slice('$features/'.length)}`
    : replacement.startsWith('$lib/')
      ? `src/lib/${replacement.slice('$lib/'.length)}`
      : null;
  if (!alias) return `unsupported replacement ${replacement}`;
  return fs.existsSync(path.join(root, alias)) ||
    fs.existsSync(path.join(root, `${alias}.ts`)) ||
    fs.existsSync(path.join(root, `${alias}.svelte`)) ||
    fs.existsSync(path.join(root, alias, 'index.ts'))
    ? null
    : `missing replacement ${replacement}`;
}

export function buildUiInternalImportLedger(root = process.cwd()): UiInternalImportLedgerEntry[] {
  const inventory = buildUiComponentInventory(root);
  const entries = new Map<string, UiInternalImportLedgerEntry>();
  for (const absolute of walk(path.join(root, 'src')).filter(productionSource)) {
    const importer = path.relative(root, absolute).split(path.sep).join('/');
    for (const imported of imports(fs.readFileSync(absolute, 'utf8'))) {
      const source = resolveUiSource(root, importer, imported.specifier);
      if (!source) continue;
      const owner = ownerForSource(source, inventory);
      if (!owner || imported.specifier === owner.publicImport) continue;
      if (owner.publicImport === '$lib/components/ui/component-metadata') continue;
      if (
        owner.source.endsWith('/index.ts') &&
        importer.startsWith(`${path.posix.dirname(owner.source)}/`)
      )
        continue;
      const oldImport = imported.specifier.startsWith('.')
        ? `relative:${source}`
        : imported.specifier;
      const entry = entries.get(oldImport) ?? {
        oldImport,
        canonicalImport: owner.publicImport,
        callers: [],
        dynamicCallers: [],
        catalogEntry: `/sandbox/${owner.id}`,
      };
      const target = imported.dynamic ? entry.dynamicCallers : entry.callers;
      if (!target.includes(importer)) target.push(importer);
      entries.set(oldImport, entry);
    }
  }
  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      callers: entry.callers.sort(sortText),
      dynamicCallers: entry.dynamicCallers.sort(sortText),
    }))
    .sort((left, right) => sortText(left.oldImport, right.oldImport));
}

export function countRawUiControls(root = process.cwd()) {
  const approvedRoots = [
    'button',
    'input',
    'select',
    'textarea',
    'checkbox',
    'switch',
    'toggle',
    'toggle-group',
    'menu',
    'dialog',
    'sheet',
    'combobox',
    'file-input',
    'slider',
  ].map((family) => `${UI_ROOT}/${family}/`);
  const counts = { button: 0, input: 0, select: 0, textarea: 0 };
  for (const absolute of walk(path.join(root, 'src')).filter(
    (file) => file.endsWith('.svelte') && productionSource(file),
  )) {
    const file = path.relative(root, absolute).split(path.sep).join('/');
    if (approvedRoots.some((approved) => file.startsWith(approved))) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const tag of Object.keys(counts) as Array<keyof typeof counts>) {
      counts[tag] += [...source.matchAll(new RegExp(`<${tag}(?=[\\s>])`, 'g'))].length;
    }
  }
  return counts;
}

export function structuralGuardrailFailures(root = process.cwd()): string[] {
  const failures: string[] = [];
  for (const entry of buildUiInternalImportLedger(root)) {
    const count = entry.callers.length + entry.dynamicCallers.length;
    const ceiling =
      uiComponentGuardrails.internalImports[
        entry.oldImport as keyof typeof uiComponentGuardrails.internalImports
      ];
    if (ceiling === undefined || count > ceiling) {
      failures.push(
        `${entry.oldImport}: internal UI import has ${count} callers (ceiling=${ceiling ?? 0}); use ${entry.canonicalImport}; catalog=${entry.catalogEntry}`,
      );
    }
  }
  const raw = countRawUiControls(root);
  for (const tag of Object.keys(raw) as Array<keyof typeof raw>) {
    const ceiling = uiComponentGuardrails.rawControls[tag];
    if (raw[tag] > ceiling) {
      const canonical = tag === 'select' ? 'select' : tag;
      failures.push(
        `raw <${tag}> count ${raw[tag]} exceeds ratchet ${ceiling}; use $lib/components/ui/${canonical}; catalog=/sandbox/${canonical}`,
      );
    }
  }
  return failures.sort(sortText);
}
