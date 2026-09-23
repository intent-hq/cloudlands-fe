import path from 'node:path';
import ts from 'typescript';
import { parse } from 'svelte/compiler';
import { hash, inside, isTestFile, slash, Sources } from './files.ts';
import type { Analysis, Config, Fragment, Target, Trace } from './types.ts';

export const ANALYZER_VERSION = '3';
type Module = {
  source: ts.SourceFile;
  declarations: Map<string, ts.Node>;
  imports: Map<string, { specifier: string; imported: string }>;
  exports: Map<string, { specifier?: string; imported: string }>;
  stars: string[];
  hooks: ts.Node[];
  warnings: string[];
};
type TestNode = { node: ts.CallExpression; target: Target; scope: ts.Node[] };
const functionNode = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

function chain(node: ts.Node): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) return [...chain(node.expression), node.name.text];
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
    return [...chain(node.expression), node.argumentExpression.text];
  if (ts.isCallExpression(node)) return chain(node.expression);
  if (ts.isTaggedTemplateExpression(node)) return chain(node.tag);
  return [];
}

function names(node: ts.Node): Set<string> {
  const result = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (
      ts.isIdentifier(child) &&
      !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) &&
      !(ts.isPropertyAssignment(child.parent) && child.parent.name === child)
    )
      result.add(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return result;
}

function declaredNames(node: ts.Node): string[] {
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [...names(d.name)],
    );
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  )
    return [node.name.text];
  return [];
}

function location(
  node: ts.Node,
  source: ts.SourceFile,
): { line: number; endLine: number; code: string } {
  return {
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    code: node.getText(source),
  };
}

function parseModule(file: string, text: string): Module {
  const warnings: string[] = [];
  let script = text;
  if (file.endsWith('.svelte')) {
    try {
      const ast = parse(text, { modern: true });
      const ranges = [ast.instance, ast.module]
        .filter((n) => n !== null)
        .map((n) => {
          const content = n.content as typeof n.content & { start: number; end: number };
          return [content.start, content.end] as const;
        });
      script = text
        .split('')
        .map((c, i) =>
          c === '\n' || ranges.some(([start, end]) => i >= start && i < end) ? c : ' ',
        )
        .join('');
      warnings.push(
        `${file}: Svelte script and bounded component excerpt; template references are not resolved`,
      );
    } catch {
      warnings.push(`${file}: Svelte parse failed; component excerpt only`);
      script = '';
    }
  }
  const source = ts.createSourceFile(
    file,
    script,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (diagnostics.length)
    warnings.push(`${file}: ${diagnostics.length} syntax diagnostics; trace may be incomplete`);
  const module: Module = {
    source,
    declarations: new Map(),
    imports: new Map(),
    exports: new Map(),
    stars: [],
    hooks: [],
    warnings,
  };
  for (const statement of source.statements) {
    for (const name of declaredNames(statement)) module.declarations.set(name, statement);
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) module.imports.set(clause.name.text, { specifier, imported: 'default' });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          module.imports.set(element.name.text, {
            specifier,
            imported: element.propertyName?.text ?? element.name.text,
          });
      if (bindings && ts.isNamespaceImport(bindings))
        module.imports.set(bindings.name.text, { specifier, imported: '*' });
    }
    if (ts.isExportDeclaration(statement)) {
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements)
          module.exports.set(element.name.text, {
            specifier,
            imported: element.propertyName?.text ?? element.name.text,
          });
      } else if (specifier) module.stars.push(specifier);
    }
    if (
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    )
      module.declarations.set('default', statement);
    if (ts.isExportAssignment(statement)) module.declarations.set('default', statement);
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const parts = chain(statement.expression);
      if (
        parts.some((p) =>
          /^(beforeAll|beforeEach|afterAll|afterEach|mock|doMock|use|configure)$/.test(p),
        )
      )
        module.hooks.push(statement);
    }
  }
  return module;
}

