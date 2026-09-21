#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AST, parse } from 'svelte/compiler';
import type { UiComponentInventory } from '../src/lib/components/ui/component-metadata';
import { canonicalComponentManifest } from '../src/lib/components/ui/manifest';
import {
  buildUiInternalImportLedger,
  buildUiMigrationLedger,
  countRawUiControls,
  structuralGuardrailFailures,
  validateMigrationReplacement,
} from './ui-component-manifest';
import { uiComponentGuardrails } from './ui-component-guardrails';
import { buildUiComponentInventory } from './ui-component-inventory';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sortText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const RAW_ELEMENT_TAGS = ['button', 'input', 'select', 'textarea'] as const;
const RAW_ELEMENT_POLICY = 'scripts/ui-component-raw-element-allowlist.json';
const RAW_ELEMENT_APPROVED_ROOTS = [
  ...[
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
  ].map((family) => `src/lib/components/ui/${family}/`),
  'src/lib/components/ui/sidebar/sidebar-rail.svelte',
  'src/lib/components/ui/sidebar/sidebar-menu-button.svelte',
];

type RawElementTag = (typeof RAW_ELEMENT_TAGS)[number];
type RawElementCounts = Record<RawElementTag, { files: number; elements: number }>;

interface RawElementPolicy {
  ceilings: Record<string, Record<RawElementTag, number>>;
}

type PatternAdoptionKind = keyof typeof uiComponentGuardrails.patternAdoption;

interface PatternAdoptionFinding {
  file: string;
  occurrences: number;
}

export interface PatternAdoptionAudit {
  patterns: Record<
    PatternAdoptionKind,
    { count: number; ceiling: number; findings: PatternAdoptionFinding[] }
  >;
  failures: string[];
}

function walk(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => sortText(a.name, b.name))
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    });
}

function normalizedRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function productionSvelteSource(file: string): boolean {
  const normalized = file.split(path.sep).join('/');
  const internalRoute =
    normalized.includes('/src/routes/sandbox/') ||
    normalized.includes('/src/routes/(app)/test-') ||
    normalized.includes('/src/routes/(app)/workspace/[id]/terminal-test/');
  return (
    file.endsWith('.svelte') &&
    !internalRoute &&
    !normalized.includes('/__tests__/') &&
    !/(?:test-harness|Harness|TestWrapper)\.svelte$/.test(normalized)
  );
}

function productPatternSource(root: string, file: string): boolean {
  const relative = normalizedRelative(root, file);
  return (
    productionSvelteSource(file) &&
    !relative.startsWith('src/lib/component-catalog/') &&
    !relative.startsWith('src/lib/components/patterns/') &&
    !relative.startsWith('src/lib/components/ui/')
  );
}

function eachListOccurrences(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/\{#each\b/g)) {
    const closingIndex = source.indexOf('{/each}', match.index);
    const block = source.slice(match.index, closingIndex < 0 ? source.length : closingIndex);
    if (
      /<li(?=[\s>])/.test(block) ||
      /<div(?=[^>]*class(?:=|:)[^>]*(?:hover:|group-hover:))[^>]*>/.test(block)
    ) {
      count += 1;
    }
  }
  return count;
}

