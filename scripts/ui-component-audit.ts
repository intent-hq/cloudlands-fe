#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UiComponentInventory } from '../src/lib/components/ui/component-metadata';
import { canonicalComponentManifest } from '../src/lib/components/ui/manifest';
import {
  buildCheckboxControlLedger,
  buildUiInternalImportLedger,
  buildUiMigrationLedger,
  countRawUiControls,
  structuralGuardrailFailures,
  validateMigrationReplacement,
} from './ui-component-manifest';
import { buildUiComponentInventory } from './ui-component-inventory';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sortText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function walk(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => sortText(a.name, b.name))
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    });
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
  if (mode === 'checkbox-controls') {
    return {
      stdout: JSON.stringify(buildCheckboxControlLedger(root), null, 2),
      stderr: '',
      exitCode: 0,
    };
  }
  if (mode === 'check') {
    const failures = checkFailures(root, inventory, usesProjectManifest);
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
      stdout: `UI component audit passed; modules=${inventory.components.length}; exports=${exports}; callers=${callers}; deletionCandidates=${deletionCandidates}; boundaryViolations=0`,
      stderr: '',
      exitCode: 0,
    };
  }
  return {
    stdout: '',
    stderr:
      'usage: ui-component-audit.ts [inventory|dynamic|boundaries|json|manifest|migrations|internal-imports|raw-controls|checkbox-controls|check]',
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
