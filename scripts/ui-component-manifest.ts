import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'svelte/compiler';
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

export interface CheckboxControlLedgerEntry {
  file: string;
  line: number;
  kind: 'native-input' | 'checkbox-role' | 'menuitemcheckbox-role';
  exemption: string | null;
}

export type BinaryControlKind =
  | 'checkbox-import'
  | 'switch-import'
  | 'toggle-contract'
  | 'toggle-switch-variant'
  | 'toggle-indicator-variant';

export interface BinaryControlLedgerEntry {
  file: string;
  line: number;
  kind: BinaryControlKind;
  exemption: string | null;
}

export interface ProductToggleLedgerEntry {
  file: string;
  line: number;
  selfClosing: boolean;
  size: string | null;
  hasAriaLabel: boolean;
  hasSourceDerivedAriaLabel: boolean;
  variant: string | null;
  exemption: string | null;
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

function checkboxControlExemption(file: string): string | null {
  for (const exemption of uiComponentGuardrails.checkboxControlAllowlist) {
    const matches =
      exemption.match === 'exact'
        ? file === exemption.path
        : exemption.match === 'prefix'
          ? file.startsWith(exemption.path)
          : exemption.match === 'contains'
            ? file.includes(exemption.path)
            : file.endsWith(exemption.path);
    if (matches) return exemption.reason;
  }
  return null;
}

function binaryControlExemption(file: string, kind: BinaryControlKind): string | null {
  for (const exemption of uiComponentGuardrails.binaryControlAllowlist) {
    if (!(exemption.kinds as readonly BinaryControlKind[]).includes(kind)) continue;
    const matches =
      exemption.match === 'exact'
        ? file === exemption.path
        : exemption.match === 'prefix'
          ? file.startsWith(exemption.path)
          : exemption.match === 'contains'
            ? file.includes(exemption.path)
            : file.endsWith(exemption.path);
    if (matches) return exemption.reason;
  }
  return null;
}

function staticAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']+)["']|\\{\\s*["']([^"']+)["']\\s*\\})`, 'i'),
  );
  return match?.[1] ?? match?.[2] ?? null;
}

export function buildCheckboxControlLedger(root = process.cwd()): CheckboxControlLedgerEntry[] {
  const entries: CheckboxControlLedgerEntry[] = [];
  for (const absolute of walk(path.join(root, 'src')).filter((file) => file.endsWith('.svelte'))) {
    const file = path.relative(root, absolute).split(path.sep).join('/');
    const source = fs
      .readFileSync(absolute, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
    for (const match of source.matchAll(/<([A-Za-z][\w:.-]*)\b([\s\S]*?)>/g)) {
      const tag = match[1].toLowerCase();
      const attributes = match[2];
      const type = staticAttribute(attributes, 'type')?.toLowerCase();
      const role = staticAttribute(attributes, 'role')?.toLowerCase();
      const kind =
        tag === 'input' && type === 'checkbox'
          ? 'native-input'
          : role === 'checkbox'
            ? 'checkbox-role'
            : role === 'menuitemcheckbox'
              ? 'menuitemcheckbox-role'
              : null;
      if (!kind) continue;
      entries.push({
        file,
        line: source.slice(0, match.index).split('\n').length,
        kind,
        exemption: checkboxControlExemption(file),
      });
    }
  }
  return entries.sort(
    (left, right) =>
      sortText(left.file, right.file) || left.line - right.line || sortText(left.kind, right.kind),
  );
}

export function checkboxControlGuardrailFailures(root = process.cwd()): string[] {
  return buildCheckboxControlLedger(root)
    .filter(({ exemption }) => exemption === null)
    .map(({ file, line, kind }) => {
      const replacement =
        kind === 'menuitemcheckbox-role'
          ? '$lib/components/ui/menu Menu.CheckboxItem'
          : '$lib/components/ui/toggle Toggle';
      return `${file}:${line}: ${kind} bypasses the checkbox design-system boundary; use ${replacement} or add a reviewed contextual exemption`;
    });
}

function binaryControlImportKind(
  file: string,
  specifier: string,
): 'checkbox-import' | 'switch-import' | null {
  for (const family of ['checkbox', 'switch'] as const) {
    const alias = `$lib/components/ui/${family}`;
    if (
      specifier === alias ||
      specifier === `${alias}/index` ||
      specifier === `${alias}/index.ts` ||
      specifier === `${alias}/index.js` ||
      specifier === `${alias}/${family}.svelte`
    ) {
      return `${family}-import`;
    }
    if (!specifier.startsWith('.')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const root = `${UI_ROOT}/${family}`;
    if (
      resolved === root ||
      resolved === `${root}/index` ||
      resolved === `${root}/index.ts` ||
      resolved === `${root}/index.js` ||
      resolved === `${root}/${family}.svelte`
    ) {
      return `${family}-import`;
    }
  }
  return null;
}

function importsToggle(file: string, source: string): boolean {
  return imports(source).some(({ specifier }) => {
    const alias = '$lib/components/ui/toggle';
    if (
      specifier === alias ||
      specifier === `${alias}/index` ||
      specifier === `${alias}/index.ts` ||
      specifier === `${alias}/index.js` ||
      specifier === `${alias}/toggle.svelte`
    ) {
      return true;
    }
    if (!specifier.startsWith('.')) return false;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const root = `${UI_ROOT}/toggle`;
    return (
      resolved === root ||
      resolved === `${root}/index` ||
      resolved === `${root}/index.ts` ||
      resolved === `${root}/index.js` ||
      resolved === `${root}/toggle.svelte`
    );
  });
}

interface SvelteNode {
  type?: string;
  name?: string;
  start?: number;
  end?: number;
  attributes?: Array<{
    type?: string;
    name?: string;
    start?: number;
    end?: number;
    value?: unknown;
  }>;
  [key: string]: unknown;
}

function visitSvelteNodes(value: unknown, visitor: (node: SvelteNode) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitSvelteNodes(item, visitor);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as SvelteNode;
  if (typeof node.type === 'string') visitor(node);
  for (const [key, child] of Object.entries(node)) {
    if (['metadata', 'loc', 'name_loc'].includes(key)) continue;
    if (Array.isArray(child) || (child && typeof child === 'object')) {
      visitSvelteNodes(child, visitor);
    }
  }
}

function hasSourceDerivedAttributeExpression(
  attribute: NonNullable<SvelteNode['attributes']>[number],
): boolean {
  if (!attribute.value || Array.isArray(attribute.value) || typeof attribute.value !== 'object') {
    return false;
  }
  const value = attribute.value as {
    type?: string;
    expression?: { type?: string; expressions?: unknown[] };
  };
  if (value.type !== 'ExpressionTag' || !value.expression) return false;
  if (value.expression.type === 'Literal') return false;
  if (value.expression.type === 'TemplateLiteral' && value.expression.expressions?.length === 0) {
    return false;
  }
  return true;
}

export function buildProductToggleLedger(root = process.cwd()): ProductToggleLedgerEntry[] {
  const entries: ProductToggleLedgerEntry[] = [];
  for (const absolute of walk(path.join(root, 'src')).filter((file) => file.endsWith('.svelte'))) {
    const file = path.relative(root, absolute).split(path.sep).join('/');
    const source = fs.readFileSync(absolute, 'utf8');
    if (!importsToggle(file, source)) continue;
    const ast = parse(source, { modern: true });
    visitSvelteNodes(ast.fragment, (node) => {
      if (
        node.type !== 'Component' ||
        node.name !== 'Toggle' ||
        node.start === undefined ||
        node.end === undefined
      ) {
        return;
      }
      const raw = source.slice(node.start, node.end);
      const variant = staticAttribute(raw, 'variant');
      if (variant === 'group') return;
      const ariaLabelAttribute = node.attributes?.find(
        (attribute) => attribute.type === 'Attribute' && attribute.name === 'ariaLabel',
      );
      entries.push({
        file,
        line: source.slice(0, node.start).split('\n').length,
        selfClosing: raw.trimEnd().endsWith('/>'),
        size: staticAttribute(raw, 'size'),
        hasAriaLabel: ariaLabelAttribute !== undefined,
        hasSourceDerivedAriaLabel:
          ariaLabelAttribute !== undefined &&
          hasSourceDerivedAttributeExpression(ariaLabelAttribute),
        variant,
        exemption: binaryControlExemption(file, 'toggle-contract'),
      });
    });
  }
  return entries.sort((left, right) => sortText(left.file, right.file) || left.line - right.line);
}

export function productToggleGuardrailFailures(root = process.cwd()): string[] {
  return buildProductToggleLedger(root)
    .filter(({ exemption }) => exemption === null)
    .flatMap(
      ({ file, line, selfClosing, size, hasAriaLabel, hasSourceDerivedAriaLabel, variant }) => {
        const violations: string[] = [];
        if (!selfClosing) {
          violations.push('render no inline content and keep the visible label external');
        }
        if (size !== 'xs') violations.push('set size="xs"');
        if (!hasAriaLabel) {
          violations.push('provide a localized/source-derived ariaLabel expression');
        } else if (!hasSourceDerivedAriaLabel) {
          violations.push(
            'replace the literal ariaLabel with a localized/source-derived expression',
          );
        }
        if (variant !== null) {
          violations.push('use the default variant without an explicit variant prop');
        }
        return violations.length
          ? [
              `${file}:${line}: product Toggle violates the compact binary-control contract (${violations.join('; ')})`,
            ]
          : [];
      },
    );
}

export function buildBinaryControlLedger(root = process.cwd()): BinaryControlLedgerEntry[] {
  const entries: BinaryControlLedgerEntry[] = [];
  for (const absolute of walk(path.join(root, 'src')).filter((file) =>
    /\.(?:ts|svelte)$/.test(file),
  )) {
    const file = path.relative(root, absolute).split(path.sep).join('/');
    const source = fs.readFileSync(absolute, 'utf8');
    const importPatterns = [
      /\bfrom\s*['"]([^'"]+)['"]/g,
      /\bimport\s*['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) {
        const kind = binaryControlImportKind(file, match[1]);
        if (!kind) continue;
        entries.push({
          file,
          line: source.slice(0, match.index).split('\n').length,
          kind,
          exemption: binaryControlExemption(file, kind),
        });
      }
    }
    for (const match of source.matchAll(
      /\bimport\s*\{([^}]*)\}\s*from\s*['"]\$lib\/components\/ui['"]/g,
    )) {
      for (const family of ['Checkbox', 'Switch'] as const) {
        if (!new RegExp(`\\b${family}(?:\\s+as\\s+\\w+)?\\b`).test(match[1])) continue;
        const kind = `${family.toLowerCase()}-import` as const;
        entries.push({
          file,
          line: source.slice(0, match.index).split('\n').length,
          kind,
          exemption: binaryControlExemption(file, kind),
        });
      }
    }
    if (!absolute.endsWith('.svelte')) continue;
    const uncommented = source.replace(/<!--[\s\S]*?-->/g, (comment) =>
      comment.replace(/[^\n]/g, ' '),
    );
    for (const match of uncommented.matchAll(/<Toggle\b[^>]*>/g)) {
      const variant = staticAttribute(match[0], 'variant');
      if (variant !== 'switch' && variant !== 'indicator') continue;
      const kind = `toggle-${variant}-variant` as const;
      entries.push({
        file,
        line: uncommented.slice(0, match.index).split('\n').length,
        kind,
        exemption: binaryControlExemption(file, kind),
      });
    }
  }
  return entries.sort(
    (left, right) =>
      sortText(left.file, right.file) || left.line - right.line || sortText(left.kind, right.kind),
  );
}

export function binaryControlGuardrailFailures(root = process.cwd()): string[] {
  return buildBinaryControlLedger(root)
    .filter(({ exemption }) => exemption === null)
    .map(({ file, line, kind }) => {
      const guidance =
        kind === 'checkbox-import'
          ? 'imports Checkbox outside the approved TipTap task-checkbox and test/catalog contexts; use $lib/components/ui/toggle Toggle'
          : kind === 'switch-import'
            ? 'imports Switch outside test/catalog characterization; use $lib/components/ui/toggle Toggle'
            : `uses removed Toggle ${kind === 'toggle-switch-variant' ? 'switch' : 'indicator'} compatibility mode; use the default compact Toggle`;
      return `${file}:${line}: ${guidance}`;
    });
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
  failures.push(...checkboxControlGuardrailFailures(root));
  failures.push(...binaryControlGuardrailFailures(root));
  failures.push(...productToggleGuardrailFailures(root));
  return failures.sort(sortText);
}