function testNodes(file: string, module: Module): TestNode[] {
  const { source, imports } = module;
  const testNames = new Set(['it', 'test', 'specify']);
  const describeNames = new Set(['describe', 'suite']);
  for (const [local, { imported, specifier }] of imports) {
    if (['it', 'test', 'specify'].includes(imported)) testNames.add(local);
    if (['describe', 'suite'].includes(imported)) describeNames.add(local);
    if (specifier === 'node:test' && imported === 'default') testNames.add(local);
  }
  const result: TestNode[] = [];
  const duplicates = new Map<string, number>();
  const visit = (
    node: ts.Node,
    parents: string[],
    scope: ts.Node[],
    inherited: Target['status'],
  ): void => {
    if (ts.isCallExpression(node)) {
      const parts = chain(node.expression);
      const root = imports.get(parts[0])?.imported === '*' ? parts[1] : parts[0];
      let callback: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined =
        node.arguments.find(functionNode);
      if (!callback && node.arguments.length > 1) {
        const argument = node.arguments.at(-1)!;
        if (ts.isIdentifier(argument)) {
          const declaration = module.declarations.get(argument.text);
          if (declaration && ts.isFunctionDeclaration(declaration)) callback = declaration;
          else if (declaration && ts.isVariableStatement(declaration)) {
            const initializer = declaration.declarationList.declarations.find(
              (d) => ts.isIdentifier(d.name) && d.name.text === argument.text,
            )?.initializer;
            if (initializer && functionNode(initializer)) callback = initializer;
          }
        }
      }
      const first = node.arguments[0];
      const title =
        first && !functionNode(first)
          ? ts.isStringLiteralLike(first)
            ? first.text
            : first.getText(source)
          : '<dynamic title>';
      const status =
        parts.includes('skip') || inherited === 'skipped'
          ? 'skipped'
          : parts.includes('todo')
            ? 'todo'
            : parts.some((p) => ['skipIf', 'runIf', 'fixme'].includes(p)) ||
                inherited === 'conditional'
              ? 'conditional'
              : inherited;
      const suite = describeNames.has(root) || (testNames.has(root) && parts.includes('describe'));
      const registration =
        (testNames.has(root) &&
          !parts
            .slice(1)
            .some((p) =>
              [
                'use',
                'extend',
                'step',
                'info',
                'setTimeout',
                'slow',
                'fail',
                'beforeEach',
                'afterEach',
                'beforeAll',
                'afterAll',
              ].includes(p),
            )) ||
        suite;
      if (registration && (callback || (first && ts.isStringLiteralLike(first)))) {
        if (suite && callback?.body) {
          const hooks = ts.isBlock(callback.body)
            ? callback.body.statements.filter(
                (s) =>
                  ts.isExpressionStatement(s) &&
                  ts.isCallExpression(s.expression) &&
                  chain(s.expression).some((p) =>
                    /^(beforeAll|beforeEach|afterAll|afterEach)$/.test(p),
                  ),
              )
            : [];
          visit(callback.body, [...parents, title], [...scope, ...hooks], status);
          return;
        }
        const name = [...parents, title].join(' > ');
        if (suite) return;
        const ordinal = duplicates.get(name) ?? 0;
        duplicates.set(name, ordinal + 1);
        const target: Target = {
          id: hash([file, 'test', name, ordinal]),
          kind: 'test',
          name,
          file,
          ...location(node, source),
          status,
          parentId: hash([file, 'file']),
        };
        result.push({ node, target, scope });
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, parents, scope, inherited));
  };
  visit(source, [], module.hooks, 'active');
  return result;
}

