// @verify-changed-triggers: src/**/*.ts, tsconfig.main.json
/**
 * Every key in `LOCAL_PREF_KEYS` must still be read by production code.
 *
 * The typed key union stops unlisted keys from compiling, but it cannot see
 * that the last reader of a listed key was deleted with its feature. Then the
 * saved value stays in users' `local-prefs.json` forever (Browser access left
 * its access key behind: cloudlands-fe#4740, cleaned up by #4744). This test
 * type-checks the main-process sources and fails for such a key, so removing
 * a feature forces a choice: keep a reader, or move the key to
 * `RETIRED_LOCAL_PREF_KEYS` so startup deletes it.
 *
 * A read is a call to `getLocalPref`, `getBooleanLocalPref` or `hasLocalPref`
 * outside `local-prefs.ts`, with the key resolved through the checker, or a
 * reference to an exported `local-prefs.ts` helper that reads the key.
 */

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_PREF_KEYS, RETIRED_LOCAL_PREF_KEYS } from '../local-pref-keys';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const LOCAL_PREFS = path.join(ROOT, 'src', 'main', 'local-prefs.ts');
const MAIN_INDEX = path.join(ROOT, 'src', 'main', 'index.ts');
const GENERIC_READERS = new Set(['getLocalPref', 'getBooleanLocalPref', 'hasLocalPref']);
const REGISTERED = new Set<string>(LOCAL_PREF_KEYS);

interface ReadSite {
  file: string;
  start: number;
  end: number;
}

interface Analysis {
  readers: Map<string, ReadSite[]>;
  unresolved: string[];
  retiredCleanupCallers: string[];
}

function isProductionFile(file: string): boolean {
  return (
    file.startsWith(path.join(ROOT, 'src') + path.sep) &&
    !file.endsWith('.d.ts') &&
    !/\.(?:test|spec)\.[cm]?[jt]s$/.test(file) &&
    !file.split(path.sep).includes('__tests__')
  );
}

function compilerOptions(): ts.CompilerOptions {
  const configPath = path.join(ROOT, 'tsconfig.main.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  // Only the files below are loaded; anything else resolves to `any`, which
  // the unresolved-key test reports instead of silently missing a reader.
  return { ...options, noEmit: true, incremental: false, noResolve: true, types: [] };
}

function sourceFilesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.[cm]?[jt]s$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Every production file that mentions local-prefs, plus the files it imports
 * (where key constants live). A full main-process program does not fit in a
 * test worker's memory.
 */
function rootFiles(options: ts.CompilerOptions): string[] {
  const users = sourceFilesUnder(path.join(ROOT, 'src')).filter(
    (file) => isProductionFile(file) && fs.readFileSync(file, 'utf8').includes('local-prefs'),
  );
  const roots = new Set(users);
  for (const file of users) {
    for (const ref of ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true).importedFiles) {
      const resolved = ts.resolveModuleName(ref.fileName, file, options, ts.sys).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport) {
        roots.add(path.resolve(resolved.resolvedFileName));
      }
    }
  }
  return [...roots];
}

function createProgram(overrides = new Map<string, string>()): ts.Program {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const text = overrides.get(path.resolve(fileName));
    if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true);
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  const rootNames = [...new Set([...rootFiles(options), ...overrides.keys()])];
  return ts.createProgram({ rootNames, options, host });
}

/**
 * The key a read names, or null. A union (such as `LocalPrefKey` itself, from
 * a wrapper or a cast) would count as a read of every key it contains.
 */
function singleLiteral(type: ts.Type): string | null {
  return type.isStringLiteral() ? type.value : null;
}

/** Assigned to or deleted: the helper writes the key, it does not read it. */
function isWriteTarget(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isDeleteExpression(parent)) return true;
  return (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

function isInTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Exported functions of local-prefs.ts, declared as functions or as function-valued consts. */
function exportedFunctions(file: ts.SourceFile): Array<[string, ts.Declaration]> {
  const out: Array<[string, ts.Declaration]> = [];
  for (const statement of file.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      out.push([statement.name.text, statement]);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          out.push([declaration.name.text, declaration]);
        }
      }
    }
  }
  return out;
}