export function buildPatternAdoptionAudit(root = projectRoot): PatternAdoptionAudit {
  const findings = Object.fromEntries(
    Object.keys(uiComponentGuardrails.patternAdoption).map((kind) => [kind, []]),
  ) as Record<PatternAdoptionKind, PatternAdoptionFinding[]>;
  const files = walk(path.join(root, 'src')).filter((file) => productPatternSource(root, file));

  for (const absolute of files) {
    const file = normalizedRelative(root, absolute);
    const source = fs.readFileSync(absolute, 'utf8');
    const settingsCandidate =
      (file.includes('/settings/') || /Settings\.svelte$/.test(file)) &&
      // Standalone SettingsFieldRow is the canonical anatomy for bespoke controls.
      // Section-level forms still require the schema-driven SettingsForm.
      /<SettingsSection\b/.test(source);
    if (settingsCandidate && !/<SettingsForm\b/.test(source)) {
      findings.settingsForm.push({ file, occurrences: 1 });
    }

    const basename = path.posix.basename(file);
    const screenCandidate =
      basename === '+page.svelte' || /(?:Page|TakeoverOverlay)\.svelte$/.test(basename);
    if (
      screenCandidate &&
      !/<(?:Screen|TakeoverScreen)\b/.test(source) &&
      !file.includes('/test-') &&
      !file.includes('/terminal-test/')
    ) {
      findings.screen.push({ file, occurrences: 1 });
    }

    const collectionOccurrences = eachListOccurrences(source);
    if (collectionOccurrences > 0 && !/<ListView\b/.test(source)) {
      findings.listView.push({ file, occurrences: collectionOccurrences });
    }

    const dialogOccurrences = [...source.matchAll(/<Dialog\.(?:Root|Content)\b/g)].length;
    if (
      dialogOccurrences > 0 &&
      !/<(?:FormDialog|DestructiveConfirm)\b/.test(source) &&
      !/\b(?:confirm|prompt|alert)\s*\(/.test(source)
    ) {
      findings.formDialog.push({ file, occurrences: dialogOccurrences });
    }
  }

  const failures: string[] = [];
  const patterns = Object.fromEntries(
    (Object.keys(findings) as PatternAdoptionKind[]).sort(sortText).map((kind) => {
      const sorted = findings[kind].sort((left, right) => sortText(left.file, right.file));
      const count = sorted.length;
      const ceiling = uiComponentGuardrails.patternAdoption[kind];
      if (count > ceiling) {
        failures.push(
          `pattern ${kind} count ${count} exceeds ceiling ${ceiling}; migrate new surfaces to the canonical pattern`,
        );
      }
      return [kind, { count, ceiling, findings: sorted }];
    }),
  ) as PatternAdoptionAudit['patterns'];
  return { patterns, failures: failures.sort(sortText) };
}

function patternAdoptionCheckFailures(root: string): string[] {
  try {
    return buildPatternAdoptionAudit(root).failures;
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

interface ButtonBackgroundFinding {
  file: string;
  line: number;
  classes: string[];
}

export interface ButtonBackgroundAudit {
  count: number;
  ceiling: number;
  findings: ButtonBackgroundFinding[];
  failures: string[];
}

// Non-colour `bg-*` utilities (size, position, repeat, clip, gradient, ...) never paint a surface.
const NON_COLOUR_BACKGROUND_UTILITIES =
  /^bg-(?:transparent|inherit|current|none|auto|cover|contain|fixed|local|scroll|clip-|origin-|blend-|repeat|no-repeat|gradient-|linear-|radial-|conic-|top|bottom|left|right|center|size-|position-)/;
// Arbitrary (`bg-[…]`) and CSS-variable (`bg-(…)`) values paint a colour unless the value is an
// image, a gradient, or carries a non-colour type hint (`bg-[length:…]`, `bg-(image:…)`).
const NON_COLOUR_ARBITRARY_BACKGROUND =
  /^bg-[[(](?:url\(|image-set\(|(?:linear|radial|conic)-gradient\(|(?:image|length|size|position|repeat|attachment|origin|clip):)/;
// `bg-x/50`, `bg-[#000]/[0.4]`: translucent tints, not an opaque surface.
const TRANSLUCENT_BACKGROUND = /\/(?:\d+|\[[^\]]*\])$/;

function opaqueBackgroundClasses(classValue: string): string[] {
  return classValue
    .split(/\s+/)
    .map((token) => token.replace(/^!/, ''))
    .filter(
      (token) =>
        /^bg-./.test(token) &&
        !TRANSLUCENT_BACKGROUND.test(token) &&
        !NON_COLOUR_BACKGROUND_UTILITIES.test(token) &&
        !NON_COLOUR_ARBITRARY_BACKGROUND.test(token),
    );
}

interface EstreeNode {
  type?: string;
  [key: string]: unknown;
}

function isNode(value: unknown): value is EstreeNode {
  return typeof value === 'object' && value !== null;
}

// String literals reachable from a template expression, e.g. every branch of
// `class={cn("px-2", active ? "bg-primary" : `bg-${tone}`)}`.
function stringLiterals(expression: unknown): string[] {
  const literals: string[] = [];
  const stack: unknown[] = [expression];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isNode(node)) continue;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      literals.push(node.value);
    } else if (node.type === 'TemplateLiteral' && Array.isArray(node.quasis)) {
      for (const quasi of node.quasis as Array<{
        value: { cooked?: string | null; raw: string };
      }>) {
        literals.push(quasi.value.cooked ?? quasi.value.raw);
      }
    }
    stack.push(...Object.values(node));
  }
  return literals;
}

function attributeStrings(value: AST.Attribute['value']): string[] {
  if (value === true) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((part) =>
    part.type === 'Text' ? [part.data] : stringLiterals(part.expression),
  );
}

// The `[name, value]` pairs of an object-literal spread (`{...{ class: "bg-x" }}`), or null when
// the spread is not statically known (`{...props}`, computed keys, nested spreads).
function literalSpreadProperties(expression: unknown): Array<[string, unknown]> | null {
  if (!isNode(expression) || expression.type !== 'ObjectExpression') return null;
  const entries: Array<[string, unknown]> = [];
  for (const property of expression.properties as unknown[]) {
    if (!isNode(property) || property.type !== 'Property' || property.computed) return null;
    const key = property.key;
    const name =
      isNode(key) && key.type === 'Identifier'
        ? (key.name as string)
        : isNode(key) && key.type === 'Literal' && typeof key.value === 'string'
          ? key.value
          : null;
    if (name === null) return null;
    entries.push([name, property.value]);
  }
  return entries;
}

// Opaque background classes a `<Button>` receives without also selecting a `variant`. Attributes
// are read in source order so a later `class` overrides an earlier spread's `class`; a runtime
// spread may supply `variant`, so such a Button is treated as unknown rather than flagged.
function buttonOpaqueBackgrounds(component: AST.Component): string[] {
  let hasVariant = false;
  let classStrings: string[] = [];
  const directives: string[] = [];
  for (const attribute of component.attributes) {
    switch (attribute.type) {
      case 'Attribute':
        if (attribute.name === 'variant') hasVariant = true;
        else if (attribute.name === 'class') classStrings = attributeStrings(attribute.value);
        break;
      case 'BindDirective':
        if (attribute.name === 'variant') hasVariant = true;
        break;
      case 'ClassDirective':
        directives.push(attribute.name);
        break;
      case 'SpreadAttribute': {
        const properties = literalSpreadProperties(attribute.expression);
        if (!properties) return [];
        for (const [name, value] of properties) {
          if (name === 'variant') hasVariant = true;
          else if (name === 'class') classStrings = stringLiterals(value);
        }
        break;
      }
      default:
        break;
    }
  }
  if (hasVariant) return [];
  const classes = new Set([...classStrings, ...directives].flatMap(opaqueBackgroundClasses));
  return [...classes].sort(sortText);
}

// Every rendered `<Button>` component node in a Svelte file. Parsing (rather than regex over the
// raw source) keeps HTML comments, `<script>`/`<style>` bodies, and string contents out of scope.
function buttonComponents(file: string, source: string): AST.Component[] {
  let root: AST.Root;
  try {
    root = parse(source, { modern: true, filename: file });
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const components: AST.Component[] = [];
  const stack: unknown[] = [root.fragment];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isNode(node)) continue;
    if (node.type === 'Component' && node.name === 'Button') {
      components.push(node as unknown as AST.Component);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'attributes' || key === 'expression' || key === 'metadata') continue;
      if (isNode(value)) stack.push(value);
    }
  }
  return components.sort((a, b) => a.start - b.start);
}

export function buildButtonBackgroundAudit(root = projectRoot): ButtonBackgroundAudit {
  const findings: ButtonBackgroundFinding[] = [];
  for (const absolute of walk(path.join(root, 'src')).filter(productionSvelteSource)) {
    const file = normalizedRelative(root, absolute);
    const source = fs.readFileSync(absolute, 'utf8');
    if (!source.includes('<Button')) continue;
    for (const component of buttonComponents(file, source)) {
      const classes = buttonOpaqueBackgrounds(component);
      if (!classes.length) continue;
      const line = source.slice(0, component.start).split('\n').length;
      findings.push({ file, line, classes });
    }
  }
  const ceiling = uiComponentGuardrails.buttonBackgroundOverrides;
  const failures =
    findings.length > ceiling
      ? findings.map(
          (finding) =>
            `${finding.file}:${finding.line}: <Button> without variant sets ${finding.classes.join(' ')}; Button paints its surface on an inner span that covers class-level backgrounds, so use variant="primary" (or another buttonVariants entry) instead of bg-* on Button`,
        )
      : [];
  return { count: findings.length, ceiling, findings, failures };
}

function emptyRawElementCounts(): RawElementCounts {
  return Object.fromEntries(
    RAW_ELEMENT_TAGS.map((tag) => [tag, { files: 0, elements: 0 }]),
  ) as RawElementCounts;
}

function loadRawElementPolicy(root: string): RawElementPolicy {
  const policyFile = path.join(root, RAW_ELEMENT_POLICY);
  const parsed = JSON.parse(fs.readFileSync(policyFile, 'utf8')) as Partial<RawElementPolicy>;
  if (!parsed.ceilings || typeof parsed.ceilings !== 'object') {
    throw new Error(`${RAW_ELEMENT_POLICY}: expected ceilings`);
  }
  for (const [directory, ceilings] of Object.entries(parsed.ceilings)) {
    if (!directory.startsWith('src/') || !ceilings || typeof ceilings !== 'object') {
      throw new Error(`${RAW_ELEMENT_POLICY}: invalid directory ${directory}`);
    }
    for (const tag of RAW_ELEMENT_TAGS) {
      if (!Number.isInteger(ceilings[tag]) || ceilings[tag] < 0) {
        throw new Error(
          `${RAW_ELEMENT_POLICY}: ${directory}.${tag} must be a non-negative integer`,
        );
      }
    }
  }
  return parsed as RawElementPolicy;
}

export interface RawElementAudit {
  directories: Record<
    string,
    Record<RawElementTag, { files: number; elements: number; ceiling: number | null }>
  >;
  failures: string[];
}

export function buildRawElementAudit(root = projectRoot): RawElementAudit {
  const policy = loadRawElementPolicy(root);
  const failures: string[] = [];

  const counts = new Map<string, RawElementCounts>();
  const files = walk(path.join(root, 'src')).filter(productionSvelteSource);
  for (const absolute of files) {
    const file = normalizedRelative(root, absolute);
    if (RAW_ELEMENT_APPROVED_ROOTS.some((approved) => file.startsWith(approved))) continue;
    const directory = `src/${file.slice('src/'.length).split('/')[0]}`;
    const directoryCounts = counts.get(directory) ?? emptyRawElementCounts();
    const source = fs.readFileSync(absolute, 'utf8');
    for (const tag of RAW_ELEMENT_TAGS) {
      const matches = [...source.matchAll(new RegExp(`<${tag}(?=[\\s/>])`, 'g'))].length;
      if (!matches) continue;
      directoryCounts[tag].files += 1;
      directoryCounts[tag].elements += matches;
    }
    counts.set(directory, directoryCounts);
  }

  const directories: RawElementAudit['directories'] = {};
  const directoryNames = [...new Set([...counts.keys(), ...Object.keys(policy.ceilings)])].sort(
    sortText,
  );
  for (const directory of directoryNames) {
    const directoryCounts = counts.get(directory) ?? emptyRawElementCounts();
    directories[directory] = Object.fromEntries(
      RAW_ELEMENT_TAGS.map((tag) => {
        const ceiling = policy.ceilings[directory]?.[tag];
        if (ceiling === undefined) {
          failures.push(`${directory}: missing raw-element ceilings in ${RAW_ELEMENT_POLICY}`);
        } else if (directoryCounts[tag].files > ceiling) {
          failures.push(
            `${directory}: raw <${tag}> files ${directoryCounts[tag].files} exceed ceiling ${ceiling}; use $lib/components/ui/${tag}`,
          );
        }
        return [tag, { ...directoryCounts[tag], ceiling: ceiling ?? null }];
      }),
    ) as RawElementAudit['directories'][string];
  }
  return {
    directories,
    failures: [...new Set(failures)].sort(sortText),
  };
}

function rawElementCheckFailures(root: string, required: boolean): string[] {
  if (!required && !fs.existsSync(path.join(root, RAW_ELEMENT_POLICY))) return [];
  try {
    return buildRawElementAudit(root).failures;
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1]);
}

function matchesForbiddenImport(specifier: string, forbidden: string): boolean {
  const pattern = forbidden.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${pattern}`).test(specifier);
}

function boundaryFailures(root: string, inventory: UiComponentInventory): string[] {
  const failures: string[] = [];
  for (const rule of inventory.dependencyRules) {
    for (const component of inventory.components.filter((entry) => entry.category === rule.layer)) {
      const sourceDirectory = path.dirname(path.join(root, component.source));
      const files = component.source.endsWith('/index.ts')
        ? walk(sourceDirectory).filter(
            (file) =>
              /\.(?:ts|svelte)$/.test(file) &&
              !file.includes('/__tests__/') &&
              !/\.test\.ts$/.test(file),
          )
        : [path.join(root, component.source)];
      for (const file of files) {
        const specifiers = importSpecifiers(fs.readFileSync(file, 'utf8'));
        for (const forbidden of rule.forbidden) {
          if (!specifiers.some((specifier) => matchesForbiddenImport(specifier, forbidden)))
            continue;
          failures.push(
            `${path.relative(root, file)}: ${rule.layer} imports ${forbidden}; repair=${rule.repair}`,
          );
        }
      }
    }
  }
  return [...new Set(failures)].sort(sortText);
}

function unresolvedUiImports(root: string, inventory: UiComponentInventory): string[] {
  const knownImports = new Set(
    inventory.components.flatMap((component) => [
      component.publicImport,
      ...component.legacyImports,
    ]),
  );
  const failures: string[] = [];
  for (const file of walk(path.join(root, 'src')).filter(
    (target) =>
      /\.(?:ts|svelte)$/.test(target) &&
      !target.includes('/__tests__/') &&
      !/\.(?:test|spec)\.ts$/.test(target),
  )) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"](\$lib\/components\/ui\/[^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!knownImports.has(specifier)) {
        failures.push(
          `${path.relative(root, file)}: unclassified UI import ${specifier}; add its canonical module to scripts/ui-component-inventory.ts`,
        );
      }
    }
  }
  return [...new Set(failures)].sort(sortText);
}

function checkFailures(
  root: string,
  inventory: UiComponentInventory,
  usesProjectManifest: boolean,
): string[] {
  const failures: string[] = [];
  const ids = new Set<string>();
  const imports = new Set<string>();
  for (const component of inventory.components) {
    if (ids.has(component.id)) {
      failures.push(
        `${component.publicImport}: duplicate id ${component.id}; choose a unique metadata id`,
      );
    }
    ids.add(component.id);
    for (const specifier of [component.publicImport, ...component.legacyImports]) {
      if (imports.has(specifier)) {
        failures.push(
          `${specifier}: classified more than once; keep one canonical inventory owner`,
        );
      }
      imports.add(specifier);
    }
    if (!fs.existsSync(path.join(root, component.source))) {
      failures.push(`${component.source}: source missing; update or remove its inventory entry`);
    }
    if (
      component.category === 'deletion-candidate' &&
      (component.callers.length || component.dynamicImports.length)
    ) {
      failures.push(
        `${component.publicImport}: deletion blocked by static=${component.callers.length} dynamic=${component.dynamicImports.length}; migrate callers before removal`,
      );
    }
  }
  for (const metadata of usesProjectManifest ? canonicalComponentManifest : []) {
    const derived = inventory.components.find(
      (component) => component.publicImport === metadata.publicImport,
    );
    if (!derived) {
      failures.push(
        `${metadata.publicImport}: missing from source inventory; repair scripts/ui-component-inventory.ts`,
      );
      continue;
    }
    if (
      derived.category !== metadata.category ||
      derived.owner !== metadata.owner ||
      derived.replacement !== metadata.replacement
    ) {
      failures.push(
        `${metadata.publicImport}: source metadata disagrees with inventory; repair=${metadata.source}`,
      );
    }
    if (!metadata.fixtures.length || !metadata.characterizationTest) {
      failures.push(
        `${metadata.publicImport}: public component needs fixtures and verification ownership; catalog=/sandbox/${metadata.id}`,
      );
    }
  }
  for (const entry of usesProjectManifest ? buildUiMigrationLedger(root) : []) {
    const replacementFailure = validateMigrationReplacement(entry.replacement, inventory, root);
    if (replacementFailure) failures.push(`${entry.oldImport}: ${replacementFailure}`);
  }
  return [
    ...failures,
    ...unresolvedUiImports(root, inventory),
    ...boundaryFailures(root, inventory),
    ...(usesProjectManifest ? structuralGuardrailFailures(root) : []),
  ].sort(sortText);
}

export interface UiComponentAuditResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runUiComponentAudit(mode = 'check', rootOverride?: string): UiComponentAuditResult {
  const root = rootOverride ? path.resolve(rootOverride) : projectRoot;
  const usesProjectManifest = root === projectRoot;
  const inventory = buildUiComponentInventory(root);

  if (mode === 'inventory') {
    return {
      stdout: inventory.components
        .map(
          (component) =>
            `${component.publicImport}\t${component.category}\towner=${component.owner}\texports=${component.exports.join(',')}\tcallers=${component.callers.length}\treplacement=${component.replacement ?? '-'}\ttest=${component.characterizationTest ?? 'missing'}\tgate=${component.removalGate}`,
        )
        .sort(sortText)
        .join('\n'),
      stderr: '',
      exitCode: 0,
    };
  }
  if (mode === 'dynamic') {
    return {
      stdout: inventory.components
        .filter((component) => component.category === 'deletion-candidate')
        .map(
          (component) =>
            `${component.publicImport}\tstatic=${component.callers.length}\tdynamic=${component.dynamicImports.length}`,
        )
        .sort(sortText)
        .join('\n'),
      stderr: '',
      exitCode: 0,
    };
  }
  if (mode === 'boundaries') {
    return {
      stdout: inventory.dependencyRules
        .map(
          (rule) =>
            `${rule.layer}\tallowed=${rule.allowed.join(',')}\tforbidden=${rule.forbidden.join(',')}\trepair=${rule.repair}`,
        )
        .sort(sortText)
        .join('\n'),
      stderr: '',
      exitCode: 0,
    };
  }
  if (mode === 'json') {
    return { stdout: JSON.stringify(inventory, null, 2), stderr: '', exitCode: 0 };
  }
  if (mode === 'manifest') {
    return { stdout: JSON.stringify(canonicalComponentManifest, null, 2), stderr: '', exitCode: 0 };
  }
  if (mode === 'migrations') {
    return {
      stdout: JSON.stringify(buildUiMigrationLedger(root), null, 2),
      stderr: '',
      exitCode: 0,
    };
  }
  if (mode === 'internal-imports') {
    return {
      stdout: JSON.stringify(buildUiInternalImportLedger(root), null, 2),
      stderr: '',
      exitCode: 0,
    };
  }
  if (mode === 'raw-controls') {
    return { stdout: JSON.stringify(countRawUiControls(root), null, 2), stderr: '', exitCode: 0 };
  }
  if (mode === 'raw-elements') {
    try {
      const audit = buildRawElementAudit(root);
      return { stdout: JSON.stringify(audit, null, 2), stderr: '', exitCode: 0 };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  }
  if (mode === 'patterns') {
    const audit = buildPatternAdoptionAudit(root);
    return { stdout: JSON.stringify(audit, null, 2), stderr: '', exitCode: 0 };
  }
  if (mode === 'button-backgrounds') {
    const audit = buildButtonBackgroundAudit(root);
    return { stdout: JSON.stringify(audit, null, 2), stderr: '', exitCode: 0 };
  }
  if (mode === 'check') {
    const failures = [
      ...checkFailures(root, inventory, usesProjectManifest),
      ...rawElementCheckFailures(root, usesProjectManifest),
      ...patternAdoptionCheckFailures(root),
      ...buildButtonBackgroundAudit(root).failures,
    ].sort(sortText);
    if (failures.length) {
      return { stdout: '', stderr: failures.join('\n'), exitCode: 1 };
    }
    const exports = inventory.components.reduce(
      (total, component) => total + component.exports.length,
      0,
    );
    const callers = inventory.components.reduce(
      (total, component) => total + component.callers.length,
      0,
    );
    const deletionCandidates = inventory.components.filter(
      (component) => component.category === 'deletion-candidate',
    ).length;
    return {
      stdout: `UI component audit passed; modules=${inventory.components.length}; exports=${exports}; callers=${callers}; deletionCandidates=${deletionCandidates}; boundaryViolations=0; rawElementViolations=0; patternViolations=0; buttonBackgroundOverrides=0`,
      stderr: '',
      exitCode: 0,
    };
  }
  return {
    stdout: '',
    stderr:
      'usage: ui-component-audit.ts [inventory|dynamic|boundaries|json|manifest|migrations|internal-imports|raw-controls|raw-elements|patterns|button-backgrounds|check]',
    exitCode: 2,
  };
}

function invokedAsCli(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(path.resolve(process.argv[1])) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (invokedAsCli()) {
  const result = runUiComponentAudit(
    process.argv[2] ?? 'check',
    process.env.UI_COMPONENT_AUDIT_ROOT,
  );
  if (result.exitCode === 0) {
    console.log(result.stdout);
  } else {
    console.error(result.stderr);
  }
  process.exitCode = result.exitCode;
}