function assertionNodes(node: ts.Node, module: Module): ts.CallExpression[] {
  const expectNames = new Set(['expect', 'assert', 'expectTypeOf', 'assertType']);
  const directAsserts = new Set(['assert', 'assertType']);
  for (const [local, { imported, specifier }] of module.imports) {
    if (expectNames.has(imported) || specifier.startsWith('node:assert') || specifier === 'assert')
      expectNames.add(local);
    if (specifier.startsWith('node:assert') || specifier === 'assert' || imported === 'assertType')
      directAsserts.add(local);
  }
  const result: ts.CallExpression[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) {
      let parts = chain(child.expression);
      if (
        module.imports.get(parts[0])?.imported === '*' &&
        ['expect', 'assert', 'expectTypeOf', 'assertType'].includes(parts[1])
      )
        parts = parts.slice(1);
      if (
        expectNames.has(parts[0]) &&
        !(
          parts[0] === 'expect' &&
          ['assertions', 'hasAssertions', 'extend', 'getState', 'setState'].includes(parts[1])
        )
      ) {
        if (parts.length > 1 || directAsserts.has(parts[0])) {
          result.push(child);
          return;
        }
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return result;
}

export class Analyzer {
  sources: Sources;
  config: Config;
  files: Set<string>;
  modules = new Map<string, Module>();
  constructor(sources: Sources, files: string[], config: Config) {
    this.sources = sources;
    this.files = new Set(files);
    this.config = config;
  }

  module(file: string): Module {
    if (!this.modules.has(file)) this.modules.set(file, parseModule(file, this.sources.read(file)));
    return this.modules.get(file)!;
  }

  resolve(from: string, specifier: string): string | undefined {
    let base: string | undefined;
    if (specifier.startsWith('.'))
      base = path.resolve(this.sources.root, path.dirname(from), specifier);
    else {
      const alias = Object.keys(this.config.aliases)
        .sort((a, b) => b.length - a.length)
        .find((a) => specifier === a || specifier.startsWith(`${a}/`));
      if (alias)
        base = path.resolve(
          this.sources.root,
          this.config.aliases[alias],
          specifier.slice(alias.length).replace(/^\//, ''),
        );
      else if (specifier.startsWith('/src/') || specifier.startsWith('/test/'))
        base = path.resolve(this.sources.root, `.${specifier}`);
    }
    if (!base || !inside(this.sources.root, base)) return undefined;
    const relative = slash(path.relative(this.sources.root, base));
    const candidates = [
      relative,
      ...[
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.mts',
        '.cts',
        '.svelte',
        '/index.ts',
        '/index.js',
      ].map((ext) => relative + ext),
    ];
    if (/\.[cm]?js$/.test(relative)) candidates.push(relative.replace(/\.([cm]?)js$/, '.$1ts'));
    return candidates.find((file) => this.files.has(file));
  }

  analyze(file: string): Analysis {
    const module = this.module(file);
    const tests = testNodes(file, module);
    const dependencies: Record<string, string> = { [file]: this.sources.digest(file) };
    const traces: Trace[] = [];
    for (const test of tests) {
      const fragments: Fragment[] = [];
      const warnings = new Set(module.warnings);
      const seen = new Set<string>();
      const helperAssertions: { file: string; node: ts.CallExpression; module: Module }[] = [];
      let chars = test.target.code.length;
      if (test.target.code.length > this.config.maxContextChars / 2)
        warnings.add('Test body exceeds context budget; excerpt truncated');
      const add = (sourceFile: string, node: ts.Node, reason: string, depth: number): void => {
        const m = this.module(sourceFile);
        const key = `${sourceFile}:${node.pos}:${node.end}`;
        if (seen.has(key)) return;
        seen.add(key);
        dependencies[sourceFile] = this.sources.digest(sourceFile);
        for (const warning of m.warnings) warnings.add(warning);
        if (
          depth > this.config.maxDepth ||
          fragments.length >= this.config.maxFragments ||
          chars >= this.config.maxContextChars
        ) {
          warnings.add('Related-code traversal reached its configured budget');
          return;
        }
        const loc = location(node, m.source);
        const remaining = this.config.maxContextChars - chars;
        const code = loc.code.slice(0, remaining);
        if (code.length < loc.code.length)
          warnings.add(`Truncated related declaration in ${sourceFile}:${loc.line}`);
        fragments.push({ file: sourceFile, ...loc, code, reason });
        chars += code.length;
        if (
          sourceFile === file ||
          isTestFile(sourceFile) ||
          /(?:^|[/.-])(?:test|tests|__tests__|testing)(?:[/.-]|$)/.test(sourceFile)
        ) {
          for (const assertion of assertionNodes(node, m))
            helperAssertions.push({ file: sourceFile, node: assertion, module: m });
        }
        follow(sourceFile, node, depth + 1);
      };
      const exported = (sourceFile: string, symbol: string, depth: number): void => {
        const m = this.module(sourceFile);
        dependencies[sourceFile] = this.sources.digest(sourceFile);
        const exportKey = `export:${sourceFile}:${symbol}`;
        if (seen.has(exportKey)) return;
        seen.add(exportKey);
        if (depth > this.config.maxDepth) {
          warnings.add('Related-code traversal reached its configured depth');
          return;
        }
        if (sourceFile.endsWith('.svelte')) {
          if (!seen.has(`component:${sourceFile}`)) {
            seen.add(`component:${sourceFile}`);
            const code = this.sources
              .read(sourceFile)
              .slice(0, Math.max(0, Math.min(5000, this.config.maxContextChars - chars)));
            if (code.length)
              fragments.push({
                file: sourceFile,
                line: 1,
                endLine: code.split('\n').length,
                code,
                reason: 'Imported Svelte component excerpt',
              });
            chars += code.length;
            warnings.add(
              `${sourceFile}: bounded component excerpt; template references are not resolved`,
            );
          }
          return;
        }
        if (symbol === '*') {
          warnings.add(`${sourceFile}: namespace import uses bounded declaration context`);
          for (const declaration of new Set(m.declarations.values()))
            add(sourceFile, declaration, 'Namespace import', depth);
          return;
        }
        const declaration = m.declarations.get(symbol);
        if (declaration) {
          add(sourceFile, declaration, `Reference to ${symbol}`, depth);
          return;
        }
        const alias = m.exports.get(symbol);
        if (alias) {
          const targetFile = alias.specifier
            ? this.resolve(sourceFile, alias.specifier)
            : sourceFile;
          if (targetFile) exported(targetFile, alias.imported, depth + 1);
          else warnings.add(`Unresolved re-export ${symbol} in ${sourceFile}`);
          return;
        }
        const imported = m.imports.get(symbol);
        if (imported) {
          const targetFile = this.resolve(sourceFile, imported.specifier);
          if (targetFile) exported(targetFile, imported.imported, depth + 1);
          return;
        }
        for (const specifier of m.stars) {
          const targetFile = this.resolve(sourceFile, specifier);
          if (targetFile) exported(targetFile, symbol, depth + 1);
        }
        if (!m.stars.length) warnings.add(`Declaration ${symbol} not resolved in ${sourceFile}`);
      };
      const follow = (sourceFile: string, node: ts.Node, depth: number): void => {
        const m = this.module(sourceFile);
        for (const name of names(node)) {
          const declaration = m.declarations.get(name);
          if (declaration && declaration !== node)
            add(sourceFile, declaration, `Local reference to ${name}`, depth);
          const imported = m.imports.get(name);
          if (imported) {
            const resolved = this.resolve(sourceFile, imported.specifier);
            if (resolved) exported(resolved, imported.imported, depth);
            else if (
              imported.specifier.startsWith('.') ||
              Object.keys(this.config.aliases).some((a) => imported.specifier.startsWith(a))
            )
              warnings.add(`Unresolved local import ${imported.specifier} in ${sourceFile}`);
          }
        }
        const visit = (child: ts.Node): void => {
          if (
            ts.isCallExpression(child) &&
            (child.expression.kind === ts.SyntaxKind.ImportKeyword ||
              chain(child.expression).some((p) =>
                ['require', 'importActual', 'importMock'].includes(p),
              ))
          ) {
            const specifier = child.arguments[0];
            if (specifier && ts.isStringLiteralLike(specifier)) {
              const resolved = this.resolve(sourceFile, specifier.text);
              if (resolved) exported(resolved, '*', depth);
              else warnings.add(`Dynamic import context unavailable: ${specifier.text}`);
            } else warnings.add('Computed import cannot be resolved statically');
          }
          ts.forEachChild(child, visit);
        };
        visit(node);
      };
      follow(file, test.node, 0);
      for (const hook of test.scope) add(file, hook, 'Test setup or teardown', 0);
      const targets: Target[] = [
        { ...test.target, code: test.target.code.slice(0, this.config.maxContextChars / 2) },
      ];
      const assertions = [
        ...assertionNodes(test.node, module).map((node) => ({ file, node, module })),
        ...helperAssertions,
      ];
      const assertionSeen = new Set<string>();
      const assertionOrdinals = new Map<string, number>();
      for (const assertion of assertions) {
        const key = `${assertion.file}:${assertion.node.pos}`;
        if (assertionSeen.has(key)) continue;
        assertionSeen.add(key);
        const loc = location(assertion.node, assertion.module.source);
        const identity = `${assertion.file}:${loc.code}`;
        const ordinal = assertionOrdinals.get(identity) ?? 0;
        assertionOrdinals.set(identity, ordinal + 1);
        const id = hash([test.target.id, assertion.file, loc.code, ordinal]);
        targets.push({
          id,
          parentId: test.target.id,
          kind: 'assertion',
          name: `${test.target.name} / assertion ${targets.length}`,
          file: assertion.file,
          ...loc,
          code: loc.code.slice(0, 4000),
          status: test.target.status,
        });
        if (loc.code.length > 4000) warnings.add('Assertion exceeds excerpt budget');
      }
      if (!assertions.length)
        warnings.add(
          'No recognized assertion sites; may use custom helpers or implicit failure checks',
        );
      if (chain(test.node.expression).some((p) => ['each', 'for'].includes(p)))
        warnings.add('Parameterized test: one static declaration, not expanded runtime cases');
      const trace: Trace = {
        id: '',
        version: ANALYZER_VERSION,
        file,
        targets,
        fragments,
        warnings: [...warnings],
        dependencies: {},
      };
      traces.push(trace);
    }
    const source = this.sources.read(file);
    const fileTarget: Target = {
      id: hash([file, 'file']),
      kind: 'file',
      name: file,
      file,
      line: 1,
      endLine: source.split('\n').length,
      code: tests.length ? '' : source.slice(0, this.config.maxContextChars),
      status: 'active',
    };
    const perTestBudget = Math.max(
      0,
      Math.floor(this.config.maxContextChars / Math.max(1, tests.length)) - 150,
    );
    const overview = tests
      .map(
        ({ target }) =>
          `${target.line}: [${target.status}] ${target.name}\n${target.code.slice(0, perTestBudget)}`,
      )
      .join('\n\n');
    const warnings = [...module.warnings];
    if (!tests.length)
      warnings.push(
        'No recognized test declarations; may use generated suites or custom registration',
      );
    if (tests.some(({ target }) => target.code.length > perTestBudget))
      warnings.push('File-level test excerpts truncated; inspect individual test traces');
    if (overview.length > this.config.maxContextChars)
      warnings.push('File inventory exceeds context budget; truncated');
    traces.unshift({
      id: '',
      version: ANALYZER_VERSION,
      file,
      targets: [fileTarget],
      fragments: [
        {
          file,
          line: 1,
          endLine: fileTarget.endLine,
          code: overview.slice(0, this.config.maxContextChars),
          reason: 'Test inventory and bounded declaration excerpts',
        },
      ],
      dependencies: {},
      warnings: [
        ...warnings,
        'File judgment uses bounded excerpts; use test and assertion scores for detailed evidence',
      ],
    });
    for (const trace of traces) {
      trace.dependencies = { ...dependencies };
      trace.id = hash(trace);
    }
    return { traces, dependencies, warnings };
  }
}