function analyze(program: ts.Program): Analysis {
  const checker = program.getTypeChecker();
  const prefsFile = program.getSourceFile(LOCAL_PREFS);
  if (!prefsFile) throw new Error('local-prefs.ts is not in the main-process program');

  const genericReaders = new Set<ts.Declaration>();
  const helpers = new Map<ts.Declaration, string[]>();
  let retiredCleanup: ts.Declaration | undefined;
  const unresolved: string[] = [];

  const site = (node: ts.Node): ReadSite => ({
    file: path.resolve(node.getSourceFile().fileName),
    start: node.getStart(),
    end: node.getEnd(),
  });
  const where = (node: ts.Node) => {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    return `${path.relative(ROOT, sf.fileName)}:${line + 1}`;
  };

  for (const [name, declaration] of exportedFunctions(prefsFile)) {
    if (name.startsWith('__')) continue;
    if (GENERIC_READERS.has(name)) genericReaders.add(declaration);
    else if (name === 'deleteRetiredLocalPrefs') retiredCleanup = declaration;
    else helpers.set(declaration, []);
  }
  if (genericReaders.size !== GENERIC_READERS.size || !retiredCleanup) {
    throw new Error('local-prefs.ts no longer exports the readers this test looks for');
  }

  /** undefined: not a generic read; null: a read whose key is not one literal. */
  const genericReadKey = (call: ts.CallExpression): string | null | undefined => {
    const declaration = checker.getResolvedSignature(call)?.declaration;
    if (!declaration || !genericReaders.has(declaration as ts.Declaration)) return undefined;
    const [keyArg] = call.arguments;
    return keyArg ? singleLiteral(checker.getTypeAtLocation(keyArg)) : null;
  };

  // Keys each exported helper of local-prefs.ts reads, directly or via a generic reader.
  for (const [helper, keys] of helpers) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const read = genericReadKey(node);
        if (read === null) unresolved.push(`${where(node)} ${node.getText()}`);
        else if (read) keys.push(read);
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const property = node.propertyName ?? node.name;
        if (ts.isIdentifier(property) && REGISTERED.has(property.text)) keys.push(property.text);
      }
      if (ts.isPropertyAccessExpression(node) && REGISTERED.has(node.name.text)) {
        if (!isWriteTarget(node)) keys.push(node.name.text);
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        REGISTERED.has(node.argumentExpression.text) &&
        !isWriteTarget(node)
      ) {
        keys.push(node.argumentExpression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(helper);
  }

  const resolveReference = (id: ts.Identifier): ts.Declaration | undefined => {
    if (ts.isImportSpecifier(id.parent) || ts.isExportSpecifier(id.parent)) return undefined;
    let symbol: ts.Symbol | undefined;
    if (ts.isBindingElement(id.parent) && id.parent.name === id) {
      const property = id.parent.propertyName ?? id;
      if (!ts.isIdentifier(property) && !ts.isStringLiteral(property)) return undefined;
      symbol = checker.getTypeAtLocation(id.parent.parent).getProperty(property.text);
    } else {
      symbol = checker.getSymbolAtLocation(id);
    }
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration;
  };

  const readers = new Map<string, ReadSite[]>();
  const record = (key: string, node: ts.Node) => {
    const list = readers.get(key) ?? [];
    list.push(site(node));
    readers.set(key, list);
  };
  const retiredCleanupCallers: string[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    const file = path.resolve(sourceFile.fileName);
    if (file === LOCAL_PREFS || !isProductionFile(file)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const read = genericReadKey(node);
        if (read === null) unresolved.push(`${where(node)} ${node.getText()}`);
        else if (read) record(read, node);
        if (
          ts.isIdentifier(node.expression) &&
          resolveReference(node.expression) === retiredCleanup
        ) {
          retiredCleanupCallers.push(file);
        }
      }
      // A value reference (call or callback) to a reading helper; `typeof` does not run it.
      if (ts.isIdentifier(node) && !isInTypePosition(node)) {
        const declaration = resolveReference(node);
        const keys = declaration && helpers.get(declaration);
        if (keys) for (const key of keys) record(key, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { readers, unresolved, retiredCleanupCallers };
}

/**
 * The program with every read site of `keys` blanked out, as if their features
 * were deleted, plus `extra` files and text appended to local-prefs.ts.
 */
function withoutReadersOf(
  keys: string[],
  analysis: Analysis,
  extra: { files?: Map<string, string>; appendToLocalPrefs?: string } = {},
): ts.Program {
  const byFile = new Map<string, ReadSite[]>();
  for (const read of keys.flatMap((key) => analysis.readers.get(key) ?? [])) {
    byFile.set(read.file, [...(byFile.get(read.file) ?? []), read]);
  }
  const overrides = new Map<string, string>();
  for (const [file, sites] of byFile) {
    let text = program.getSourceFile(file)!.getFullText();
    for (const read of sites.sort((a, b) => b.start - a.start)) {
      text = `${text.slice(0, read.start)}(undefined as never)${text.slice(read.end)}`;
    }
    overrides.set(file, text);
  }
  if (extra.appendToLocalPrefs) {
    const base = overrides.get(LOCAL_PREFS) ?? program.getSourceFile(LOCAL_PREFS)!.getFullText();
    overrides.set(LOCAL_PREFS, `${base}\n${extra.appendToLocalPrefs}`);
  }
  for (const [file, text] of extra.files ?? []) overrides.set(file, text);
  return createProgram(overrides);
}

let program: ts.Program;
let analysis: Analysis;

describe('local-prefs key registry', () => {
  beforeAll(() => {
    program = createProgram();
    analysis = analyze(program);
  });

  it('has a production reader for every registered key', () => {
    const orphaned = LOCAL_PREF_KEYS.filter((key) => !analysis.readers.has(key));
    expect(
      orphaned,
      'These keys have no production reader. Keep a reader, or move them to ' +
        'RETIRED_LOCAL_PREF_KEYS in src/main/local-pref-keys.ts so startup deletes them. ' +
        'Reads are found in getLocalPref / getBooleanLocalPref / hasLocalPref calls with a ' +
        'literal key (or a const holding one), and in references to an exported ' +
        'local-prefs.ts function that reads the key itself; a read hidden behind an ' +
        'unexported local-prefs.ts function is not followed.',
    ).toEqual([]);
  });

  it('resolves the key of every read to registered literals', () => {
    expect(
      analysis.unresolved,
      'reads whose key is not one string literal: pass a literal or a const holding one, ' +
        'not a LocalPrefKey variable, so the reader of each key stays visible',
    ).toEqual([]);
    const unknown = [...analysis.readers.keys()].filter((key) => !REGISTERED.has(key));
    expect(unknown).toEqual([]);
  });

  it('compiles registered keys only, and boolean settings only through getBooleanLocalPref', () => {
    const probe = path.join(ROOT, 'src', 'main', '__local-pref-keys-probe__.ts');
    const calls = [
      `getLocalPref('menuBarAutoHide')`,
      `getBooleanLocalPref('dockEnabled', { default: true, onError: false })`,
      `setLocalPref('notARegisteredKey', 1)`,
      `deleteLocalPref('browserAccess.accessKey')`,
      `hasLocalPref(String('featureCodes'))`,
      `getLocalPref('dockEnabled')`,
      `hasLocalPref('machineRailEnabled')`,
      `getBooleanLocalPref('menuBarAutoHide', { default: false, onError: false })`,
      `getBooleanLocalPref('keychainSyncEnabled', { default: true })`,
    ];
    const lines = [
      `import { deleteLocalPref, getBooleanLocalPref, getLocalPref, hasLocalPref, setLocalPref } from './local-prefs';`,
      ...calls.map((call) => `void ${call};`),
    ];
    const probeProgram = createProgram(new Map([[probe, lines.join('\n')]]));
    const failing = probeProgram
      .getSemanticDiagnostics(probeProgram.getSourceFile(probe))
      .map((diagnostic) => {
        const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
        return calls[line - 1];
      });
    expect(failing).toEqual(calls.slice(2));
  });

  it('keeps each key in exactly one list', () => {
    const all = [...LOCAL_PREF_KEYS, ...RETIRED_LOCAL_PREF_KEYS];
    expect(all.filter((key, index) => all.indexOf(key) !== index)).toEqual([]);
  });

  it('clears retired keys from startup', () => {
    expect(analysis.retiredCleanupCallers).toContain(MAIN_INDEX);
  });

  it('reports keys as orphaned once their readers are deleted', () => {
    // One read through a local-prefs helper and one direct getLocalPref reader,
    // in registry order.
    const deleted = ['dockEnabled', 'menuBarAutoHide'];
    for (const key of deleted) expect(analysis.readers.get(key)?.length, key).toBeGreaterThan(0);
    const mutated = analyze(withoutReadersOf(deleted, analysis));
    expect(LOCAL_PREF_KEYS.filter((key) => !mutated.readers.has(key))).toEqual(deleted);
  });

  it('does not count wrappers, deletes or type references as reads', () => {
    const probe = path.join(ROOT, 'src', 'main', '__local-pref-keys-false-readers__.ts');
    const appendToLocalPrefs = [
      'export async function clearDockPlacementForProbe(): Promise<void> {',
      '  const all = await readAll();',
      '  delete all.dockPlacement;',
      '  await writeAll(all);',
      '}',
      'export const readDockShortcutsForProbe = async (): Promise<unknown> => {',
      '  const { dockShortcutOverrides } = await readStrictPrefsDocument();',
      '  return dockShortcutOverrides;',
      '};',
    ].join('\n');
    const probeText = [
      `import type { LocalPrefKey } from './local-pref-keys';`,
      `import { clearDockPlacementForProbe, getDockMediaChoiceLocalPref, getLocalPref, readDockShortcutsForProbe } from './local-prefs';`,
      `export function readPref(key: LocalPrefKey) { return getLocalPref(key); }`,
      `export const clear = clearDockPlacementForProbe;`,
      `export type MediaReader = typeof getDockMediaChoiceLocalPref;`,
      `export const shortcuts = readDockShortcutsForProbe;`,
    ].join('\n');
    const deleted = [
      'dockPlacement',
      'dockShortcutOverrides',
      'dockMediaLastSavedChoice',
      'menuBarAutoHide',
    ];
    const mutated = analyze(
      withoutReadersOf(deleted, analysis, {
        files: new Map([[probe, probeText]]),
        appendToLocalPrefs,
      }),
    );
    // The arrow helper's destructured read keeps dockShortcutOverrides alive;
    // the wrapper, the delete and the `typeof` keep nothing alive.
    expect(LOCAL_PREF_KEYS.filter((key) => !mutated.readers.has(key))).toEqual([
      'dockPlacement',
      'dockMediaLastSavedChoice',
      'menuBarAutoHide',
    ]);
    expect(mutated.unresolved).toEqual([
      expect.stringContaining('__local-pref-keys-false-readers__.ts:3 getLocalPref(key)'),
    ]);
  });
});
